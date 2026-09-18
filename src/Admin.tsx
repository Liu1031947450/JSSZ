import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Card, Icon, Input, NotificationView, Tag } from 'animal-island-ui-tailwind';
import type { NotificationItem } from 'animal-island-ui-tailwind';
import { Bell, Check, Clock, Folder, Image, Key, Leaf, Lock, Paintbrush, Plus, Save, Trash, Upload, User, X } from 'lucide-react';
import Modal from './Modal';
import { acknowledgePublication, formatBytes, getFilterOptions, IMAGE_BUDGET, imagePaths, MAX_PHOTOS, messageOf, newProduct, parseCatalog, parsePrice, textLimits, usedBytes } from './catalog';
import type { Draft, Photo, Product } from './catalog';
import { configured, deploymentUrl, draftKey, repository, siteUrl } from './config';
import { authenticate, encodeBase64, fetchPublishedCatalog, publishCatalog, readSnapshot } from './github';
import type { Snapshot } from './github';
import { loadDraft, saveDraft } from './storage';
import ImageEditor from './ImageEditor';
import { PhotoImage, ProductDetail } from './PhotoWall';

type Session = { token: string; login: string };
type Confirmation = { title: string; description: string; action: () => void };

function fromSnapshot(snapshot: Snapshot, pendingRevision?: string): Draft {
  return { catalog: snapshot.catalog, baseSha: snapshot.sha, assets: {}, savedAt: new Date().toISOString(), pendingRevision };
}

function pruneAssets(draft: Draft): Draft {
  const referenced = new Set([...imagePaths(draft.catalog), ...(draft.editing?.photos.flatMap((photo) => [photo.src, photo.thumbnail]) || [])]);
  if (Object.keys(draft.assets).every((path) => referenced.has(path))) return draft;
  return { ...draft, assets: Object.fromEntries(Object.entries(draft.assets).filter(([path]) => referenced.has(path))) };
}

export default function Admin() {
  const [credential, setCredential] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [persistence, setPersistence] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [progress, setProgress] = useState('');
  const [syncNotice, setSyncNotice] = useState<NotificationItem | null>(null);
  const [watchRevision, setWatchRevision] = useState('');
  const [watchAttempt, setWatchAttempt] = useState(0);
  const [deployment, setDeployment] = useState<'idle' | 'waiting' | 'live' | 'unconfirmed'>('idle');
  const [needsSync, setNeedsSync] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Product | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLHeadingElement>(null);
  const currentDraft = useRef<Draft | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function persist(next: Draft): Promise<void> {
    const updated = { ...next, savedAt: new Date().toISOString() };
    currentDraft.current = updated;
    setDraft(updated); setPersistence('saving');
    const operation = writes.current.catch(() => {}).then(async () => {
      if (currentDraft.current !== updated) return;
      await saveDraft(draftKey, updated);
    });
    writes.current = operation;
    operation.then(() => {
      if (mounted.current && currentDraft.current === updated) { setPersistence('saved'); setSaveError(''); }
    }).catch((reason) => {
      if (mounted.current && currentDraft.current === updated) { setPersistence('error'); setSaveError(messageOf(reason)); }
    });
    return operation;
  }

  function change(next: Draft) { setProgress(''); void persist(pruneAssets(next)).catch(() => {}); }

  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => {
      if (busy || persistence !== 'saved') { event.preventDefault(); event.returnValue = ''; }
    };
    const onNavigate = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest('a');
      if (anchor?.getAttribute('href')?.startsWith('#') && (busy || persistence !== 'saved')) {
        event.preventDefault(); setError('操作或草稿保存尚未完成，请稍候；保存失败时请先重试或备份');
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onNavigate, true);
    return () => { window.removeEventListener('beforeunload', onUnload); document.removeEventListener('click', onNavigate, true); };
  }, [busy, persistence]);

  const assets = draft?.assets;
  const options = useMemo(() => getFilterOptions(draft?.catalog.products || []), [draft?.catalog.products]);
  const sources = useMemo(() => Object.fromEntries(Object.entries(assets || {}).map(([path, blob]) => [path, URL.createObjectURL(blob)])), [assets]);
  useEffect(() => () => Object.values(sources).forEach((url) => URL.revokeObjectURL(url)), [sources]);
  useEffect(() => { if (draft?.editing) editorRef.current?.focus({ preventScroll: true }); }, [draft?.editing?.id]);

  useEffect(() => {
    if (!watchRevision) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setDeployment('waiting');
    async function check() {
      const deadline = Date.now() + 180_000;
      while (!controller.signal.aborted && Date.now() < deadline) {
        try {
          const published = await fetchPublishedCatalog(siteUrl, controller.signal);
          if (published.revision === watchRevision) {
            if (!controller.signal.aborted) {
              setDeployment('live'); setProgress('');
              const latest = currentDraft.current;
              if (latest?.pendingRevision === watchRevision) void persist({ ...latest, pendingRevision: undefined }).catch(() => {});
            }
            return;
          }
        } catch { if (controller.signal.aborted) return; }
        await new Promise<void>((resolve) => { timer = setTimeout(resolve, 8000); controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
      }
      if (!controller.signal.aborted) setDeployment('unconfirmed');
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [watchRevision, watchAttempt]);

  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !configured) return;
    setBusy(true); setError('');
    const token = credential.trim();
    try {
      const login = await authenticate(repository, token);
      const remote = await readSnapshot(repository, token);
      const saved = await loadDraft(draftKey);
      if (saved) {
        parseCatalog(saved.catalog);
        if (!saved.baseSha || !saved.assets || Object.values(saved.assets).some((blob) => !(blob instanceof Blob)) || (saved.editing && (!Array.isArray(saved.editing.photos) || typeof saved.editing.name !== 'string'))) throw new Error('本地草稿格式异常，未覆盖草稿，请先备份浏览器数据');
      }
      setSession({ login, token }); setCredential(''); setSnapshot(remote); setNeedsSync(false);
      if (saved?.pendingRevision === remote.catalog.revision) {
        await persist(acknowledgePublication(saved, remote.catalog, remote.sha)); setWatchRevision(saved.pendingRevision);
      } else {
        await persist(saved ? { ...saved, pendingRevision: undefined } : fromSnapshot(remote));
      }
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  async function sync(discard = false): Promise<boolean> {
    if (!session || busy) return false;
    setBusy(true); setError(''); setSyncNotice(null);
    try {
      const remote = await readSnapshot(repository, session.token);
      setSnapshot(remote); setNeedsSync(false); setProgress('');
      const saved = currentDraft.current;
      if (discard || !saved) {
        const pending = saved?.pendingRevision === remote.catalog.revision ? saved.pendingRevision : undefined;
        await persist(fromSnapshot(remote, pending));
        setWatchRevision(pending || ''); setDeployment(pending ? 'waiting' : 'idle');
        if (pending) setWatchAttempt((count) => count + 1);
      } else if (saved.pendingRevision === remote.catalog.revision) {
        await persist(acknowledgePublication(saved, remote.catalog, remote.sha)); setWatchRevision(saved.pendingRevision); setWatchAttempt((count) => count + 1);
      } else {
        await persist({ ...saved, pendingRevision: undefined });
        if (saved.baseSha !== remote.sha) throw new Error('远端已有新的提交。本地草稿未被覆盖；请先下载备份，再选择舍弃本地更改并同步，手动重新应用需要的内容');
      }
      return true;
    } catch (reason) { setError(messageOf(reason)); return false; }
    finally { setBusy(false); }
  }

  async function publish() {
    if (!session || !draft || !snapshot || busy) return;
    setBusy(true); setError(''); setWatchRevision(''); setDeployment('idle'); setProgress('正在确认草稿和远端版本');
    const revision = crypto.randomUUID();
    const next = { ...draft, catalog: { ...draft.catalog, revision, updatedAt: new Date().toISOString() }, pendingRevision: revision };
    try {
      parseCatalog(next.catalog);
      await persist(next);
      const published = await publishCatalog(repository, session.token, snapshot, next, setProgress);
      setSnapshot(published); setNeedsSync(false); setProgress('已提交仓库，正在等待网站部署');
      await persist({ ...fromSnapshot(published, revision), assets: next.assets });
      setWatchRevision(revision); setWatchAttempt((count) => count + 1);
    } catch (reason) { setError(messageOf(reason)); setNeedsSync(true); setProgress('发布未完成或结果待核对，草稿已保留'); }
    finally { setBusy(false); }
  }

  function edit(product: Product) {
    const saved = currentDraft.current;
    if (!saved) return;
    change({ ...saved, editing: structuredClone(product) });
    setError('');
    requestAnimationFrame(() => document.getElementById('work-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function addProduct() {
    if (file || !currentDraft.current || currentDraft.current.editing || !await sync()) return;
    edit(newProduct());
    const createdAt = Date.now();
    setSyncNotice({ key: String(createdAt), createdAt, type: 'success', position: 'top', placement: 'top', duration: 4, message: '已自动核对远程', className: 'contact-notification' });
  }

  function updateEditor(patch: Partial<Product>) {
    if (draft?.editing) change({ ...draft, editing: { ...draft.editing, ...patch } });
  }

  function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!draft?.editing) return;
    const product = { ...draft.editing, updatedAt: new Date().toISOString(), photos: draft.editing.photos.map((photo, position) => ({ ...photo, alt: photo.alt.trim() || `${draft.editing!.name.trim()} · 照片 ${position + 1}` })) };
    const catalog = { ...draft.catalog, products: draft.catalog.products.some((item) => item.id === product.id) ? draft.catalog.products.map((item) => item.id === product.id ? product : item) : [product, ...draft.catalog.products] };
    try { change({ ...draft, catalog: parseCatalog(catalog), editing: undefined }); setError(''); }
    catch (reason) { setError(messageOf(reason)); }
  }

  function selectFile(chosen?: File) {
    if (!chosen || !draft?.editing) return;
    if (!replaceId && draft.editing.photos.length >= MAX_PHOTOS) { setError('每件作品最多 5 张照片'); return; }
    setError(''); setFile(chosen);
  }

  function receivePhoto(photo: Photo, additions: Record<string, Blob>) {
    if (!draft?.editing) return;
    const photos = replaceId ? draft.editing.photos.map((current) => current.id === replaceId ? { ...photo, alt: current.alt || photo.alt } : current) : [...draft.editing.photos, photo];
    change({ ...draft, assets: { ...draft.assets, ...additions }, editing: { ...draft.editing, photos } });
    setFile(null); setReplaceId(null);
  }

  async function downloadDraft() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const encoded = Object.fromEntries(await Promise.all(Object.entries(draft.assets).map(async ([path, blob]) => [path, { type: blob.type, base64: encodeBase64(new Uint8Array(await blob.arrayBuffer())) }])));
      const payload = { format: 'jianshi-draft-backup-v1', ...draft, assets: encoded };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `jianshi-draft-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  const editing = draft?.editing;
  const conflict = Boolean(draft && snapshot && draft.baseSha !== snapshot.sha);
  const dirty = Boolean(draft && snapshot && JSON.stringify(draft.catalog) !== JSON.stringify(snapshot.catalog));
  const totalBytes = draft ? usedBytes(draft.catalog) : 0;
  const locked = busy || Boolean(file);

  return <div className="admin-page">
    {syncNotice && createPortal(<div className="animal-notification-root" role="status" aria-live="polite" aria-atomic="true"><div className="animal-notification-group animal-notification-group-top"><NotificationView key={syncNotice.key} item={syncNotice} onRemove={() => setSyncNotice(null)} /></div></div>, document.body)}
    <div className="admin-heading"><div><span className="eyebrow">THE LITTLE WORKSHOP</span><h1>手作工作台<Icon icon={Paintbrush} size={27} /></h1><p>把用心完成的小作品，贴到这面墙上。</p></div><a className="back-link" href="#"><Icon icon={Leaf} size={16} /> 返回作品墙</a></div>
    {error && <div className="notice error" role="alert"><Icon icon={Bell} size={19} /><span>{error}</span><Button type="text" size="small" aria-label="关闭提示" onClick={() => setError('')}><Icon icon={X} size={16} /></Button></div>}
    {!session ? <div className="login-layout"><Card className="login-card"><span className="login-emblem"><Icon icon={Key} size={28} /></span><h2>只有主理人，才能编辑这面墙</h2><p>使用 GitHub 仓库授权进入工作台。<br />令牌只留在当前页面，不会存入本机草稿。</p>{!configured && <div className="notice warning"><span>还没有连接作品仓库。请按 README 配置公开的 owner、repo 和 branch，再重新构建网站；此处不接受 GitHub 密码。</span></div>}<form onSubmit={(event) => void connect(event)}><label htmlFor="github-token">GitHub fine-grained PAT</label><Input id="github-token" type="password" value={credential} autoComplete="off" spellCheck={false} placeholder="github_pat_…" required disabled={!configured || busy} onChange={(event) => setCredential(event.target.value)} /><span className="field-help">只授权此仓库的 Contents: Read and write。</span><Button htmlType="submit" type="primary" block loading={busy} disabled={!configured} icon={<Icon icon={Lock} size={16} />}>验证权限，进入工作台</Button></form><a className="text-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">前往 GitHub 创建限定权限的令牌 ↗</a></Card><aside className="login-note"><Icon icon={Leaf} size={36} /><h3>一件手作，<br />一个值得留下的故事。</h3><ul><li>草稿留在本机，可在下次继续。</li><li>发布后的照片与文字存入 GitHub。</li><li>网站部署完成，其他访客才会看到更新。</li></ul><p>隐藏入口不是权限保护；每次发布都需要 GitHub 的真实写入授权。</p></aside></div> : <>
      <div className="admin-toolbar"><span className="session-label"><Icon icon={User} size={17} /> {session.login}<small>{repository.owner}/{repository.repo} · {repository.branch}</small></span><div><Button size="small" disabled={locked} onClick={() => void sync()}>核对远端</Button><Button size="small" disabled={locked || persistence !== 'saved'} onClick={() => { setSession(null); setCredential(''); setDraft(null); setWatchRevision(''); }}>退出管理</Button></div></div>
      <div className="publish-panel"><div><span className={`save-status ${persistence}`} role="status"><span />{persistence === 'saved' ? '草稿已保存在本机' : persistence === 'saving' ? '正在保存草稿…' : '草稿尚未保存'}</span><p>{progress || (dirty ? '有尚未发布的更改，访客暂时看不到。' : '可以添加新作品，也可以继续打磨已有的故事。')}</p></div><Button type="primary" loading={busy} disabled={!draft || !dirty || Boolean(editing) || conflict || needsSync || persistence !== 'saved' || locked} onClick={() => void publish()} icon={<Icon icon={Upload} size={17} />}>发布到作品墙</Button></div>
      {saveError && <div className="notice error" role="alert"><span>{saveError}</span><Button size="small" disabled={busy || !draft} onClick={() => { if (draft) void persist(draft).catch(() => {}); }}>重试保存</Button></div>}
      {(conflict || needsSync) && <div className="notice warning"><span>{conflict ? '远端版本已变化，本地草稿保持不动。先下载备份，再核对远端或明确舍弃本地更改。' : '请先「核对远端」确认上次操作结果，再决定是否重新发布。'}</span></div>}
      {deployment !== 'idle' && <div className={`notice ${deployment === 'live' ? 'success' : 'info'}`} role="status"><Icon icon={deployment === 'live' ? Check : Clock} size={19} /><span>{deployment === 'live' ? '网站已更新：已从公开地址读到本次发布的内容。' : deployment === 'waiting' ? '已提交仓库，网站更新中。正在核对公开页面，请稍候…' : '已提交仓库，但尚未确认网站更新。请检查部署任务、公开站点地址与网络。'}<small>{watchRevision}</small></span><a className="text-link" href={deploymentUrl} target="_blank" rel="noreferrer">查看部署 ↗</a>{deployment === 'unconfirmed' && <Button size="small" onClick={() => setWatchAttempt((count) => count + 1)}>重新检查上线</Button>}</div>}
      {totalBytes > IMAGE_BUDGET && <div className="notice warning">当前图片已超过 200MB。Git 历史还会累积旧版本，请备份并评估容量，不宜将仓库当作无限图床。</div>}
      <div className="admin-workspace"><section className="works-list"><div className="section-heading"><h2>我的作品 <span>{draft?.catalog.products.length || 0}</span></h2><Button size="small" type="primary" disabled={locked || Boolean(editing) || !draft} onClick={() => void addProduct()} icon={<Icon icon={Plus} size={16} />}>新作品</Button></div>{draft?.catalog.products.length ? draft.catalog.products.map((product) => <Card className="work-row" key={product.id}><div className="work-thumbnail"><PhotoImage photo={product.photos[0]} source={sources[product.photos[0].thumbnail]} /></div><div className="work-row-copy"><h3>{product.name}</h3><span>{product.category || '未分类'} · {product.photos.length} 张照片</span><div><Button size="small" type="text" disabled={locked || Boolean(editing)} onClick={() => edit(product)}>编辑</Button><Button size="small" type="text" disabled={locked} onClick={() => setPreview(product)}>预览</Button><Button size="small" type="text" danger disabled={locked || Boolean(editing)} onClick={() => setConfirmation({ title: '将这件作品从墙上取下？', description: '先从本地待发布清单移除，点击发布后才会从网站消失。Git 历史仍可能保留旧照片。', action: () => { if (draft) change({ ...draft, catalog: { ...draft.catalog, products: draft.catalog.products.filter((item) => item.id !== product.id) } }); } })}>删除</Button></div></div></Card>) : <div className="empty-workspace"><Icon icon={Image} size={38} /><h3>从第一件作品开始</h3><p>添加照片，写下它的小故事。<br />准备好了，再一起发布到墙上。</p></div>}<div className="storage-summary"><Icon icon={Folder} size={17} /><span>已加入清单的图片：{formatBytes(totalBytes)}<small>不含本地编辑器和 Git 历史占用</small></span></div><div className="draft-actions"><Button size="small" disabled={!draft || busy} onClick={() => void downloadDraft()}>下载草稿备份</Button><Button size="small" type="text" danger disabled={locked || !draft} onClick={() => setConfirmation({ title: '舍弃本地更改并重新同步？', description: '这会用远端清单替换本机草稿和编辑器。请先下载备份；不会删除远端已发布内容。', action: () => void sync(true) })}>舍弃本地更改</Button></div></section>
      <section id="work-editor" className="editor-section">{editing ? <Card className="editor-card"><div className="section-heading"><h2 ref={editorRef} tabIndex={-1}>{draft!.catalog.products.some((item) => item.id === editing.id) ? '编辑这份心意' : '记录新的手作'}</h2><Tag color="app-yellow" variant="soft">本地草稿</Tag></div><form onSubmit={saveEditor}><fieldset disabled={locked}>
        <label htmlFor="work-name">作品名称 <span className="required">*</span></label><Input id="work-name" value={editing.name} maxLength={textLimits.name} required placeholder="给这份心意起一个名字" onChange={(event) => updateEditor({ name: event.target.value })} />
        <label htmlFor="work-description">作品简介</label><textarea id="work-description" value={editing.description} maxLength={textLimits.description} rows={4} placeholder="灵感从哪里来？制作时有什么小故事？" onChange={(event) => updateEditor({ description: event.target.value })} /><span className="field-help count-help">{editing.description.length} / {textLimits.description}</span>
        <div className="field-grid"><div><label htmlFor="work-category">分类</label><Input id="work-category" list="work-category-options" autoComplete="off" allowClear maxLength={textLimits.category} value={editing.category} placeholder="选择已有分类或输入新分类" onChange={(event) => updateEditor({ category: event.target.value })} /></div><div><label htmlFor="work-price">价格（人民币）</label><Input key={editing.id} id="work-price" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={editing.price ?? ''} prefix="¥" suffix="元" aria-describedby="price-help" placeholder="暂未标价" onChange={(event) => {
          const price = event.target.value === '' ? undefined : event.target.valueAsNumber;
          event.target.setCustomValidity('');
          try { parsePrice(price); } catch (reason) { event.target.setCustomValidity(messageOf(reason)); }
          updateEditor({ price });
        }} /><span id="price-help" className="field-help">非负金额，最多两位小数；可留空。</span></div></div><label htmlFor="work-material">材质</label><Input id="work-material" list="work-material-options" autoComplete="off" allowClear maxLength={textLimits.material} value={editing.material} placeholder="选择已有材质或输入新材质" onChange={(event) => updateEditor({ material: event.target.value })} />
        <datalist id="work-category-options">{options.categories.map((value) => <option key={value} value={value} />)}</datalist>
        <datalist id="work-material-options">{options.materials.map((value) => <option key={value} value={value} />)}</datalist>
        <div className="photo-field-heading"><label>作品照片 <span className="required">*</span></label><span>{editing.photos.length} / {MAX_PHOTOS}</span></div><p className="field-help">第一张是墙面封面。JPEG / PNG / WebP，每张 ≤ 10MB，≤ 2400 万像素。</p>
        <div className="edit-photos">{editing.photos.map((photo, position) => <div className="edit-photo" key={photo.id}><div className="edit-photo-preview"><PhotoImage photo={photo} source={sources[photo.thumbnail]} />{position === 0 && <span className="cover-badge">封面</span>}</div><label htmlFor={`alt-${photo.id}`}>照片 {position + 1} 说明</label><Input id={`alt-${photo.id}`} value={photo.alt} maxLength={textLimits.alt} onChange={(event) => updateEditor({ photos: editing.photos.map((item) => item.id === photo.id ? { ...item, alt: event.target.value } : item) })} /><div className="photo-actions"><Button size="small" type="text" disabled={position === 0} onClick={() => updateEditor({ photos: [photo, ...editing.photos.filter((item) => item.id !== photo.id)] })}>设为封面</Button><Button size="small" type="text" disabled={position === 0} aria-label={`照片 ${position + 1} 前移`} onClick={() => { const photos = [...editing.photos]; [photos[position - 1], photos[position]] = [photos[position], photos[position - 1]]; updateEditor({ photos }); }}>前移</Button><Button size="small" type="text" onClick={() => { setReplaceId(photo.id); inputRef.current?.click(); }}>更换</Button><Button size="small" type="text" danger aria-label={`移除照片 ${position + 1}`} onClick={() => updateEditor({ photos: editing.photos.filter((item) => item.id !== photo.id) })}><Icon icon={Trash} size={15} /></Button></div></div>)}</div>
        <input ref={inputRef} className="visually-hidden" tabIndex={-1} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" aria-label="选择作品照片" onChange={(event) => { selectFile(event.target.files?.[0]); event.target.value = ''; }} />
        {editing.photos.length < MAX_PHOTOS && <div className="upload-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (locked) return; if (event.dataTransfer.files.length !== 1) { setError('请每次添加一张照片，并完成预览和裁剪'); return; } setReplaceId(null); selectFile(event.dataTransfer.files[0]); }}><Icon icon={Upload} size={28} /><Button type="text" onClick={() => { setReplaceId(null); inputRef.current?.click(); }}>选择一张照片，或拖到这里</Button><span>预览 → 裁剪 → 自动压缩</span></div>}
        <div className="editor-actions"><Button type="text" onClick={() => setConfirmation({ title: '放弃当前编辑？', description: '编辑器中的修改将被移除，不影响已存入待发布清单的作品。', action: () => change({ ...draft!, editing: undefined }) })}>取消编辑</Button><Button disabled={!editing.photos.length} onClick={(event) => { if (event.currentTarget.form?.querySelector<HTMLInputElement>('#work-price')?.reportValidity()) setPreview({ ...editing, name: editing.name || '未命名作品' }); }}>预览详情</Button><Button htmlType="submit" type="primary" icon={<Icon icon={Save} size={16} />}>存入待发布清单</Button></div>
      </fieldset></form></Card> : <div className="editor-placeholder"><Icon icon={Paintbrush} size={47} /><h3>给每份手作，留下一点记录。</h3><p>选择左侧作品继续编辑，<br />或从一张新照片开始。</p><span>MAKE SOMETHING THAT MAKES YOU SMILE</span></div>}</section></div>
      <p className="privacy-note"><Icon icon={Lock} size={15} /> 只上传可公开的内容。网站发布不是私密存储；删除作品不等于清除 Git 历史或访客已下载的副本。</p>
    </>}
    {file && editing && <ImageEditor file={file} productId={editing.id} alt={`${editing.name.trim() || '手作作品'} · 照片 ${editing.photos.length + 1}`} onSave={receivePhoto} onClose={() => { setFile(null); setReplaceId(null); }} />}
    {preview && <ProductDetail product={preview} sources={sources} onClose={() => setPreview(null)} />}
    {confirmation && <Modal open title={confirmation.title} typewriter={false} onClose={() => setConfirmation(null)} footer={<><Button onClick={() => setConfirmation(null)}>再想想</Button><Button type="primary" danger onClick={() => { confirmation.action(); setConfirmation(null); }}>确认</Button></>}><p className="confirmation-copy">{confirmation.description}</p></Modal>}
  </div>;
}

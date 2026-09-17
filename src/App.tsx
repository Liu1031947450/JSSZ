import { lazy, Suspense, useEffect, useState } from 'react';
import { Button, Icon } from 'animal-island-ui-tailwind';
import { Flower, Gift, Heart, Leaf, Sun, Wifi } from 'lucide-react';
import PhotoWall from './PhotoWall';
import type { Catalog } from './catalog';
import { messageOf } from './catalog';
import { assetUrl, basePath } from './config';
import { fetchPublishedCatalog } from './github';

const Admin = lazy(() => import('./Admin'));

export default function App() {
  const [admin, setAdmin] = useState(window.location.hash.startsWith('#/admin'));
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const navigate = () => setAdmin(window.location.hash.startsWith('#/admin'));
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    if (admin) return;
    const controller = new AbortController();
    let active = true;
    async function refresh() {
      setLoading(true);
      try {
        const next = await fetchPublishedCatalog(new URL(basePath, window.location.origin).href, controller.signal);
        if (active) { setCatalog(next); setError(''); }
      } catch (reason) { if (active && !controller.signal.aborted) setError(messageOf(reason)); }
      finally { if (active) setLoading(false); }
    }
    void refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; controller.abort(); document.removeEventListener('visibilitychange', onVisible); };
  }, [admin, reload]);
  return <div className="site-shell">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header"><a className="brand" href="#" aria-label="简时手作首页"><span className="brand-mark"><img src={assetUrl('logo.png')} alt="简时手作 Logo" width={256} height={256} decoding="async" /></span><span>简时手作<small>JIANSHI · HANDMADE</small></span></a><nav aria-label="主导航">{!admin && <><a className="nav-active" href="#works">作品墙<span /></a><a href="#about">关于手作</a></>}<span className="header-note"><Icon icon={Sun} size={17} /> 日子慢慢，心意满满</span></nav></header>
    <main id="main" tabIndex={-1}>
      {admin ? <Suspense fallback={<div className="page-status" role="status">正在打开手作工作台…</div>}><Admin /></Suspense> : <>
        <section className="hero" aria-labelledby="site-title"><div className="hero-flower" aria-hidden="true"><Icon icon={Flower} size={48} /><span>made with love</span></div><div className="hero-copy"><span className="eyebrow hero-eyebrow"><span /> A LITTLE JOY, MADE BY HAND <span /></span><h1 id="site-title">简时手作<span className="title-spark" aria-hidden="true">✳</span></h1><p>把日子，做成喜欢的样子。</p><span className="hero-subtitle">一些手作 · 一点灵感 · 一份认真生活的心意</span></div><div className="hero-label" aria-hidden="true"><Icon icon={Heart} size={22} /><span>慢一点<br />也很好</span><small>JUST TAKE IT SLOW</small></div></section>
        {error && <div className="notice error" role="alert"><Icon icon={Wifi} size={19} /><span>{catalog ? '暂时无法获取最新作品，以下为本次已加载的内容。' : '还没能读到作品清单，请稍后再试。'}<small>{error}</small></span><Button size="small" onClick={() => setReload((count) => count + 1)} disabled={loading}>重新加载</Button></div>}
        {loading && !catalog && <div className="page-status" role="status"><Icon icon={Leaf} size={25} /><span>正在把小小的心意贴上墙…</span></div>}
        {catalog && <PhotoWall products={catalog.products} />}
        <section className="about-section" id="about" aria-labelledby="about-title"><div className="about-heading"><span className="eyebrow">LITTLE THINGS MATTER</span><h2 id="about-title">手作，是和生活的温柔对话。</h2><p>不追赶时间，不批量复制。<br className="mobile-break" />让平凡的材料，长出自己的小故事。</p></div><div className="about-values"><div><span className="value-icon sage"><Icon icon={Leaf} size={25} /></span><h3>自然的灵感</h3><p>从四季与日常里，<br />捡起一点小小的美好。</p></div><div><span className="value-icon peach"><Icon icon={Heart} size={25} /></span><h3>手心的温度</h3><p>慢慢打磨每个细节，<br />也留下手作独有的痕迹。</p></div><div><span className="value-icon butter"><Icon icon={Gift} size={25} /></span><h3>独一份心意</h3><p>珍藏那些不必完美，<br />却足够真诚的喜欢。</p></div></div></section>
      </>}
    </main>
    <footer className="site-footer"><div className="footer-signature"><Icon icon={Leaf} size={17} /><span>慢慢做，好好生活。</span></div><div className="footer-bottom"><small>© {new Date().getFullYear()} 简时手作 · 个人作品展示</small><div><a href={assetUrl('animal-island-ui-tailwind-LICENSE.txt')} target="_blank" rel="noreferrer">UI: Animal Island UI Tailwind · MIT</a><a className="admin-entry" href="#/admin" aria-label="进入管理工作台" title="管理工作台"><Icon icon={Leaf} size={16} /></a></div></div></footer>
  </div>;
}

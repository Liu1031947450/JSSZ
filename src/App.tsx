import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Button, Icon } from 'animal-island-ui-tailwind';
import { Flower, Gift, Heart, Leaf } from 'lucide-react';
import PhotoWall from './PhotoWall';
import Modal from './Modal';
import LoadErrorNotice from './LoadErrorNotice';
import ContactLinks, { FloatingContacts } from './Contact';
import type { Catalog } from './catalog';
import { messageOf } from './catalog';
import { assetUrl, basePath } from './config';
import { fetchPublishedCatalog } from './github';

const Admin = lazy(() => import('./Admin'));
const ExhibitionHome = lazy(() => import('./ExhibitionHome'));
const disclaimerText = '本网站仅作为作品款式展示电子画册，所有咨询、沟通、订单交易，全部请在对应平台完成，网页不承接任何付款下单。';

class ExhibitionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <LoadErrorNotice onRetry={() => window.location.reload()}>新版首页暂时未能加载，可以重新加载，或通过顶部按钮返回老版首页。</LoadErrorNotice> : this.props.children;
  }
}

export default function App() {
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  const [admin, setAdmin] = useState(window.location.hash.startsWith('#/admin'));
  const [exhibition, setExhibition] = useState(new URLSearchParams(window.location.search).get('home') === '3d');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const navigate = () => {
      setAdmin(window.location.hash.startsWith('#/admin'));
      setExhibition(new URLSearchParams(window.location.search).get('home') === '3d');
    };
    window.addEventListener('hashchange', navigate);
    window.addEventListener('popstate', navigate);
    return () => { window.removeEventListener('hashchange', navigate); window.removeEventListener('popstate', navigate); };
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
  function switchHome() {
    const next = new URL(window.location.href);
    if (exhibition) next.searchParams.delete('home');
    else next.searchParams.set('home', '3d');
    next.hash = '';
    window.history.pushState(window.history.state, '', next);
    setExhibition(!exhibition);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  return <div className={`site-shell${!admin && exhibition ? ' exhibition-shell' : ''}`} inert={showDisclaimer}>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="site-header"><a className="brand" href="#" aria-label="简时手作首页"><span className="brand-mark"><img src={assetUrl('logo.png')} alt="简时手作 Logo" width={256} height={256} decoding="async" /></span><span>简时手作<small>JIANSHI · HANDMADE</small></span></a><nav aria-label="主导航">{!admin && <><a className="nav-active" href="#works">{exhibition ? '作品展厅' : '作品墙'}<span /></a><a href="#about">关于手作</a><button type="button" className="home-version-switch" onClick={switchHome}>{exhibition ? '返回老版首页' : '切换新版首页'}<span aria-hidden="true">{exhibition ? '↩' : '↗'}</span></button></>}<ContactLinks className="header-contacts" /></nav></header>
    <main id="main" tabIndex={-1}>
      {admin ? <Suspense fallback={<div className="page-status" role="status">正在打开手作工作台…</div>}><Admin /></Suspense> : exhibition ? <ExhibitionBoundary><Suspense fallback={<div className="page-status" role="status">正在打开手作展厅…</div>}><ExhibitionHome catalog={catalog} error={error} loading={loading} onRetry={() => setReload((count) => count + 1)} disclaimer={disclaimerText} active={!showDisclaimer} /></Suspense></ExhibitionBoundary> : <>
        <section className="hero" aria-labelledby="site-title"><div className="hero-flower" aria-hidden="true"><Icon icon={Flower} size={48} /><span>made with love</span></div><div className="hero-copy"><span className="eyebrow hero-eyebrow"><span /> A LITTLE JOY, MADE BY HAND <span /></span><h1 id="site-title">简时手作<span className="title-spark" aria-hidden="true">✳</span></h1><p>把日子，做成喜欢的样子。</p><span className="hero-subtitle">一些手作 · 一点灵感 · 一份认真生活的心意</span></div><div className="hero-label" aria-hidden="true"><Icon icon={Heart} size={22} /><span>慢一点<br />也很好</span><small>JUST TAKE IT SLOW</small></div></section>
        <aside className="home-disclaimer" aria-label="重要声明"><strong>重要声明</strong><p>{disclaimerText}</p></aside>
        {error && <LoadErrorNotice detail={error} loading={loading} onRetry={() => setReload((count) => count + 1)}>{catalog ? '暂时无法获取最新作品，以下为本次已加载的内容。' : '还没能读到作品清单，请稍后再试。'}</LoadErrorNotice>}
        {loading && !catalog && <div className="page-status" role="status"><Icon icon={Leaf} size={25} /><span>正在把小小的心意贴上墙…</span></div>}
        {catalog && <PhotoWall products={catalog.products} />}
        <section className="about-section" id="about" aria-labelledby="about-title"><div className="about-heading"><span className="eyebrow">LITTLE THINGS MATTER</span><h2 id="about-title">手作，是和生活的温柔对话。</h2><p>不追赶时间，不批量复制。<br className="mobile-break" />让平凡的材料，长出自己的小故事。</p></div><div className="about-values"><div><span className="value-icon sage"><Icon icon={Leaf} size={25} /></span><h3>自然的灵感</h3><p>从四季与日常里，<br />捡起一点小小的美好。</p></div><div><span className="value-icon peach"><Icon icon={Heart} size={25} /></span><h3>手心的温度</h3><p>慢慢打磨每个细节，<br />也留下手作独有的痕迹。</p></div><div><span className="value-icon butter"><Icon icon={Gift} size={25} /></span><h3>独一份心意</h3><p>珍藏那些不必完美，<br />却足够真诚的喜欢。</p></div></div></section>
      </>}
    </main>
    <footer className="site-footer"><div className="footer-signature"><Icon icon={Leaf} size={17} /><span>慢慢做，好好生活。</span></div><ContactLinks /><div className="footer-bottom"><small>© {new Date().getFullYear()} 简时手作 · 个人作品展示</small><div><a href={assetUrl('animal-island-ui-tailwind-LICENSE.txt')} target="_blank" rel="noreferrer">UI: Animal Island UI Tailwind · MIT</a><a className="admin-entry" href="#/admin" aria-label="进入管理工作台" title="管理工作台"><Icon icon={Leaf} size={16} /></a></div></div></footer>
    <FloatingContacts />
    {showDisclaimer && <Modal open title="重要声明" width={520} typewriter={false} maskClosable={false} className="disclaimer-modal" footer={<Button type="primary" aria-describedby="site-disclaimer" onClick={() => setShowDisclaimer(false)}>我同意</Button>}><p id="site-disclaimer">{disclaimerText}</p></Modal>}
  </div>;
}

import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, MoveUpRight, Pause, Play, Sparkles } from 'lucide-react';
import type { Catalog, Product } from './catalog';
import { sortProducts } from './catalog';
import { ProductDetail } from './PhotoWall';
import LoadErrorNotice from './LoadErrorNotice';
import ThreeGallery from './ThreeGallery';
import useExhibitionMotion, { useExhibitionAutoplay } from './useExhibitionMotion';
import ExhibitionRooms, { type ExhibitionRoom } from './ExhibitionRooms';
import './ExhibitionHome.css';

export default function ExhibitionHome({ catalog, error, loading, onRetry, disclaimer, active }: { catalog: Catalog | null; error: string; loading: boolean; onRetry: () => void; disclaimer: string; active: boolean }) {
  const [selected, setSelected] = useState<Product | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [automatic, setAutomatic] = useState(false);
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const motionPaused = paused || !active || Boolean(selected);
  useExhibitionMotion(root, motionPaused);
  const { featured, rooms } = useMemo(() => {
    const ordered = sortProducts(catalog?.products || []);
    const works = ordered.filter(product => product.pinOrder === undefined);
    const candidates = works.length ? works : ordered;
    const groups = new Map<string, ExhibitionRoom>();
    for (const product of ordered) {
      const key = product.category;
      if (!groups.has(key)) groups.set(key, { category: key || '手作手记', products: [] });
      groups.get(key)!.products.push(product);
    }
    return { featured: candidates.slice(0, 6), rooms: [...groups.values()] };
  }, [catalog]);
  const currentIndex = focusIndex % (featured.length || 1);
  const current = featured[currentIndex];
  useExhibitionAutoplay(hero, motionPaused || featured.length < 2, () => moveFeatured(currentIndex + 1, true));

  function moveFeatured(target: number, automatically = false) {
    setAutomatic(automatically);
    setFocusIndex((target + featured.length) % featured.length);
  }

  return <div className="exhibition-home" ref={root}>
    <section ref={hero} className="exhibition-hero" aria-labelledby="exhibition-title">
      <div className="exhibition-landscape" aria-hidden="true"><span className="exhibition-sun" /><span className="exhibition-hill hill-far" /><span className="exhibition-hill hill-near" /><span className="exhibition-orbit orbit-one" /><span className="exhibition-orbit orbit-two" /></div>
      <div className="exhibition-edition"><span><i /> 简时手作 · 灵感新生</span><span>THE HANDMADE EDITION / 01</span></div>
      <ThreeGallery products={featured} focusIndex={currentIndex} paused={motionPaused} onSelect={setSelected} />
      <div className="exhibition-hero-copy">
        <span className="exhibition-kicker">A SMALL WORLD, MADE BY HAND</span>
        <h1 id="exhibition-title">把时光，<br /><span>留在手心。</span></h1>
        <p className="exhibition-script">Little things. Lasting love.</p>
        <p className="exhibition-intro">让一份喜欢，拥有形状。<br />走进简时的小小宇宙，发现手作的另一面。</p>
        <a className="exhibition-cta" href="#works">探索作品 <ArrowUpRight size={19} /></a>
      </div>
      <span className="exhibition-side-note" aria-hidden="true">SLOWLY MADE. DEEPLY LOVED.</span>
      <div className="exhibition-hero-bottom">
        <a className="exhibition-scroll" href="#exhibition-index"><ArrowDown size={17} /><span>向下，走进小小美好<small>SCROLL TO DISCOVER</small></span></a>
        {current && <div className="exhibition-selection" aria-label="立体展品选择">
          <button type="button" aria-label="上一件立体展品" onClick={() => moveFeatured(currentIndex - 1)}><ArrowLeft size={17} /></button>
          <button type="button" className="exhibition-current" aria-label={`查看立体展品：${current.name}`} onClick={() => setSelected(current)}><small>{String(currentIndex + 1).padStart(2, '0')} / {String(featured.length).padStart(2, '0')} · 灵感选集</small><span aria-live={automatic ? 'off' : 'polite'}>{current.name} <MoveUpRight size={13} /></span></button>
          <button type="button" aria-label="下一件立体展品" onClick={() => moveFeatured(currentIndex + 1)}><ArrowRight size={17} /></button>
        </div>}
        <button type="button" className="exhibition-hero-motion" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}<span>{paused ? '开启全页动效' : '暂停全页动效'}</span></button>
      </div>
    </section>

    <nav className="exhibition-index" id="exhibition-index" aria-label="展厅章节">
      <span className="exhibition-index-label">THE JOURNEY<br /><strong>选择下一幕</strong></span>
      <div className="exhibition-room-links">{rooms.map((room, index) => <a href={`#exhibition-room-${index}`} key={index}><span>0{index + 1}</span><div>{room.category}</div></a>)}<a href="#about"><span>✳</span><div>关于手作</div></a><a href="#exhibition-contact"><span>↗</span><div>相遇</div></a></div>
      <button type="button" className="exhibition-motion" aria-pressed={paused} aria-label={paused ? '开启全页动效' : '暂停全页动效'} title="控制全页动效；始终尊重系统的减少动态效果设置" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}<span>{paused ? '开启动效' : '暂停动效'}</span></button>
      <span className="exhibition-reading-line" aria-hidden="true" />
    </nav>

    <section className="exhibition-lobby" id="works" data-chapter aria-labelledby="exhibition-collection-title">
      <div className="exhibition-section-heading" data-reveal><div><span className="exhibition-kicker">NOT A CATALOG. A JOURNEY.</span><h2 id="exhibition-collection-title">不是陈列，<span>是一场相遇。</span></h2></div><p>{catalog ? `${catalog.products.length} 件心意 · ${rooms.length} 幕不同的风景` : '手作的故事，正在慢慢展开。'}<br />向下走进展场，左右切换，发现每一件作品。</p></div>
      <aside className="home-disclaimer" aria-label="重要声明"><strong>展示与咨询</strong><p>{disclaimer}</p></aside>
      {error && <LoadErrorNotice detail={error} loading={loading} onRetry={onRetry}>{catalog ? '暂时无法获取最新作品，以下为本次已加载的内容。' : '还没能读到作品清单，请稍后再试。'}</LoadErrorNotice>}
      {loading && !catalog && <div className="page-status" role="status">正在布置小小的作品展厅…</div>}
      {catalog && !catalog.products.length && <div className="exhibition-empty" role="status"><Sparkles size={32} /><h3>新的故事，正在酝酿。</h3><p>作品准备好后，会在这里与你相遇。</p></div>}
    </section>

    {rooms.map((room, index) => <ExhibitionRooms key={room.products[0].category} room={room} index={index} nextId={index + 1 < rooms.length ? `exhibition-room-${index + 1}` : 'about'} onSelect={setSelected} paused={motionPaused} />)}

    <div className="exhibition-ribbon" data-motion-section aria-hidden="true"><div className="exhibition-ribbon-track">{[0, 1].map(copy => <span key={copy}>SMALL THINGS <i>✳</i> BIG FEELINGS <i>✳</i> 小小手作，长长心意 <i>✳</i> </span>)}</div></div>

    <section className="exhibition-about" id="about" data-chapter data-motion-section aria-labelledby="exhibition-about-title">
      <div className="exhibition-about-art" aria-hidden="true"><span className="exhibition-art-ring" /><span className="exhibition-art-pearl" /><span className="exhibition-art-star">✳</span><span className="exhibition-art-label">THE BEAUTY<br />OF LITTLE THINGS<small>简时 · 手作</small></span></div>
      <div className="exhibition-about-copy"><span className="exhibition-kicker" data-reveal>CHAPTER II / THE PHILOSOPHY</span><h2 id="exhibition-about-title" data-reveal>世界很快。<br />我们，<em>慢慢来。</em></h2><p data-reveal>一颗珠子，一片花叶，一段值得留下的时光。<br />我们相信，真正动人的东西，<br />不是被批量制造，而是被认真对待。</p><div className="exhibition-values"><span data-reveal><small>01 / INSPIRATION</small>从日常里，捡起灵感。</span><span data-reveal><small>02 / CRAFT</small>把心意，藏进细节。</span><span data-reveal><small>03 / CONNECTION</small>让喜欢，长久一点。</span></div></div>
    </section>

    <section className="exhibition-connect" id="exhibition-contact" data-chapter data-motion-section aria-labelledby="exhibition-connect-title"><div className="exhibition-connect-orbit" aria-hidden="true"><i /><i /><i /></div><span className="exhibition-connect-word" aria-hidden="true">Made to connect.</span><span className="exhibition-kicker" data-reveal>CHAPTER III / LET’S CONNECT</span><Sparkles className="exhibition-connect-spark" size={30} strokeWidth={1} /><h2 id="exhibition-connect-title" data-reveal>故事的下一页，<span>想和你一起。</span></h2><p data-reveal>喜欢某件作品？通过页脚的平台入口，来和我聊聊吧。</p><span className="exhibition-signature" data-reveal>With love, Jianshi.</span><a className="exhibition-text-link" href="#works">带着心动，再逛一遍 <ArrowUpRight size={16} /></a></section>
    {selected && <ProductDetail key={selected.id} product={selected} onClose={() => setSelected(null)} />}
  </div>;
}

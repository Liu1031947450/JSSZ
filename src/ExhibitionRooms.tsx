import { useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, RotateCcw } from 'lucide-react';
import type { Product } from './catalog';
import { formatPrice } from './catalog';
import { PhotoImage } from './PhotoWall';
import { useExhibitionAutoplay } from './useExhibitionMotion';
import './ExhibitionRooms.css';

export type ExhibitionRoom = { category: string; products: Product[] };

const treatments = [
  { name: 'folio', title: '翻开，一段心意。', subtitle: 'THE LIVING ARCHIVE', word: 'Dear you.', note: '一页一页，慢慢读懂手作里的故事。' },
  { name: 'sculpture', title: '让喜欢，有了形状。', subtitle: 'THE OBJECT STUDIO', word: 'In good hands.', note: '把日常的片段，放在光里认真端详。' },
  { name: 'orbit', title: '每一份，都在发光。', subtitle: 'THE CELESTIAL ROOM', word: 'Little universe.', note: '沿着心动的轨迹，遇见下一件独一无二。' },
];

export default function ExhibitionRooms({ room, index, nextId, onSelect, paused }: { room: ExhibitionRoom; index: number; nextId: string; onSelect: (product: Product) => void; paused: boolean }) {
  const [selection, setSelection] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [direction, setDirection] = useState(1);
  const [failedId, setFailedId] = useState('');
  const [attempt, setAttempt] = useState(0);
  const gesture = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const section = useRef<HTMLElement>(null);
  const currentIndex = Math.max(0, room.products.findIndex(product => product.id === selection));
  const product = room.products[currentIndex];
  const treatment = treatments[index % treatments.length];
  const roomId = `exhibition-room-${index}`;
  const total = room.products.length;
  const previous = room.products[(currentIndex + total - 1) % total];
  const next = room.products[(currentIndex + 1) % total];

  useExhibitionAutoplay(section, paused || total < 2 || failedId === product.id, () => move(currentIndex + 1, true));

  function move(target: number, automatically = false) {
    const nextIndex = (target + total) % total;
    if (nextIndex === currentIndex) return;
    setDirection(target > currentIndex ? 1 : -1);
    setAutomatic(automatically);
    setSelection(room.products[nextIndex].id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target instanceof HTMLInputElement || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    move(event.key === 'Home' ? 0 : event.key === 'End' ? total - 1 : currentIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  }

  return <section ref={section} className={`exhibition-room room-${treatment.name}`} id={roomId} data-chapter data-motion-section data-room-category={room.category} data-room-total={total} data-direction={direction} aria-labelledby={`${roomId}-title`} aria-roledescription="作品展场" onKeyDown={onKeyDown}>
    <div className="room-environment" aria-hidden="true"><span className="room-orbit-ring orbit-outer" /><span className="room-orbit-ring orbit-inner" /><span className="room-glow" /><span className="room-sculpture-loop" /><span className="room-grain" /></div>
    <header className="room-heading" data-reveal><span className="room-number">0{index + 1}</span><div><span className="room-eyebrow">{treatment.subtitle}</span><h2 id={`${roomId}-title`}>{room.category}</h2></div><span className="room-count">{total} 件作品 · {treatment.name === 'folio' ? '纸页剧场' : treatment.name === 'sculpture' ? '光影展台' : '星轨漫游'}</span></header>
    <div className="room-composition">
      <div className="room-artwork" onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        swiped.current = false;
        gesture.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      }} onPointerUp={event => {
        const start = gesture.current;
        gesture.current = null;
        if (!start || event.pointerId !== start.id) return;
        const horizontal = event.clientX - start.x;
        if (Math.abs(horizontal) > 45 && Math.abs(horizontal) > Math.abs(event.clientY - start.y) * 1.4) {
          swiped.current = true;
          move(currentIndex + (horizontal < 0 ? 1 : -1));
        }
      }} onPointerCancel={() => { gesture.current = null; }} onPointerLeave={() => { gesture.current = null; }} onClickCapture={event => {
        if (swiped.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); swiped.current = false; }
      }}>
        <span className="room-plinth" aria-hidden="true" />
        {treatment.name === 'orbit' && total > 1 && <div className="room-satellites" aria-hidden="true"><span className="room-satellite satellite-left"><PhotoImage key={previous.id} photo={previous.photos[0]} retry={false} /></span>{total > 2 && <span className="room-satellite satellite-right"><PhotoImage key={next.id} photo={next.photos[0]} retry={false} /></span>}</div>}
        <div className="room-object-position"><div className="room-object-float"><button type="button" className="room-product" data-tilt data-product-id={product.id} aria-label={`查看展品：${product.name}`} aria-describedby={`${roomId}-help`} onClick={() => onSelect(product)} onErrorCapture={() => setFailedId(product.id)}>
          <span className="room-sheet sheet-back" aria-hidden="true" /><span className="room-sheet sheet-middle" aria-hidden="true" />
          <span className="room-product-enter" key={product.id}><span className="room-image"><PhotoImage key={attempt} photo={product.photos[0]} detail retry={false} /></span><span className="room-image-action"><ArrowUpRight size={16} /> 查看细节</span></span>
        </button></div></div>
        <span className="room-artword" aria-hidden="true">{treatment.word}</span>
        {failedId === product.id && <button className="room-image-retry" type="button" onClick={() => { setFailedId(''); setAttempt(attempt + 1); }}><RotateCcw size={14} /> 重试展品图片</button>}
      </div>
      <div className="room-copy">
        <p className="room-motto" data-reveal>{treatment.title}</p>
        <div className="room-current-copy" key={product.id}>
          <span className="room-product-index">OBJECT {String(currentIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}{product.pinOrder !== undefined && <span>置顶</span>}</span>
          <h3>{product.name}</h3>
          <p className="room-description">{product.description || treatment.note}</p>
          <dl>{product.material && <><dt>材质</dt><dd>{product.material}</dd></>}<dt>参考价格</dt><dd>{formatPrice(product.price)}</dd></dl>
        </div>
        <button type="button" className="room-detail" onClick={() => onSelect(product)}>走近这件作品 <ArrowUpRight size={18} /></button>
        <p className="room-help" id={`${roomId}-help`}>{total > 1 ? '每 3 秒自动翻页，也可左右切换或滑动；顶部可暂停。' : '点开作品，查看完整故事。'}</p>
      </div>
    </div>
    <footer className="room-controls">
      <div className="room-step-buttons"><button type="button" className="room-prev" disabled={total < 2} aria-label={`上一件${room.category}展品`} onClick={() => move(currentIndex - 1)}><ArrowLeft size={19} /></button><button type="button" className="room-next" disabled={total < 2} aria-label={`下一件${room.category}展品`} onClick={() => move(currentIndex + 1)}><ArrowRight size={19} /></button></div>
      <label className="room-scrubber"><span>漫游{room.category} <strong>{String(currentIndex + 1).padStart(2, '0')} <i>/ {String(total).padStart(2, '0')}</i></strong></span><input type="range" min={0} max={Math.max(1, total - 1)} step={1} value={currentIndex} disabled={total < 2} onChange={event => move(Number(event.target.value))} aria-label={`选择${room.category}展品`} aria-valuetext={`第 ${currentIndex + 1} 件，共 ${total} 件：${product.name}`} /></label>
      <a className="room-next-chapter" href={`#${nextId}`}>下一幕 <ArrowDown size={17} /></a>
      <span className="visually-hidden" role="status" aria-live={automatic ? 'off' : 'polite'}>{room.category}，第 {currentIndex + 1} 件，共 {total} 件：{product.name}</span>
    </footer>
  </section>;
}

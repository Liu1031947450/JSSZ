import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Icon } from 'animal-island-ui-tailwind';
import { GripVertical } from 'lucide-react';
import { reorderProducts, sortProducts } from './catalog';
import type { Product } from './catalog';
import { PhotoImage } from './PhotoWall';

type Props = {
  products: Product[];
  sources: Record<string, string>;
  disabled: boolean;
  onReorder: (products: Product[]) => void;
  onEdit: (product: Product, trigger: HTMLElement) => void;
  onPreview: (product: Product) => void;
  onDelete: (product: Product) => void;
  onPin: (id: string) => void;
};
type Drag = { product: Product; handle: HTMLButtonElement; pointerId?: number; startX: number; startY: number; x: number; y: number; active: boolean; targetId: string; after: boolean };
const desktopQuery = '(min-width: 801px) and (hover: hover) and (pointer: fine)';

export default function WorkGrid({ products, sources, disabled, onReorder, onEdit, onPreview, onDelete, onPin }: Props) {
  const ordered = useMemo(() => sortProducts(products), [products]);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const [marker, setMarker] = useState({ id: '', targetId: '', after: false });
  const [announcement, setAnnouncement] = useState('');
  const [desktop, setDesktop] = useState(() => window.matchMedia(desktopQuery).matches);

  useEffect(() => {
    const media = window.matchMedia(desktopQuery);
    const update = () => setDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function stop(commit = false) {
    const current = drag.current;
    drag.current = null;
    cancelAnimationFrame(frame.current);
    setMarker({ id: '', targetId: '', after: false });
    if (!current) return;
    if (current.pointerId !== undefined && current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    const next = commit && current.active ? reorderProducts(products, current.product.id, current.targetId, current.after) : products;
    if (next !== products) {
      onReorder(next);
      setAnnouncement(`${current.product.name}已移到第 ${sortProducts(next).findIndex(product => product.id === current.product.id) + 1} 位，发布后同步首页`);
    } else setAnnouncement('顺序未改变');
    current.handle.focus({ preventScroll: true });
  }

  useEffect(() => {
    stop();
    return () => {
      const current = drag.current;
      drag.current = null; cancelAnimationFrame(frame.current);
      if (current?.pointerId !== undefined && current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    };
  }, [products, disabled, desktop]);

  useEffect(() => {
    const cancel = () => stop();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); stop(); } };
    const visibility = () => { if (document.hidden) stop(); };
    window.addEventListener('blur', cancel);
    window.addEventListener('hashchange', cancel);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('hashchange', cancel);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [products]);

  function showTarget(current: Drag) {
    setMarker(previous => previous.id === current.product.id && previous.targetId === current.targetId && previous.after === current.after ? previous : { id: current.product.id, targetId: current.targetId, after: current.after });
  }

  function locate(current: Drag) {
    const card = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>('[data-work-id]');
    const target = card && grid.current?.contains(card) ? products.find(product => product.id === card.dataset.workId) : undefined;
    current.targetId = target && (target.pinOrder === undefined) === (current.product.pinOrder === undefined) ? target.id : '';
    current.after = Boolean(card && current.x > card.getBoundingClientRect().left + card.getBoundingClientRect().width / 2);
    showTarget(current);
  }

  function scroll() {
    const current = drag.current;
    if (!current?.active || current.pointerId === undefined) return;
    const distance = current.y < 64 ? -Math.min(16, (64 - current.y) / 4) : current.y > innerHeight - 64 ? Math.min(16, (current.y - innerHeight + 64) / 4) : 0;
    if (distance) window.scrollTo({ top: window.scrollY + distance, behavior: 'instant' });
    locate(current);
    frame.current = requestAnimationFrame(scroll);
  }

  function start(product: Product, handle: HTMLButtonElement, pointerId?: number, x = 0, y = 0) {
    if (disabled || !desktop || drag.current) return;
    drag.current = { product, handle, pointerId, startX: x, startY: y, x, y, active: pointerId === undefined, targetId: product.id, after: false };
    if (pointerId !== undefined) handle.setPointerCapture(pointerId);
    else showTarget(drag.current);
    setAnnouncement(`正在移动${product.name}，只能在${product.pinOrder === undefined ? '普通' : '置顶'}作品内排序，方向键调整，回车确认，Esc 取消`);
  }

  function keyMove(event: React.KeyboardEvent<HTMLButtonElement>, product: Product) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (drag.current?.pointerId !== undefined) return;
      if (drag.current) stop(true);
      else start(product, event.currentTarget);
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== undefined || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const group = sortProducts(reorderProducts(products, product.id, current.targetId, current.after)).filter(item => (item.pinOrder === undefined) === (product.pinOrder === undefined));
    const position = group.findIndex(item => item.id === product.id);
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const target = group[position + direction];
    if (!target) return;
    current.targetId = target.id; current.after = direction > 0;
    showTarget(current);
    setAnnouncement(`${product.name}将移至组内第 ${position + direction + 1} 位`);
  }

  return <>
    <p className="field-help" id="work-sort-help">{desktop ? '拖动封面上的手柄调整顺序，置顶与普通作品分别排序；发布后同步首页。键盘可按空格抓取、方向键移动、回车确认、Esc 取消。' : '手机端不支持拖动排序，请在电脑端调整顺序并发布。'}</p>
    <div className="visually-hidden" role="status" aria-live="polite">{announcement}</div>
    <div className="works-grid" ref={grid}>{ordered.map(product => <Card key={product.id} data-work-id={product.id} className={`work-row${marker.id === product.id ? ' is-dragging' : ''}${marker.targetId === product.id && marker.id !== product.id ? marker.after ? ' insert-after' : ' insert-before' : ''}`}>
      <div className="work-thumbnail"><PhotoImage photo={product.photos[0]} source={sources[product.photos[0].thumbnail]} />{desktop && <Button type="text" className="work-drag-handle" disabled={disabled} aria-label={`调整顺序：${product.name}`} aria-describedby="work-sort-help" aria-pressed={marker.id === product.id} onKeyDown={event => keyMove(event, product)} onBlur={() => { if (drag.current?.pointerId === undefined) stop(); }}
        onPointerDown={event => { if (event.pointerType !== 'mouse' || event.button !== 0 || !event.isPrimary) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); start(product, event.currentTarget, event.pointerId, event.clientX, event.clientY); }}
        onPointerMove={event => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.x = event.clientX; current.y = event.clientY;
          if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) { current.active = true; frame.current = requestAnimationFrame(scroll); }
          if (current.active) locate(current);
        }}
        onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { if (drag.current.active) locate(drag.current); stop(true); } }}
        onPointerCancel={() => stop()} onLostPointerCapture={() => { if (drag.current) stop(); }}><Icon icon={GripVertical} size={20} /></Button>}</div>
      <div className="work-row-copy"><h3>{product.name}</h3><span>{product.pinOrder !== undefined ? '置顶 · ' : ''}{product.category || '未分类'} · {product.photos.length} 张照片</span><div>
        <Button size="small" type="text" disabled={disabled || Boolean(marker.id)} onClick={event => onEdit(product, event.currentTarget)}>编辑</Button>
        <Button size="small" type="text" disabled={disabled || Boolean(marker.id)} onClick={() => onPreview(product)}>预览</Button>
        <Button size="small" type="text" danger disabled={disabled || Boolean(marker.id)} onClick={() => onDelete(product)}>删除</Button>
        <Button size="small" type="text" className="work-pin-button" disabled={disabled || Boolean(marker.id)} aria-pressed={product.pinOrder !== undefined} title="发布后更新首页置顶顺序" onClick={() => onPin(product.id)}>{product.pinOrder === undefined ? '置顶' : '取消置顶'}</Button>
      </div></div>
    </Card>)}</div>
  </>;
}

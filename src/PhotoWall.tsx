import { useEffect, useRef, useState } from 'react';
import { Button, Carousel, Icon, Tag } from 'animal-island-ui-tailwind';
import { Eye, Flower, Heart, Image, Leaf, Sun, X } from 'lucide-react';
import Modal from './Modal';
import { WechatButton } from './Contact';
import type { Photo, Product } from './catalog';
import { assetUrl } from './config';

export function PhotoImage({ photo, detail = false, source, retry = true }: { photo: Photo; detail?: boolean; source?: string; retry?: boolean }) {
  const [failed, setFailed] = useState(false);
  const path = source || assetUrl(detail ? photo.src : photo.thumbnail);
  useEffect(() => setFailed(false), [path]);
  return failed ? <span className="image-failed"><span role="img" aria-label={`${photo.alt}（图片暂时无法加载）`}><Icon icon={Image} size={30} /></span><span>照片暂时走丢了</span>{retry && <Button size="small" onClick={() => setFailed(false)}>重试图片</Button>}</span> : <img src={path} alt={photo.alt} width={photo.width} height={photo.height} style={detail ? undefined : { aspectRatio: Math.max(0.7, Math.min(1.4, photo.width / photo.height)), objectFit: 'cover' }} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function ProductDetail({ product, onClose, sources = {} }: { product: Product; onClose: () => void; sources?: Record<string, string> }) {
  const [index, setIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const lightbox = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function close() {
    if (closing || lightbox.current?.open) return;
    setClosing(true);
    timer.current = setTimeout(onClose, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160);
  }
  function onLightboxKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); lightbox.current?.close(); return; }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
  }
  return <Modal open title={product.name} width={850} typewriter={false} onClose={close} className={`detail-modal ${closing ? 'is-closing' : ''}`} footer={<div className="detail-footer"><div className="detail-actions"><Button type="primary" onClick={close} icon={<Icon icon={Leaf} size={16} />}>回到作品墙</Button><WechatButton>跳转微信咨询</WechatButton></div></div>}>
    <div className="detail-layout">
      <div className="detail-gallery">
        <Carousel activeIndex={index} onChange={setIndex} autoplay={false} showArrows={product.photos.length > 1} showDots={product.photos.length > 1} aria-label="作品照片">
          {product.photos.map((photo) => <div className="detail-slide" key={photo.id}><button type="button" className="detail-photo-open" aria-label={`全屏查看：${photo.alt}`} onClick={() => lightbox.current?.showModal()}><PhotoImage photo={photo} detail source={sources[photo.src]} retry={false} /></button></div>)}
        </Carousel>
        <p className="image-caption" aria-live="polite">{String(index + 1).padStart(2, '0')} / {String(product.photos.length).padStart(2, '0')}<span>{product.photos[index]?.alt}</span></p>
        <p className="image-preview-hint"><Icon icon={Eye} size={14} /> 点击照片，全屏查看</p>
      </div>
      <div className="detail-copy">
        <span className="eyebrow">MADE WITH A LITTLE LOVE</span>
        {product.category && <Tag color="app-green" variant="soft">{product.category}</Tag>}
        <h3>{product.name}</h3>
        <p className="preserve-lines">{product.description || '一件慢慢完成的小作品，藏着认真生活的心意。'}</p>
        {(product.material || product.size) && <dl>{product.material && <><dt>材质</dt><dd>{product.material}</dd></>}{product.size && <><dt>尺寸</dt><dd>{product.size}</dd></>}</dl>}
        <div className="detail-signature"><Icon icon={Heart} size={17} /> 手作的温度，就藏在细节里。</div>
      </div>
    </div>
    <dialog ref={lightbox} className="photo-lightbox" aria-label={`${product.name}：全屏照片`} onKeyDown={onLightboxKeyDown} onClick={(event) => { if (event.target === event.currentTarget) lightbox.current?.close(); }}>
      <div className="photo-lightbox-toolbar"><span>{index + 1} / {product.photos.length}</span><Button type="text" className="photo-lightbox-close" aria-label="关闭全屏照片" onClick={() => lightbox.current?.close()} icon={<Icon icon={X} size={22} />}>关闭</Button></div>
      <div className="photo-lightbox-image"><PhotoImage key={product.photos[index].id} photo={product.photos[index]} detail source={sources[product.photos[index].src]} /></div>
      <p className="photo-lightbox-caption">{product.photos[index].alt}</p>
    </dialog>
  </Modal>;
}

export default function PhotoWall({ products }: { products: Product[] }) {
  const [selected, setSelected] = useState<Product | null>(null);
  const ordered = [...products].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  return <>
    <section className="wall-section" id="works" aria-labelledby="wall-title">
      <div className="wall-topline"><div><span className="section-dot" /><h2 id="wall-title">手作公告墙</h2><span className="count-label">{products.length} 件小小的心意</span></div><span className="wall-hint"><Icon icon={Eye} size={15} /> 点开照片，看看它的故事</span></div>
      <div className={`cork-board ${products.length ? '' : 'is-empty'}`}>
        <span className="board-screw screw-left" aria-hidden="true" /><span className="board-screw screw-right" aria-hidden="true" />
        {products.length ? <div className="photo-grid">{ordered.map((product, position) => <figure className="photo-memory" key={product.id}>
          <Button type="text" className="photo-open" aria-label={`查看作品：${product.name}`} onClick={() => setSelected(product)}><PhotoImage photo={product.photos[0]} retry={false} /></Button>
          <figcaption><div className="photo-caption-heading"><span className="photo-number">{String(position + 1).padStart(2, '0')}</span><h3>{product.name}</h3><Icon icon={Heart} size={15} /></div>{product.description && <p>{product.description}</p>}{product.category && <span className="photo-category">{product.category}</span>}</figcaption>
        </figure>)}</div> : <div className="empty-wall">
          <div className="tiny-note note-sage" aria-hidden="true"><Icon icon={Leaf} size={25} /><span>慢慢做<br />好好生活</span><i>take your time</i></div>
          <div className="empty-postcard"><span className="postcard-kicker">A NOTE FROM JIANSHI</span><div className="flower-doodle" aria-hidden="true"><Icon icon={Flower} size={76} /><span /><Icon icon={Leaf} size={25} /></div><h3>美好的手作，<br />正在慢慢发生。</h3><p>这面小小的墙，会贴上亲手做的心意。<br />等下一次见面，一起发现新的小美好。</p><div className="postcard-signature">简时手作 <Icon icon={Heart} size={15} /></div></div>
          <div className="tiny-note note-peach" aria-hidden="true"><Icon icon={Sun} size={30} /><span>留一点时间<br />给喜欢的事</span><i>little things, big love</i></div>
          <div className="board-stamp" aria-hidden="true">HANDMADE<br /><Icon icon={Heart} size={16} /><br />WITH LOVE</div>
        </div>}
        <div className="board-bottom"><span /><p><Icon icon={Leaf} size={15} /> 每一份独一无二，都值得被珍藏。</p><span /></div>
      </div>
    </section>
    {selected && <ProductDetail key={selected.id} product={selected} onClose={() => setSelected(null)} />}
  </>;
}

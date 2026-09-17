import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { Button, Icon, Modal } from 'animal-island-ui';
import { messageOf } from './catalog';
import type { Photo } from './catalog';
import { processImage, readImage } from './images';
import type { CropArea, ImageSource } from './images';

export default function ImageEditor({ file, productId, alt, onSave, onClose }: { file: File; productId: string; alt: string; onSave: (photo: Photo, assets: Record<string, Blob>) => void; onClose: () => void }) {
  const [source, setSource] = useState<ImageSource | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState('original');
  const [area, setArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    let active = true;
    let opened: ImageSource | undefined;
    mounted.current = true;
    readImage(file).then((next) => {
      opened = next;
      if (active) setSource(next);
      else { next.bitmap.close(); URL.revokeObjectURL(next.url); }
    }).catch((reason) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; mounted.current = false; if (opened) { opened.bitmap.close(); URL.revokeObjectURL(opened.url); } };
  }, [file]);
  async function save() {
    if (!source || !area || busy) return;
    setBusy(true); setError('');
    try {
      const result = await processImage(source, area, productId, alt);
      if (mounted.current) onSave(result.photo, result.assets);
    } catch (reason) { if (mounted.current) setError(messageOf(reason)); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <Modal open title="给照片留一个好看的画面" width={680} typewriter={false} maskClosable={false} className="crop-modal" onClose={() => { if (!busy) onClose(); }} footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" loading={busy} disabled={!source || !area} onClick={() => void save()} icon={<Icon name="Check" size={16} />}>{busy ? '正在处理图片' : '完成裁剪，加入作品'}</Button></>}>
    <p className="muted crop-description">拖动调整位置，双指或滑块缩放；也可聚焦画面后用方向键微调。</p>
    <div className="crop-stage" aria-busy={busy}>
      {source ? <Cropper key={aspect} image={source.url} crop={crop} zoom={zoom} aspect={aspect === 'original' ? source.width / source.height : Number(aspect)} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} maxZoom={3} keyboardStep={5} mediaProps={{ alt: '待裁剪的作品照片' }} /> : <p role="status">{error ? '图片未能打开' : '正在检查图片…'}</p>}
    </div>
    <div className="crop-controls"><label>裁剪比例<select value={aspect} onChange={(event) => { setAspect(event.target.value); setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null); }} disabled={busy}><option value="original">原比例</option><option value="1">1 : 1 方形</option><option value="0.75">3 : 4 竖版</option><option value="1.3333333333333333">4 : 3 横版</option></select></label><label>缩放 <span>{zoom.toFixed(1)}×</span><input aria-label="图片缩放" type="range" min="1" max="3" step="0.01" value={zoom} disabled={busy} onChange={(event) => setZoom(Number(event.target.value))} /></label><Button size="small" disabled={busy} onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(1); }}>重置位置</Button></div>
    <p className="field-help">仅上传处理后的图片，不保留原始照片的定位等 EXIF 信息。</p>
    {error && <div className="notice error" role="alert">{error}</div>}
  </Modal>;
}

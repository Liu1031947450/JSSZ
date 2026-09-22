import { useEffect, useRef, useState } from 'react';
import type { Product } from './catalog';
import { assetUrl } from './config';
import { PhotoImage } from './PhotoWall';

export default function ThreeGallery({ products, focusIndex, paused, onSelect }: { products: Product[]; focusIndex: number; paused: boolean; onSelect: (product: Product) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<{ update: () => void } | null>(null);
  const latest = useRef({ focusIndex, paused, onSelect });
  const [phase, setPhase] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    latest.current = { focusIndex, paused, onSelect };
    controls.current?.update();
  }, [focusIndex, paused, onSelect]);

  useEffect(() => {
    const element = host.current;
    if (!element || !products.length) return;
    let cancelled = false;
    let release = () => {};
    setPhase('loading');

    void import('three').then(THREE => {
      if (cancelled) return;
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
      camera.position.z = 14;
      const gallery = new THREE.Group();
      scene.add(gallery, new THREE.HemisphereLight(0xfff6e9, 0x9b7370, 2.8));
      const light = new THREE.DirectionalLight(0xffe0b3, 3.4);
      light.position.set(-3, 6, 8);
      scene.add(light);
      const geometries = new Set<InstanceType<typeof THREE.BufferGeometry>>();
      const materials = new Set<InstanceType<typeof THREE.Material>>();
      const textures = new Set<InstanceType<typeof THREE.Texture>>();
      const cards: { group: InstanceType<typeof THREE.Group>; baseY: number; rotation: number }[] = [];
      const surfaces: InstanceType<typeof THREE.Mesh>[] = [];
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      let disposed = false;
      let visible = true;
      let pointerX = 0;
      let pointerY = 0;
      let scrollProgress = 0;
      let elapsed = 0;
      let previous = 0;
      let measuredFrames = 0;
      let measuredTime = 0;
      let economical = false;
      let pressed: { x: number; y: number } | null = null;
      let resizeObserver: ResizeObserver | undefined;
      let intersectionObserver: IntersectionObserver | undefined;

      function fail() {
        if (disposed) return;
        release();
        if (!cancelled) setPhase('fallback');
      }
      function render(timestamp: number) {
        if (disposed) return;
        const delta = previous ? Math.min((timestamp - previous) / 1000, 0.05) : 1 / 60;
        previous = timestamp;
        const moving = !motion.matches && !latest.current.paused;
        if (moving) elapsed += delta;
        const blend = moving ? 1 - Math.exp(-delta * 6) : 1;
        gallery.rotation.y += ((moving ? pointerX * 0.09 : 0) - gallery.rotation.y) * blend;
        gallery.rotation.x += ((moving ? pointerY * 0.035 + scrollProgress * 0.06 : 0) - gallery.rotation.x) * blend;
        cards.forEach(({ group, baseY, rotation }, index) => {
          const focused = index === latest.current.focusIndex;
          const float = moving ? Math.sin(elapsed * 0.6 + index * 1.8) * 0.11 : 0;
          group.position.y = baseY + float;
          group.rotation.z = rotation + (moving ? Math.sin(elapsed * 0.35 + index) * 0.025 : 0);
          const size = group.scale.x + ((focused ? 1.09 : 1) - group.scale.x) * blend;
          group.scale.setScalar(size);
        });
        try { renderer.render(scene, camera); } catch { fail(); return; }
        if (moving && !economical && measuredFrames < 100) {
          measuredFrames += 1;
          measuredTime += delta;
          if (measuredFrames === 100 && measuredTime > 2.2) { economical = true; resize(); }
        }
      }
      function update() {
        if (disposed) return;
        renderer.setAnimationLoop(null);
        previous = 0;
        const compact = element!.clientWidth < 760;
        const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(20)) * camera.position.z;
        const viewWidth = viewHeight * camera.aspect;
        const positions = compact ? [[-0.24, 2.1], [0.24, 1.6], [-0.23, -1.6], [0.25, -2.1]] : [[-0.3, 1.8], [0.31, 1.5], [-0.37, -1.9], [0.36, -2.2], [-0.14, -3.6], [0.17, -3.7]];
        cards.forEach((card, index) => {
          const slot = compact ? (index - latest.current.focusIndex + cards.length) % cards.length : index;
          card.group.visible = slot < positions.length;
          const position = positions[slot] || [0, 0];
          card.baseY = position[1];
          card.group.position.set(position[0] * viewWidth, card.baseY, index % 2 ? -0.4 : 0);
          const frameSize = compact ? Math.min(1, viewWidth / 7.2) : Math.min(1, viewWidth / 17);
          card.group.children.forEach(child => child.scale.setScalar(frameSize));
        });
        const inView = visible && !document.hidden;
        const moving = inView && !motion.matches && !latest.current.paused;
        element!.dataset.rendering = moving ? 'active' : inView ? 'paused' : 'hidden';
        if (inView) render(performance.now());
        if (moving && !disposed) renderer.setAnimationLoop(render);
      }
      function resize() {
        if (disposed) return;
        const width = element!.clientWidth;
        const height = element!.clientHeight;
        if (!width || !height) return;
        const compact = width < 760;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, economical ? 0.8 : compact ? 1.25 : 1.6, Math.sqrt(1_800_000 / (width * height))));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        update();
      }
      function hit(event: PointerEvent) {
        const bounds = element!.getBoundingClientRect();
        pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects(surfaces.filter(surface => surface.parent?.visible), false)[0]?.object.userData.product as Product | undefined;
      }
      function pointerMove(event: PointerEvent) {
        if (event.pointerType === 'touch') return;
        const product = hit(event);
        pointerX = pointer.x;
        pointerY = pointer.y;
        element!.style.cursor = product ? 'pointer' : '';
      }
      function pointerLeave() { pointerX = 0; pointerY = 0; pressed = null; element!.style.cursor = ''; }
      function pointerDown(event: PointerEvent) { if (event.button === 0) pressed = { x: event.clientX, y: event.clientY }; }
      function pointerUp(event: PointerEvent) {
        if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 8) {
          const product = hit(event);
          if (product) latest.current.onSelect(product);
        }
        pressed = null;
      }
      function onScroll() { scrollProgress = Math.max(0, Math.min(1, -element!.getBoundingClientRect().top / element!.clientHeight)); }
      function onContextLost(event: Event) { event.preventDefault(); fail(); }

      release = () => {
        if (disposed) return;
        disposed = true;
        controls.current = null;
        renderer.setAnimationLoop(null);
        resizeObserver?.disconnect();
        intersectionObserver?.disconnect();
        motion.removeEventListener('change', update);
        document.removeEventListener('visibilitychange', update);
        window.removeEventListener('scroll', onScroll);
        element.removeEventListener('pointermove', pointerMove);
        element.removeEventListener('pointerleave', pointerLeave);
        element.removeEventListener('pointerdown', pointerDown);
        element.removeEventListener('pointerup', pointerUp);
        element.removeEventListener('pointercancel', pointerLeave);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
        textures.forEach(texture => texture.dispose());
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        element.dataset.rendering = 'stopped';
      };

      const frameGeometry = new THREE.BoxGeometry(2.28, 2.82, 0.12);
      const photoGeometry = new THREE.PlaneGeometry(2.04, 2.44);
      const ringGeometry = new THREE.TorusGeometry(0.62, 0.018, 6, 64);
      const pearlGeometry = new THREE.SphereGeometry(0.15, 16, 12);
      [frameGeometry, photoGeometry, ringGeometry, pearlGeometry].forEach(geometry => geometries.add(geometry));
      const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xfff9eb, roughness: 0.64, metalness: 0.15 });
      const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xd5a55b, metalness: 0.65, roughness: 0.3 });
      materials.add(frameMaterial); materials.add(goldMaterial);
      const loader = new THREE.TextureLoader();
      let loaded = 0;
      products.forEach((product, index) => {
        const group = new THREE.Group();
        const rotation = [-0.17, 0.16, 0.12, -0.14, -0.08, 0.12][index] || 0;
        group.rotation.set(index % 2 ? -0.12 : 0.08, index % 2 ? -0.22 : 0.22, rotation);
        const frame = new THREE.Mesh(frameGeometry, frameMaterial);
        const photo = product.photos[0];
        const texture = loader.load(assetUrl(photo.thumbnail), loadedTexture => {
          if (disposed || cancelled) { loadedTexture.dispose(); return; }
          loaded += 1;
          if (loaded === products.length) { setPhase('ready'); update(); }
        }, undefined, fail);
        textures.add(texture);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        const ratio = photo.width / photo.height;
        const target = 2.04 / 2.44;
        texture.repeat.set(Math.min(1, target / ratio), Math.min(1, ratio / target));
        texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
        const photoMaterial = new THREE.MeshBasicMaterial({ map: texture });
        materials.add(photoMaterial);
        const image = new THREE.Mesh(photoGeometry, photoMaterial);
        image.position.set(0, 0.06, 0.065);
        image.userData.product = product;
        frame.userData.product = product;
        group.add(frame, image);
        gallery.add(group);
        surfaces.push(frame, image);
        cards.push({ group, baseY: 0, rotation });
      });
      for (let index = 0; index < 5; index += 1) {
        const ornament = new THREE.Mesh(index % 2 ? ringGeometry : pearlGeometry, goldMaterial);
        ornament.position.set([-5.7, 3.5, -3.3, -4, 5.7][index], [0, 3.2, 3.7, -3.1, -0.5][index], 1);
        ornament.rotation.set(0.3, 0.4, 0.6);
        gallery.add(ornament);
      }
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      element.appendChild(renderer.domElement);
      controls.current = { update };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(element);
      intersectionObserver = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }, { threshold: 0.05 });
      intersectionObserver.observe(element);
      motion.addEventListener('change', update);
      document.addEventListener('visibilitychange', update);
      window.addEventListener('scroll', onScroll, { passive: true });
      element.addEventListener('pointermove', pointerMove);
      element.addEventListener('pointerleave', pointerLeave);
      element.addEventListener('pointerdown', pointerDown);
      element.addEventListener('pointerup', pointerUp);
      element.addEventListener('pointercancel', pointerLeave);
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      resize();
    }).catch(() => { release(); if (!cancelled) setPhase('fallback'); });

    return () => { cancelled = true; release(); };
  }, [products, attempt]);

  return <>
    <div className={`exhibition-scene scene-${phase}`} ref={host} data-scene-state={products.length ? phase : 'empty'}>
      <div className="exhibition-fallback" aria-hidden="true">{products.map(product => <figure key={product.id}><PhotoImage photo={product.photos[0]} retry={false} /></figure>)}</div>
    </div>
    {phase === 'fallback' && <div className="exhibition-scene-notice" role="status">已切换为静态展览，作品仍可正常浏览。<button type="button" onClick={() => setAttempt(attempt + 1)}>重试 3D</button></div>}
  </>;
}

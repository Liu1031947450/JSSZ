import { useEffect, type RefObject } from 'react';

export default function useExhibitionMotion(root: RefObject<HTMLDivElement | null>, paused: boolean) {
  useEffect(() => {
    const page = root.current;
    if (!page) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const observed = new Set<HTMLElement>();
    const visibleLayers = new Set<HTMLElement>();
    const animations = new Set<Animation>();
    let running = false;
    let frame = 0;
    let hovered: HTMLElement | null = null;
    let pointer: { target: HTMLElement; x: number; y: number } | null = null;

    function resetTilt() {
      hovered?.style.removeProperty('--tilt-x');
      hovered?.style.removeProperty('--tilt-y');
      hovered?.style.removeProperty('--shine-x');
      hovered = null;
    }

    function update() {
      frame = 0;
      const viewport = window.innerHeight;
      const bounds = page!.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -bounds.top / Math.max(1, bounds.height - viewport)));
      const sections = [...page!.querySelectorAll<HTMLElement>('[data-chapter]')];
      const current = sections.filter(section => section.getBoundingClientRect().top <= viewport * 0.45).at(-1);
      const layouts = [...visibleLayers].map(element => ({ element, bounds: element.getBoundingClientRect() }));
      const tiltBounds = pointer?.target.getBoundingClientRect();
      page!.style.setProperty('--reading-progress', String(progress));
      page!.querySelectorAll<HTMLAnchorElement>('.exhibition-index a').forEach(link => {
        if (link.hash === `#${current?.id}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      for (const { element, bounds: layerBounds } of layouts) {
        const offset = running ? Math.max(-1, Math.min(1, (viewport / 2 - layerBounds.top - layerBounds.height / 2) / (viewport / 2 + layerBounds.height / 2))) : 0;
        element.style.setProperty('--scroll-offset', offset.toFixed(4));
      }
      if (running && pointer && tiltBounds) {
        if (hovered !== pointer.target) resetTilt();
        hovered = pointer.target;
        const horizontal = (pointer.x - tiltBounds.left) / tiltBounds.width;
        const vertical = (pointer.y - tiltBounds.top) / tiltBounds.height;
        hovered.style.setProperty('--tilt-x', `${(0.5 - vertical) * 7}deg`);
        hovered.style.setProperty('--tilt-y', `${(horizontal - 0.5) * 9}deg`);
        hovered.style.setProperty('--shine-x', `${horizontal * 100}%`);
      }
      pointer = null;
    }

    function schedule() { if (!frame) frame = requestAnimationFrame(update); }

    const observer = new IntersectionObserver(entries => {
      let delay = 0;
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (element.hasAttribute('data-motion-section')) {
          element.dataset.inView = String(entry.isIntersecting);
          if (entry.isIntersecting) visibleLayers.add(element);
          else visibleLayers.delete(element);
        }
        if (entry.isIntersecting && !element.dataset.revealed && element.hasAttribute('data-reveal')) {
          element.dataset.revealed = 'true';
          if (running && !element.contains(document.activeElement)) {
            const animation = element.animate([
              { opacity: 0, translate: '0 36px' },
              { opacity: 1, translate: '0 0' },
            ], { duration: 720, delay: Math.min(delay++ * 65, 260), easing: 'cubic-bezier(.2,.65,.25,1)', fill: 'backwards' });
            animations.add(animation);
            animation.onfinish = animation.oncancel = () => animations.delete(animation);
          }
          if (!element.hasAttribute('data-motion-section')) observer.unobserve(element);
        }
      }
      schedule();
    }, { threshold: 0.06 });

    function discover() {
      for (const element of observed) {
        if (!element.isConnected) { observer.unobserve(element); observed.delete(element); visibleLayers.delete(element); }
      }
      page!.querySelectorAll<HTMLElement>('[data-reveal], [data-motion-section]').forEach(element => {
        if (!observed.has(element)) { observed.add(element); observer.observe(element); }
      });
      schedule();
    }

    function syncMotion() {
      running = !paused && !reducedMotion.matches && !document.hidden && !document.querySelector('.detail-modal');
      page!.dataset.motion = running ? 'on' : 'off';
      if (!running) {
        animations.forEach(animation => animation.cancel());
        observed.forEach(element => element.style.removeProperty('--scroll-offset'));
        pointer = null;
        resetTilt();
      }
      schedule();
    }

    function onPointerMove(event: PointerEvent) {
      if (!running || !finePointer.matches || event.pointerType !== 'mouse') return;
      const target = (event.target as Element).closest<HTMLElement>('[data-tilt]');
      if (!target) { pointer = null; resetTilt(); return; }
      pointer = { target, x: event.clientX, y: event.clientY };
      schedule();
    }
    function onPointerLeave() { pointer = null; resetTilt(); }
    function onFocus(event: FocusEvent) {
      const target = (event.target as Element).closest('[data-reveal]');
      target?.getAnimations().forEach(animation => animation.cancel());
    }

    const contentObserver = new MutationObserver(discover);
    contentObserver.observe(page, { childList: true, subtree: true });
    const modalObserver = new MutationObserver(syncMotion);
    modalObserver.observe(document.body, { childList: true, attributes: true, attributeFilter: ['style'] });
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(page);
    syncMotion();
    discover();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', syncMotion);
    reducedMotion.addEventListener('change', syncMotion);
    page.addEventListener('pointermove', onPointerMove, { passive: true });
    page.addEventListener('pointerleave', onPointerLeave);
    page.addEventListener('focusin', onFocus);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      contentObserver.disconnect();
      modalObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', syncMotion);
      reducedMotion.removeEventListener('change', syncMotion);
      page.removeEventListener('pointermove', onPointerMove);
      page.removeEventListener('pointerleave', onPointerLeave);
      page.removeEventListener('focusin', onFocus);
      animations.forEach(animation => animation.cancel());
      observed.forEach(element => element.style.removeProperty('--scroll-offset'));
      page.dataset.motion = 'off';
      resetTilt();
    };
  }, [root, paused]);
}

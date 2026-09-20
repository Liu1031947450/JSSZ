import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Modal as IslandModal } from 'animal-island-ui-tailwind';

export default function Modal({ fitViewport = false, ...props }: ComponentProps<typeof IslandModal> & { fitViewport?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [trigger] = useState(() => {
    if (document.activeElement !== document.body) return document.activeElement;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    return dialogs[dialogs.length - 1] || document.activeElement;
  });
  useEffect(() => () => {
    setTimeout(() => {
      if (!dialog.current?.isConnected && trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    }, 0);
  }, [trigger, props.open]);
  useEffect(() => {
    if (!fitViewport || !props.open) return;
    const viewport = window.visualViewport;
    const resize = () => {
      dialog.current?.style.setProperty('--editor-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      dialog.current?.style.setProperty('--editor-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); window.removeEventListener('resize', resize); };
  }, [fitViewport, props.open]);
  return <IslandModal {...props} ref={dialog} />;
}

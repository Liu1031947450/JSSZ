import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { Modal as IslandModal } from 'animal-island-ui-tailwind';

export default function Modal(props: ComponentProps<typeof IslandModal>) {
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
  return <IslandModal {...props} ref={dialog} />;
}

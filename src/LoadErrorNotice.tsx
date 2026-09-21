import type { ReactNode } from 'react';
import { Button, Icon } from 'animal-island-ui-tailwind';
import { ArrowRightLeft, RotateCw, Wifi } from 'lucide-react';

export function getBackupSiteUrl(hostname: string) {
  if (hostname === 'liu1031947450.github.io') return 'https://jssz.pages.dev/';
  if (hostname === 'jssz.pages.dev') return 'https://liu1031947450.github.io/JSSZ/';
  return '';
}

export default function LoadErrorNotice({ children, detail, loading = false, onRetry }: { children: ReactNode; detail?: string; loading?: boolean; onRetry: () => void }) {
  const backupUrl = getBackupSiteUrl(window.location.hostname);
  return <div className="notice error load-error-notice" role="alert"><Icon icon={Wifi} size={19} /><span>{children}{detail && <small>{detail}</small>}</span><div className="load-error-actions"><Button size="small" onClick={onRetry} disabled={loading} icon={<Icon icon={RotateCw} size={16} />}>重新加载</Button>{backupUrl && <a className="backup-site-link" href={backupUrl} title={backupUrl}><Icon icon={ArrowRightLeft} size={16} />前往备用站</a>}</div></div>;
}

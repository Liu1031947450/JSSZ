import { useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, NotificationView } from 'animal-island-ui-tailwind';
import type { NotificationItem } from 'animal-island-ui-tailwind';

const wechatNumber = 'JS-200sz';

export function WechatButton({ className, children = '微信' }: { className?: string; children?: ReactNode }) {
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<NotificationItem | null>(null);
  async function copyWechat(event: React.MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget;
    setCopying(true); setNotice(null);
    let copied = false;
    try {
      await navigator.clipboard.writeText(wechatNumber);
      copied = true;
    } catch {
      const input = document.createElement('textarea');
      input.value = wechatNumber;
      input.readOnly = true;
      input.className = 'visually-hidden';
      button.parentElement?.append(input);
      try { input.select(); copied = document.execCommand('copy'); }
      catch { copied = false; }
      finally { input.remove(); button.focus({ preventScroll: true }); }
    }
    const createdAt = Date.now();
    setNotice({ key: String(createdAt), createdAt, type: copied ? 'success' : 'error', position: 'top', placement: 'top', duration: copied ? 4 : 0, message: copied ? '微信号复制成功！打开微信搜索添加' : `复制失败，请手动复制微信号：${wechatNumber}`, className: 'contact-notification' });
    setCopying(false);
  }
  return <>
    <Button type="primary" className={className} aria-label={typeof children === 'string' ? children : '复制微信号'} title={`复制微信号：${wechatNumber}`} loading={copying} onClick={(event) => void copyWechat(event)} icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3C4.6 3 1 5.8 1 9.3c0 2 1.2 3.8 3.1 5l-.8 2.6 3-1.5c.9.2 1.8.3 2.7.3h.6a6.7 6.7 0 0 1-.4-2.2c0-3.8 3.5-6.8 7.8-6.8h.2C16 4.5 12.8 3 9 3Zm-3 4.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm6 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" /><path d="M23 13.5c0-3-2.7-5.5-6-5.5s-6 2.5-6 5.5 2.7 5.5 6 5.5c.7 0 1.4-.1 2-.3l2.4 1.3-.6-2.2c1.3-1 2.2-2.5 2.2-4.3Zm-8.2-.8a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Zm4.4 0a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6Z" /></svg>}>{children}</Button>
    {notice && createPortal(<div className="animal-notification-root" role={notice.type === 'success' ? 'status' : 'alert'} aria-live={notice.type === 'success' ? 'polite' : 'assertive'} aria-atomic="true"><div className="animal-notification-group animal-notification-group-top"><NotificationView key={notice.key} item={notice} onRemove={() => setNotice(null)} /></div></div>, document.body)}
  </>;
}

export default function ContactLinks({ className = 'footer-contacts' }: { className?: string }) {
  return <div className={`contact-links ${className}`} role="group" aria-label="联系我">
    <span className="contact-label">联系我</span>
    <a className="contact-link contact-douyin" href="https://v.douyin.com/5DgnKMqN27g/" target="_blank" rel="noopener noreferrer" aria-label="打开抖音个人主页" title="抖音 · 简时手作"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="3" aria-hidden="true"><path d="M14 3v12.5a4 4 0 1 1-4-4M14 3c0 4 3 6 6 6" stroke="#25b9bf" transform="translate(-1 -.5)" /><path d="M14 3v12.5a4 4 0 1 1-4-4M14 3c0 4 3 6 6 6" stroke="#e95775" transform="translate(1 .5)" /><path d="M14 3v12.5a4 4 0 1 1-4-4M14 3c0 4 3 6 6 6" stroke="currentColor" /></svg></a>
    <a className="contact-link contact-xiaohongshu" href="https://xhslink.cn/o/9KyCVFtZBCC" target="_blank" rel="noopener noreferrer" aria-label="打开小红书个人主页" title="小红书 · 简时手作"><svg width="34" height="26" viewBox="0 0 48 36" aria-hidden="true"><rect width="48" height="36" rx="11" fill="currentColor" /><text x="24" y="23" textAnchor="middle" fontSize="14" fontWeight="800" fill="white">小红书</text></svg></a>
    <a className="contact-link contact-kuaishou" href="https://live.kuaishou.com/profile/3x4wrxmmgvrfqz4" target="_blank" rel="noopener noreferrer" aria-label="打开快手个人主页" title="快手 · 简时手作"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6.5" cy="5" r="3" /><circle cx="16" cy="5" r="4" /><rect x="3.5" y="11" width="14" height="10" rx="3" /><path d="m17.5 14 4-2v8l-4-2M8 15v2M12 15v2" /></svg></a>
    <WechatButton className="contact-link contact-wechat"><span className="visually-hidden">复制微信号</span></WechatButton>
  </div>;
}

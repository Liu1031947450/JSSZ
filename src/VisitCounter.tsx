import { useEffect, useState } from 'react';
import { counterUrl } from './config';
import { fetchTotal, getVisitorId, lastCounted, markCounted, reportVisit, shouldCount } from './visitCount';

/** 页脚访问计数：接口未配置或加载失败时不渲染任何内容，静默降级。 */
export default function VisitCounter() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!counterUrl) return;
    let active = true;
    const show = (value: number | null) => { if (active && value !== null) setCount(value); };
    (async () => {
      if (shouldCount(lastCounted())) {
        const vid = getVisitorId();
        const reported = vid ? await reportVisit(counterUrl, vid) : await fetchTotal(counterUrl);
        if (vid && reported !== null) markCounted();
        show(reported);
      } else {
        show(await fetchTotal(counterUrl));
      }
    })();
    return () => { active = false; };
  }, []);
  if (count === null) return null;
  return <small className="visit-counter">已有 {count.toLocaleString('zh-CN')} 次到访</small>;
}

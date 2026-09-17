import type { Draft } from './catalog.ts';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('此浏览器不支持 IndexedDB，无法安全保存草稿')); return; }
    const request = indexedDB.open('jianshi-handmade', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开草稿存储，请检查浏览器隐私设置'));
    request.onblocked = () => reject(new Error('草稿数据库被其他页面占用，请关闭旧页面后重试'));
  });
}

export async function loadDraft(key: string): Promise<Draft | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readonly');
    const request = transaction.objectStore('drafts').get(key);
    transaction.oncomplete = () => { database.close(); resolve(request.result as Draft | undefined); };
    transaction.onabort = () => { database.close(); reject(new Error('草稿读取失败；未覆盖原草稿')); };
  });
}

export async function saveDraft(key: string, draft: Draft): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction('drafts', 'readwrite');
      transaction.objectStore('drafts').put(draft, key);
    } catch {
      database.close(); reject(new Error('草稿无法写入，请检查浏览器可用空间；当前内容尚未保存')); return;
    }
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onabort = () => { database.close(); reject(new Error('本机空间不足或草稿写入失败，当前更改尚未保存，请勿关闭页面')); };
  });
}

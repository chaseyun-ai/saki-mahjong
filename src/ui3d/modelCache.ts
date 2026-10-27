// 下载过的模型存在浏览器本地（IndexedDB），下次打开直接读，不用再下载。
// 文件名就是钥匙：模型更新时换新文件名（.v2、.v3……），旧文件由 forgetOthers 删掉。
// 浏览器不让存（无痕模式、空间不够、被禁用）时什么都不做，照常下载。

const DB_NAME = 'saki-mahjong';
const STORE = 'models';
// 有的环境打开数据库既不成功也不报错，等这么久还没开就当用不了
const OPEN_TIMEOUT_MS = 1500;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), OPEN_TIMEOUT_MS);
    const done = (db: IDBDatabase | null) => {
      clearTimeout(timer);
      resolve(db);
    };
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      req.onblocked = () => done(null);
    } catch {
      done(null);
    }
  });
  return dbPromise;
}

function request<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = make(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function loadCached(key: string): Promise<ArrayBuffer | null> {
  const v = await request('readonly', (s) => s.get(key));
  return v instanceof ArrayBuffer ? v : null;
}

export async function saveCached(key: string, data: ArrayBuffer): Promise<void> {
  await request('readwrite', (s) => s.put(data, key));
}

// 只留下 keep 里的文件，别的（旧版本的模型）删掉
export async function forgetOthers(keep: string[]): Promise<void> {
  const keys = await request('readonly', (s) => s.getAllKeys());
  for (const k of keys ?? []) {
    if (!keep.includes(String(k))) await request('readwrite', (s) => s.delete(k));
  }
}

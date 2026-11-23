import type { Entry } from './slots';

// 玩家自己导入的素材：只存在这个浏览器里（IndexedDB），不影响别人，也不改游戏文件。
// 一条一个格子：钥匙是 <主人>/<格子>，存文件内容（ArrayBuffer）和清单里的那些说明。
// 总开关“用我导入的素材”记在 localStorage，关掉就是原版（东西还留着，再打开就回来）。
// 浏览器不让存（无痕模式、空间不够、被禁用）时：读出来是空的，存的时候告诉调用的人没存成。
// 背景音乐不放这里，放 musicStore.ts（声音设置里换曲用的就是它），两边换的是同一份。

export interface Mine {
  owner: string;
  slot: string;
  entry: Entry;
  data: ArrayBuffer;
}

const DB_NAME = 'saki-mahjong-mine';
const STORE = 'files';
const ON_KEY = 'saki-mine-on';
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

function request<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: boolean; value: T | null }> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve({ ok: false, value: null });
        try {
          const tx = db.transaction(STORE, mode);
          const req = make(tx.objectStore(STORE));
          let value: T | null = null;
          req.onsuccess = () => (value = req.result);
          // 写的要等整个事务落盘才算存好（空间不够会在这里报）
          tx.oncomplete = () => resolve({ ok: true, value });
          tx.onerror = () => resolve({ ok: false, value: null });
          tx.onabort = () => resolve({ ok: false, value: null });
        } catch {
          resolve({ ok: false, value: null });
        }
      }),
  );
}

const keyOf = (owner: string, slot: string) => `${owner}/${slot}`;

export async function listMine(): Promise<Mine[]> {
  const { value } = await request('readonly', (s) => s.getAll());
  return ((value as Mine[] | null) ?? []).filter((m) => m && typeof m.owner === 'string' && typeof m.slot === 'string' && m.data instanceof ArrayBuffer && m.entry);
}

// 存好了返回 true
export async function putMine(m: Mine): Promise<boolean> {
  return (await request('readwrite', (s) => s.put(m, keyOf(m.owner, m.slot)))).ok;
}

export async function deleteMine(owner: string, slot: string): Promise<boolean> {
  return (await request('readwrite', (s) => s.delete(keyOf(owner, slot)))).ok;
}

export async function clearMine(): Promise<boolean> {
  return (await request('readwrite', (s) => s.clear())).ok;
}

// 这个浏览器能不能存（素材页上提示用）
export async function mineAvailable(): Promise<boolean> {
  return !!(await openDb());
}

// 这一次打开页面里拨过的开关（localStorage 存不了时靠它）
let onNow: boolean | null = null;

export function mineEnabled(): boolean {
  if (onNow !== null) return onNow;
  try {
    return localStorage.getItem(ON_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setMineEnabled(on: boolean): void {
  onNow = on;
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0');
  } catch {
    // 存不了就只管这一次
  }
}

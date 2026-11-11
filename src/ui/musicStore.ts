import { MusicSlot, MUSIC_SLOTS } from './musicTracks';

// 玩家自己换上的曲子，和每个格子的单曲音量。都只记在这个浏览器里：
// 曲子文件放 IndexedDB（几 MB 一首，localStorage 放不下），文件名和音量放 localStorage。
// 浏览器不让存（无痕模式、空间不够）时：换曲这一次照样能听，刷新就没了。

export interface SlotMeta {
  // 单曲音量：0 到 1.5，1 是原样
  vol: number;
  // 换上的文件名；没换过是 null，放内置的
  custom: string | null;
  // 换曲的时间：同一个格子换了别的文件，播放那边靠它认出来是新的
  stamp: number;
}

const KEY = 'saki-music-slots';
const DB_NAME = 'saki-music';
const STORE = 'tracks';
const OPEN_TIMEOUT_MS = 1500;
// 一首最多这么大：解码以后是它的十倍左右，再大手机上吃不消
export const MAX_TRACK_BYTES = 20 * 1024 * 1024;
export const MAX_SLOT_VOL = 1.5;

const fresh = (): SlotMeta => ({ vol: 1, custom: null, stamp: 0 });

function loadMeta(): Record<MusicSlot, SlotMeta> {
  const out = Object.fromEntries(MUSIC_SLOTS.map((s) => [s.id, fresh()])) as Record<MusicSlot, SlotMeta>;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Record<MusicSlot, Partial<SlotMeta>>> | null;
    if (saved && typeof saved === 'object') {
      for (const { id } of MUSIC_SLOTS) {
        const m = saved[id];
        if (!m || typeof m !== 'object') continue;
        if (typeof m.vol === 'number' && Number.isFinite(m.vol)) out[id].vol = clampVol(m.vol);
        if (typeof m.custom === 'string' && m.custom) out[id].custom = m.custom;
        if (typeof m.stamp === 'number' && Number.isFinite(m.stamp)) out[id].stamp = m.stamp;
      }
    }
  } catch {
    // 读不到：全用默认的
  }
  return out;
}

const clampVol = (v: number) => Math.min(MAX_SLOT_VOL, Math.max(0, v));

const meta = loadMeta();
// 这一次打开页面换上的曲子：存不进 IndexedDB 时靠它还能听
const session = new Map<MusicSlot, ArrayBuffer>();
const listeners = new Set<(slot: MusicSlot) => void>();

function saveMeta(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    // 存不了就只管这一次
  }
}

function changed(slot: MusicSlot): void {
  saveMeta();
  for (const f of [...listeners]) f(slot);
}

export const slotMeta = (slot: MusicSlot): Readonly<SlotMeta> => meta[slot];

// 换了曲子、清了曲子、改了单曲音量就叫一声；返回的函数用来取消
export function onMusicStore(cb: (slot: MusicSlot) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setSlotVol(slot: MusicSlot, vol: number): void {
  const v = clampVol(Number(vol) || 0);
  if (meta[slot].vol === v) return;
  meta[slot].vol = v;
  changed(slot);
}

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

// 这个格子换上的曲子文件；没换过、或者浏览器把它清掉了是 null
export async function customTrack(slot: MusicSlot): Promise<ArrayBuffer | null> {
  if (!meta[slot].custom) return null;
  const held = session.get(slot);
  if (held) return held;
  const v = await request('readonly', (s) => s.get(slot));
  return v instanceof ArrayBuffer ? v : null;
}

// 换曲：记下文件。data 留一份在手上（这一次打开页面都能放），另一份存进浏览器
export async function setCustomTrack(slot: MusicSlot, name: string, data: ArrayBuffer): Promise<void> {
  session.set(slot, data);
  meta[slot].custom = name || '自己的曲子';
  meta[slot].stamp = Date.now();
  changed(slot);
  await request('readwrite', (s) => s.put(data, slot));
}

// 清除：回到内置的（内置的也没有就是空的）
export async function clearCustomTrack(slot: MusicSlot): Promise<void> {
  if (!meta[slot].custom) return;
  session.delete(slot);
  meta[slot].custom = null;
  meta[slot].stamp = Date.now();
  changed(slot);
  await request('readwrite', (s) => s.delete(slot));
}

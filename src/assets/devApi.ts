/// <reference types="vite/client" />
import type { Entry } from './slots';

// 素材页和本地开发服务器（scripts/vite-custom-assets.ts）说话：写进项目的 public/custom/。
// 打包、发布的网页里没有这个服务器，devAvailable() 是 false，素材页就不显示「写进项目」。

const HEAD = { 'x-saki-custom': '1' };

let alive: Promise<boolean> | null = null;
export function devAvailable(): Promise<boolean> {
  if (!import.meta.env.DEV) return Promise.resolve(false);
  alive ??= fetch('/__custom/ping', { headers: HEAD })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => !!j?.ok)
    .catch(() => false);
  return alive;
}

async function reply(r: Response): Promise<void> {
  if (r.ok) return;
  const j = await r.json().catch(() => null);
  throw new Error(j?.error ?? `开发服务器没写成（${r.status}）`);
}

export async function devPut(owner: string, slot: string, entry: Entry, data: Uint8Array): Promise<void> {
  const q = new URLSearchParams({ owner, slot });
  await reply(await fetch(`/__custom/file?${q}`, { method: 'PUT', headers: { ...HEAD, 'x-saki-entry': encodeURIComponent(JSON.stringify(entry)) }, body: data as BodyInit }));
}

export async function devDelete(owner: string, slot: string): Promise<void> {
  const q = new URLSearchParams({ owner, slot });
  await reply(await fetch(`/__custom/file?${q}`, { method: 'DELETE', headers: HEAD }));
}

// 项目的 public/music 里有哪几首（背景音乐写进项目时放那里）
export async function devMusic(): Promise<string[]> {
  try {
    const r = await fetch('/__custom/music', { headers: HEAD });
    const j = r.ok ? await r.json() : null;
    return Array.isArray(j?.slots) ? j.slots.filter((s: unknown) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

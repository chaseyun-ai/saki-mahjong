import { type SkinArt, type SkinSlot, type Skins, setHandOverride, setModelOverrides, setSkinLayer } from '../ui3d/looks';
import { type LineSource, setCustomVoices } from '../ui/voice';
import { type SfxName, setCustomSfx } from '../ui/customSfx';
import { GLOBAL, MUSIC, type Entry, type Manifest, emptyManifest, parseManifest, voiceKey } from './slots';
import { type Mine, listMine, mineEnabled } from './store';

// 把导入的素材接到游戏里。两层：
//   project：项目里的 public/custom/manifest.json（素材导入在本地开发时写进项目，提交以后跟着游戏发布，人人都有）
//   mine：玩家自己导入、存在这个浏览器里的（总开关关了就不接）
// 两层都没有时什么都不做，游戏照原样。背景音乐不经过这里（换曲直接存进 musicStore，播放那边自己读）。

export const PROJECT_DIR = 'custom/';
export const PROJECT_MANIFEST = PROJECT_DIR + 'manifest.json';

export interface Placed {
  owner: string;
  slot: string;
  entry: Entry;
  url: string;
}

let project: Manifest = emptyManifest();
let mine: Mine[] = [];
let mineUrls = new Map<string, string>();
const listeners = new Set<() => void>();

const keyOf = (owner: string, slot: string) => `${owner}/${slot}`;

function projectPlaced(): Placed[] {
  const out: Placed[] = [];
  for (const [owner, slots] of Object.entries(project.assets)) {
    for (const [slot, entry] of Object.entries(slots)) out.push({ owner, slot, entry, url: PROJECT_DIR + entry.file.split('/').map(encodeURIComponent).join('/') });
  }
  return out;
}

function minePlaced(): Placed[] {
  return mine.map((m) => ({ owner: m.owner, slot: m.slot, entry: m.entry, url: mineUrls.get(keyOf(m.owner, m.slot)) ?? '' })).filter((p) => p.url);
}

export const projectAssets = (): Placed[] => projectPlaced();
export const mineAssets = (): Placed[] => minePlaced();
export const mineRecords = (): Mine[] => mine;
export const projectManifest = (): Manifest => project;

// 一层素材推给游戏的各个部分
function push(layer: 'mine' | 'project', placed: Placed[]): void {
  const skins: Skins = {};
  const models: Record<string, string> = {};
  const voices: Record<string, Record<string, LineSource>> = {};
  const sfx: Partial<Record<SfxName, string>> = {};
  let hand: string | null = null;
  for (const p of placed) {
    if (p.owner === MUSIC) continue;
    if (p.owner === GLOBAL) {
      if (p.slot === 'hand') hand = p.url;
      else if (p.slot.startsWith('sfx-')) sfx[p.slot.slice(4) as SfxName] = p.url;
      continue;
    }
    if (p.slot === 'model') {
      models[p.owner] = p.url;
      continue;
    }
    const line = voiceKey(p.slot);
    if (line) {
      const url = p.url;
      (voices[p.owner] ??= {})[line] = { sig: `${layer}:${url}:${p.entry.size}`, load: () => fetch(url).then((r) => (r.ok ? r.arrayBuffer().then((b) => new Uint8Array(b)) : null)) };
      continue;
    }
    if (p.entry.media === 'image' || p.entry.media === 'video') {
      const art: SkinArt = { url: p.url, w: p.entry.w ?? 3, h: p.entry.h ?? 4, ...(p.entry.media === 'video' ? { video: true } : {}) };
      (skins[p.owner] ??= {})[p.slot as SkinSlot] = art;
    }
  }
  setSkinLayer(layer, skins);
  setModelOverrides(layer, models);
  setHandOverride(layer, hand);
  setCustomVoices(layer, voices);
  setCustomSfx(layer, sfx);
}

function changed(): void {
  for (const f of [...listeners]) f();
}

// 换了素材就叫一声（牌局里重画头像框，选人页重画一遍）；返回的函数用来取消
export function onCustomAssets(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// 重新读项目里的清单（素材导入写进项目以后）。文件不在（大多数情况）就是空的
export async function reloadProject(): Promise<void> {
  let next = emptyManifest();
  try {
    const r = await fetch(PROJECT_MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) next = parseManifest(await r.json()) ?? emptyManifest();
  } catch {
    // 没有清单、读不出来：当没有
  }
  // 一直都没有（大多数情况）就不叫，免得白白重画
  const same = !Object.keys(project.assets).length && !Object.keys(next.assets).length;
  project = next;
  push('project', projectPlaced());
  if (!same) changed();
}

// 重新读浏览器里的（导入、删除以后，拨了总开关以后）。总开关关着时素材页照样列出来，只是不接到游戏里
export async function reloadMine(): Promise<void> {
  const next = await listMine();
  for (const url of mineUrls.values()) URL.revokeObjectURL(url);
  mineUrls = new Map(next.map((m) => [keyOf(m.owner, m.slot), URL.createObjectURL(new Blob([m.data], { type: m.entry.mime }))]));
  const same = !mine.length && !next.length;
  mine = next;
  push('mine', mineEnabled() ? minePlaced() : []);
  if (!same) changed();
}

// 打开页面时读一次。不会抛错：读不到的那层就是空的
let started: Promise<void> | null = null;
export function startCustomAssets(): Promise<void> {
  started ??= Promise.all([reloadProject(), reloadMine()]).then(() => {});
  return started;
}

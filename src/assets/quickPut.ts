import { defaultCutinArt, defaultPortraitUrl, skinOf } from '../ui3d/looks';
import type { CropSource } from './cropper';
import { devAvailable, devDelete, devPut } from './devApi';
import { type Placed, mineAssets, projectAssets, reloadMine, reloadProject } from './layers';
import { type Entry, fileOf } from './slots';
import { type Sniffed, sniff } from './sniff';
import { deleteMine, putMine } from './store';

// 素材导入页以外的地方（睁眼特写预览页）直接换一格图，和素材导入页存到同一个地方：
// 素材导入页上「放到哪里」选的（这个浏览器 / 项目文件夹）；没选过的话本地开发时是项目文件夹，别的时候是这个浏览器

export type Target = 'mine' | 'project';
export const TARGET_KEY = 'saki-import-target';

export function savedTarget(): Target | null {
  try {
    const v = localStorage.getItem(TARGET_KEY);
    return v === 'mine' || v === 'project' ? v : null;
  } catch {
    return null;
  }
}

export async function importTarget(): Promise<Target> {
  const dev = await devAvailable();
  const t = savedTarget() ?? (dev ? 'project' : 'mine');
  return t === 'project' && !dev ? 'mine' : t;
}

// 清单里的一条：存成 <主人>/<格子>.<扩展名>，name 是原来的文件名（给人看）
export function entryOf(owner: string, slot: string, s: Sniffed, name?: string): Entry {
  return {
    file: fileOf(owner, slot, s.ext),
    mime: s.mime,
    media: s.media,
    size: s.bytes.length,
    ...(s.w && s.h ? { w: s.w, h: s.h } : {}),
    ...(s.model?.vrm != null ? { vrm: s.model.vrm } : {}),
    ...(name ? { name } : {}),
  };
}

export async function putImage(target: Target, owner: string, slot: string, bytes: Uint8Array, name: string): Promise<void> {
  const s = sniff(bytes);
  if (!s || s.media !== 'image') throw new Error('不是图片');
  const entry = entryOf(owner, slot, s, name);
  if (target === 'project') {
    await devPut(owner, slot, entry, s.bytes);
    await reloadProject();
  } else {
    if (!(await putMine({ owner, slot, entry, data: s.bytes.slice().buffer }))) throw new Error('浏览器不让存（空间不够？）');
    await reloadMine();
  }
}

export async function removeImage(target: Target, owner: string, slot: string): Promise<void> {
  if (target === 'project') {
    await devDelete(owner, slot);
    await reloadProject();
  } else {
    await deleteMine(owner, slot);
    await reloadMine();
  }
}

export function placedIn(target: Target, owner: string, slot: string): Placed | undefined {
  return (target === 'mine' ? mineAssets() : projectAssets()).find((a) => a.owner === owner && a.slot === slot);
}

// 这个人现有的头像、立绘（裁睁眼特写用）：换上的在前（先看 target 那一层，再看游戏里正在用的），自带的在后；同一张只列一次
export function avatarSources(owner: string, target?: Target): CropSource[] {
  const out: CropSource[] = [];
  const add = (label: string, url: string | undefined, name: string) => {
    if (url && !out.some((s) => s.url === url)) out.push({ label, url, name });
  };
  const own = (slot: 'face' | 'power' | 'win' | 'ability') => {
    const p = target ? placedIn(target, owner, slot) : undefined;
    if (p?.entry.media === 'image') return { url: p.url, name: p.entry.name ?? `${slot}.${p.entry.file.split('.').pop()}` };
    const art = skinOf(owner, slot);
    return art && !art.video ? { url: art.url, name: `${slot}.png` } : null;
  };
  const mine: [Parameters<typeof own>[0], string][] = [
    ['face', '换上的头像'],
    ['power', '能力发动头像'],
    ['ability', '能力切入'],
    ['win', '和牌切入'],
  ];
  for (const [slot, label] of mine) {
    const o = own(slot);
    if (o) add(label, o.url, o.name);
  }
  add('自带头像', defaultPortraitUrl(owner, 'neutral') || undefined, `${owner}-neutral.webp`);
  add('自带认真脸', defaultPortraitUrl(owner, 'serious') || undefined, `${owner}-serious.webp`);
  add('自带立绘', defaultCutinArt(owner, 'win').url || undefined, `${owner}-cutin.webp`);
  return out;
}

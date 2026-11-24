import type { Media } from './sniff';
import { voiceSlotsOf } from '../ui/voiceLines';
import { MUSIC_SLOTS } from '../ui/musicTracks';

// 素材格子。素材包、项目里的 public/custom/ 都照这个排：<主人>/<格子>.<扩展名>
//   主人是角色 id（saki、awai……）：头像、切入、技能动画、3D 模型、语音（voice-<台词>）
//   _global：不属于哪个角色的（手模、几个提示音）
//   _music：背景音乐的五个格子（只进浏览器和素材包；写进项目时放 public/music/，不进 git，见 musicTracks.ts）

export const GLOBAL = '_global';
export const MUSIC = '_music';

export type SlotGroup = 'portrait' | 'cutin' | 'skill' | 'model' | 'voice' | 'sfx' | 'music';

export interface SlotDef {
  slot: string;
  label: string;
  hint: string;
  media: Media[];
  group: SlotGroup;
  // 文件名里出现这些词就认成这个格子（英文整词比，中文、日文看包含）
  words: string[];
}

const RIICHI = ['riichi', 'reach', 'richi', '立直', 'リーチ'];
const CALL = ['call', 'naki', '鸣牌', '鳴牌', '鳴き'];
const WIN = ['win', 'agari', 'hu', '和牌', '和了', 'アガリ'];
const ABILITY = ['ability', 'skill', '能力', '能力发动', '能力發動', '技能'];

export const PORTRAIT_SLOTS: SlotDef[] = [
  { slot: 'face', label: '头像', hint: '头像框里平时的样子，竖图（宽:高 约 3:4）', media: ['image'], group: 'portrait', words: ['face', 'neutral', 'normal', 'avatar', 'portrait', 'icon', '头像', '頭像', '立绘', '立繪', '平常', '通常'] },
  { slot: 'blank', label: '懵逼', hint: '放铳、终局没拿第一时的头像，竖图', media: ['image'], group: 'portrait', words: ['blank', 'surprised', 'shock', 'shocked', '懵逼', '吃惊', '吃驚', '惊讶', '驚き'] },
  { slot: 'power', label: '能力发动头像', hint: '发动能力时的头像（比如怜演算时眼睛发光），竖图', media: ['image'], group: 'portrait', words: ['power', 'awaken', 'awakened', 'serious', '能力头像', '能力发动头像', '觉醒', '覺醒', '认真'] },
];

export const CUTIN_SLOTS: SlotDef[] = [
  { slot: 'riichi', label: '立直切入', hint: '立直时滑进来的图，透明背景最好', media: ['image'], group: 'cutin', words: RIICHI },
  { slot: 'call', label: '鸣牌切入', hint: '吃碰杠时滑进来的图，不换就用“和牌切入”', media: ['image'], group: 'cutin', words: [...CALL, 'pon', 'chi', 'kan', '碰', '吃', '杠', '槓'] },
  { slot: 'win', label: '和牌切入', hint: '荣和、自摸时滑进来的图', media: ['image'], group: 'cutin', words: [...WIN, 'ron', 'tsumo', 'cutin', 'cut-in', '荣和', '榮和', '自摸', 'ツモ', 'ロン', '切入'] },
  { slot: 'ability', label: '能力发动切入', hint: '发动能力时滑进来的图（比如岭上开花、宝牌聚集、一巡先见）。设置里关了“睁眼特写”才放', media: ['image'], group: 'cutin', words: ABILITY },
  {
    slot: 'eyes',
    label: '睁眼特写',
    hint: '发动能力时斜着的长条格子里的眼睛特写：两只眼睛睁开的横图（16:5），放进来以后从中间一条缝张开；也可以是一段从闭眼到睁眼的视频。不换就用游戏现画的眼睛',
    media: ['image', 'video'],
    group: 'cutin',
    words: ['eyes', 'eye-shot', 'eyeshot', '睁眼', '睜眼', '睁眼特写', '睜眼特寫', '眼部特写', '眼睛特写', '眼睛'],
  },
  { slot: 'result', label: '结算图', hint: '结算画面左边的图，不换就用“和牌切入”', media: ['image'], group: 'cutin', words: ['result', 'score', '结算', '結算', '精算'] },
];

export const MODEL_SLOT: SlotDef = {
  slot: 'model',
  label: '3D 模型',
  hint: 'VRM 模型（VRoid Studio 导出的 .vrm）。换上以后不再给头发、眼睛染色',
  media: ['model'],
  group: 'model',
  words: ['model', 'vrm', 'body', '模型', '人物', 'モデル'],
};

// 不属于哪个角色的：手模，和几个最常听到的提示音（没换的照旧用合成的，见 sound.ts）
export const GLOBAL_SLOTS: SlotDef[] = [
  { slot: 'hand', label: '手模', hint: '大星淡连招特写、出牌试用手模里伸出来的那只手（.glb，带骨骼的右手）', media: ['model'], group: 'model', words: ['hand', 'hands', '手', '手模', '手模型'] },
  { slot: 'sfx-click', label: '落桌声', hint: '打牌落桌的“啪”', media: ['audio'], group: 'sfx', words: ['click', 'discard', 'drop', 'dahai', '落桌', '打牌', '出牌', '打出'] },
  { slot: 'sfx-call', label: '鸣牌提示音', hint: '吃碰杠时', media: ['audio'], group: 'sfx', words: [...CALL, 'pon', 'chi', 'kan', '碰', '吃', '杠'] },
  { slot: 'sfx-riichi', label: '立直提示音', hint: '立直时', media: ['audio'], group: 'sfx', words: RIICHI },
  { slot: 'sfx-win', label: '和牌提示音', hint: '荣和、自摸时', media: ['audio'], group: 'sfx', words: [...WIN, 'ron', 'tsumo', '荣和', '自摸'] },
  { slot: 'sfx-chime', label: '能力发动提示音', hint: '能力发动时', media: ['audio'], group: 'sfx', words: ['chime', ...ABILITY] },
];

export const MUSIC_DEFS: SlotDef[] = MUSIC_SLOTS.map((m) => ({
  slot: m.id,
  label: `背景音乐 · ${m.name}`,
  hint: m.note,
  media: ['audio'],
  group: 'music',
  words: [m.id, m.name, ...({ menu: ['选人', 'title', 'home', '主页'], east: ['东场', '東場', 'battle'], south: ['南场', '南場'], tense: ['紧张', '緊張', 'pinch', 'riichi-bgm'], result: ['结算', '結算', 'ending'] } as Record<string, string[]>)[m.id]],
}));

export interface SkillArt {
  id: string;
  name: string;
  label?: string;
  hint?: string;
}

export interface Who {
  id: string;
  name: string;
  skillArts?: SkillArt[];
  ability?: unknown;
}

export function skillSlots(arts: SkillArt[] | undefined): SlotDef[] {
  return (arts ?? []).map((k) => ({
    slot: `skill-${k.id}`,
    label: k.label ?? `${k.name}动画`,
    hint: k.hint ?? `发动${k.name}时放这一段，盖过“能力发动切入”。可以用 GIF 或视频（MP4、WebM，最长放 6 秒）`,
    media: ['image', 'video'],
    group: 'skill',
    words: [k.id, k.name, ...(k.label ? [k.label] : [])],
  }));
}

// 语音：台词表在 voiceLines.ts，这里给每一句一个格子 voice-<台词>
const VOICE_WORDS: Record<string, string[]> = {
  riichi: RIICHI,
  pon: ['pon', '碰', 'ポン'],
  chi: ['chi', 'chii', '吃', 'チー'],
  kan: ['kan', '杠', '槓', 'カン'],
  ron: ['ron', '荣和', '榮和', 'ロン'],
  tsumo: ['tsumo', '自摸', 'ツモ'],
  ability: ABILITY,
};
export function voiceSlots(c: Who): SlotDef[] {
  return voiceSlotsOf(c).map((l) => ({
    slot: `voice-${l.key}`,
    label: `语音 · ${l.label}`,
    hint: l.hint,
    media: ['audio'],
    group: 'voice',
    words: [l.key, l.label, ...(l.texts ?? []), ...(VOICE_WORDS[l.key] ?? [])],
  }));
}

export const voiceKey = (slot: string): string | null => (slot.startsWith('voice-') ? slot.slice(6) : null);

// 一个主人的全部格子
export function slotsFor(owner: string, who: Who[]): SlotDef[] {
  if (owner === GLOBAL) return GLOBAL_SLOTS;
  if (owner === MUSIC) return MUSIC_DEFS;
  const c = who.find((x) => x.id === owner);
  if (!c) return [];
  return [...PORTRAIT_SLOTS, ...CUTIN_SLOTS, ...skillSlots(c.skillArts), MODEL_SLOT, ...voiceSlots(c)];
}

export const slotDef = (owner: string, slot: string, who: Who[]): SlotDef | undefined => slotsFor(owner, who).find((d) => d.slot === slot);

// 每种素材最大多少（字节）
export const MAX_BYTES: Record<Media, number> = {
  image: 20 << 20,
  video: 30 << 20,
  model: 80 << 20,
  audio: 20 << 20,
};
// 语音一句最多这么大（几秒的话，大了多半是放错了文件）
export const MAX_VOICE_BYTES = 3 << 20;

export const MEDIA_LABEL: Record<Media, string> = { image: '图片', video: '视频', model: '模型', audio: '音频' };

// 素材清单：素材包里的 manifest.json、项目里的 public/custom/manifest.json 都是这个格式
export interface Entry {
  file: string; // 相对清单所在目录的路径
  mime: string;
  media: Media;
  size: number;
  w?: number;
  h?: number;
  vrm?: 0 | 1;
  name?: string; // 原来的文件名，只是给人看
}

export interface Manifest {
  format: 'saki-mahjong-assets';
  version: 1;
  assets: Record<string, Record<string, Entry>>;
}

export const emptyManifest = (): Manifest => ({ format: 'saki-mahjong-assets', version: 1, assets: {} });

// 读回来的清单：格式不对的条目丢掉，不抛错（别人给的包坏了一条不该让整包导不进来）
export function parseManifest(x: unknown): Manifest | null {
  const m = x as Manifest;
  if (!m || m.format !== 'saki-mahjong-assets' || typeof m.assets !== 'object' || m.assets === null) return null;
  const out = emptyManifest();
  for (const [owner, slots] of Object.entries(m.assets)) {
    if (!SAFE_ID.test(owner) || !slots || typeof slots !== 'object') continue;
    for (const [slot, e] of Object.entries(slots)) {
      if (!SAFE_ID.test(slot) || !e || typeof e.file !== 'string' || typeof e.mime !== 'string' || !['image', 'video', 'model', 'audio'].includes(e.media)) continue;
      if (e.file.split('/').some((p) => p === '..' || p === '')) continue;
      (out.assets[owner] ??= {})[slot] = {
        file: e.file,
        mime: e.mime,
        media: e.media,
        size: Number(e.size) || 0,
        ...(Number(e.w) > 0 && Number(e.h) > 0 ? { w: Number(e.w), h: Number(e.h) } : {}),
        ...(e.vrm === 0 || e.vrm === 1 ? { vrm: e.vrm } : {}),
        ...(typeof e.name === 'string' ? { name: e.name.slice(0, 200) } : {}),
      };
    }
  }
  return out;
}

// 主人、格子 id 只许这些字符（也是写文件时的路径，不许 .. 之类）
export const SAFE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
export const SAFE_EXT = /^(png|jpg|webp|gif|mp4|webm|vrm|glb|mp3|ogg|wav|m4a|flac)$/;

export const fileOf = (owner: string, slot: string, ext: string): string => `${owner}/${slot}.${ext}`;

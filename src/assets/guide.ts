import { LOOKS, defaultPortraitUrl } from '../ui3d/looks';
import { EYE_PORTRAIT } from '../ui/eyeLooks';
import { MUSIC_SLOTS } from '../ui/musicTracks';
import { VOICE_MAX_SECONDS } from '../ui/voice';
import { GLOBAL, MAX_BYTES, MAX_VOICE_BYTES, MUSIC, type SlotDef, type SlotGroup, type Who, slotsFor } from './slots';

// 素材导入页上的说明：每一类素材用在哪个画面、要几个、什么规格、不换会怎样，每个格子建议起什么文件名。
// 只是给人看的字和数，不碰存取（存取在 importer.ts、layers.ts）。

// 页面上分的八类：slots.ts 的 group，手模单独算一类（它在 GLOBAL 里和提示音放一起）
export type Kind = SlotGroup | 'hand';
export const kindOf = (d: SlotDef): Kind => (d.slot === 'hand' ? 'hand' : d.group);

export interface KindInfo {
  id: Kind;
  name: string;
  where: string; // 用在哪个画面
  spec: string; // 规格
  fallback: string; // 不换会怎样
  tip?: string; // 先换哪几个
  global: boolean; // 不分角色
  accept: string; // 选文件时的 accept
}

const MB = (n: number) => `${n >> 20} MB`;

export const KINDS: KindInfo[] = [
  {
    id: 'portrait',
    name: '头像',
    where: '牌桌四角的头像框（一直显示）、选人页、图鉴、结算排名',
    spec: '竖图 3:4，建议 600×800（至少 300×400），PNG / WebP / JPG。脸放在上半截，头像框会裁掉下面',
    fallback: '自带头像的只有几个人，其他人头像框里是名字的最后一个字',
    tip: '最少换「头像」这一张：另外两张不换就用它',
    global: false,
    accept: 'image/*',
  },
  {
    id: 'cutin',
    name: '切入图',
    where: '立直、吃碰杠、和牌、能力发动时从座位那边滑进来的大图，能力发动时的睁眼特写，和结算画面左边的图',
    spec: '竖图 3:4（横图 4:3 也行），建议 1200×1600（高至少 1000），透明背景的 PNG / WebP 最好；睁眼特写是横图 16:5，建议 1600×500',
    fallback: '自带立绘的只有几个人，其他人只有一条色带和名字的最后一个字；睁眼特写不换就用游戏现画的眼睛',
    tip: '最值得换「和牌切入」：结算图没换时也用它',
    global: false,
    accept: 'image/*',
  },
  {
    id: 'skill',
    name: '技能动画',
    where: '发动某一个技能时放的一段动画，盖过「能力发动切入」',
    spec: `GIF、MP4、WebM（也可以是一张图），最长放 6 秒，竖横都行，最大 ${MB(MAX_BYTES.video)}`,
    fallback: '放这个角色的「能力发动切入」',
    global: false,
    accept: 'image/*,video/*',
  },
  {
    id: 'model',
    name: '3D 模型',
    where: '3D 牌桌上坐着打牌的人',
    spec: `VRoid Studio 导出的 .vrm（要有人形骨骼），建议 10 MB 以内，最大 ${MB(MAX_BYTES.model)}`,
    fallback: '大多数人借几个通用模型占位，只换了发色和眼睛颜色',
    global: false,
    accept: '.vrm,.glb',
  },
  {
    id: 'voice',
    name: '语音',
    where: '喊牌（立直、碰、吃、杠、荣和、自摸）和能力台词',
    spec: `MP3 / WAV / OGG，一句一般 1～3 秒，最长 ${VOICE_MAX_SECONDS} 秒、${MB(MAX_VOICE_BYTES)}。每一格写了建议台词`,
    fallback: '不出声（游戏自带的没有语音）',
    tip: '先换喊牌的六句，能力台词可以慢慢补',
    global: false,
    accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac',
  },
  {
    id: 'sfx',
    name: '提示音',
    where: '打牌落桌、鸣牌、立直、和牌、能力发动时的音效',
    spec: 'WAV / MP3 / OGG，0.1～1.5 秒，开头别留空白（不然听着慢半拍）',
    fallback: '用游戏合成的声音（格子上能试听）',
    global: true,
    accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac',
  },
  {
    id: 'music',
    name: '背景音乐',
    where: '选人页、对局东场、南场、紧张的时候、整场结算',
    spec: `MP3（OGG 也能放），1～4 分钟、首尾接得上能循环的最好，最大 ${MB(MAX_BYTES.audio)}`,
    fallback: '放项目 public/music/ 里的曲子；那里没有就不放音乐',
    tip: '最少换「对局 · 东场」：南场没换时接着放它',
    global: true,
    accept: 'audio/*,.mp3,.wav,.ogg,.m4a,.flac',
  },
  {
    id: 'hand',
    name: '手模',
    where: '大星淡连招特写、出牌试用手模时伸出来的那只手',
    spec: '带骨骼的右手 .glb（不是整个人的 VRM）',
    fallback: '用自带的手（models/hand-awai.glb）',
    global: true,
    accept: '.glb,.txt',
  },
];

export const kindInfo = (k: Kind): KindInfo => KINDS.find((x) => x.id === k)!;

// 这一类的格子归谁：不分角色的归 GLOBAL、MUSIC，别的每个角色各一份
export const ownersOfKind = (k: Kind, who: Who[]): string[] => (k === 'music' ? [MUSIC] : k === 'sfx' || k === 'hand' ? [GLOBAL] : who.map((c) => c.id));

// 一个主人在这一类里的格子（k 为 null 是全部）
export const slotsOfKind = (owner: string, k: Kind | null, who: Who[]): SlotDef[] => slotsFor(owner, who).filter((d) => !k || kindOf(d) === k);

// 一类一共多少格、有几个角色有（技能动画只有一部分人有；语音每人句数不一样）
export function kindCount(k: Kind, who: Who[]): { total: number; owners: number; min: number; max: number } {
  const per = ownersOfKind(k, who).map((o) => slotsOfKind(o, k, who).length);
  const has = per.filter((n) => n > 0);
  return { total: per.reduce((a, b) => a + b, 0), owners: has.length, min: Math.min(...has), max: Math.max(...has) };
}

// 卡片上“要几个”那一句
export function kindAmount(k: Kind, who: Who[]): string {
  const n = kindCount(k, who);
  if (k === 'sfx') return `${n.total} 个`;
  if (k === 'music') return `${n.total} 首`;
  if (k === 'hand') return '1 个';
  const unit = k === 'voice' ? '句' : k === 'model' ? '个' : k === 'skill' ? '段' : '张';
  const each = n.min === n.max ? `${n.min}` : `${n.min}～${n.max}`;
  if (k === 'skill') return `${n.owners} 个角色有，每人 ${each} 段`;
  return `每个角色 ${each} ${unit}`;
}

// 一句话回答“到底要准备多少”：最少、全套
export function summary(who: Who[]): string {
  const portrait = kindCount('portrait', who).min;
  const cutin = kindCount('cutin', who).min;
  const v = kindCount('voice', who);
  return `想让每个角色有自己的样子，最少每人 2 张图（头像、和牌切入）；全套是每人 ${portrait + cutin} 张图（头像 ${portrait}、切入 ${cutin}）、1 个 3D 模型、${v.min}～${v.max} 句语音，有技能动画的 ${kindCount('skill', who).owners} 个人再加几段动画；不分角色的是 ${kindCount('sfx', who).total} 个提示音、${kindCount('music', who).total} 首背景音乐、1 个手模。`;
}

// 有没有自带的头像、立绘（scripts/render-portraits.mjs 用模型渲染的那几张）
export const hasDefaultArt = (id: string): boolean => !!defaultPortraitUrl(id, 'neutral');

export interface SlotGuide {
  when: string; // 什么时候出现
  fallback: string; // 不换会怎样
  spec: string; // 这一格的规格（一句）
  file: string; // 建议的文件名：照这个起名，拖一整个文件夹进来就自动对上
  key: boolean; // 这一类里最值得先换的
}

const KEY_SLOTS = new Set(['face', 'win', 'voice-riichi', 'voice-ron', 'voice-tsumo', 'east', 'sfx-click']);

// 「语音 · 立直」这种带空格的点换成横线；技能名里的「·」（风神·和牌）留着，文件名里能用，认格子也靠它
const clean = (s: string) => s.replace(/\s+·\s+/g, '-').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '');

function folderOf(owner: string, k: Kind, who: Who[]): string {
  if (owner === MUSIC) return '背景音乐/';
  if (k === 'hand') return '';
  if (owner === GLOBAL) return '提示音/';
  return `${who.find((c) => c.id === owner)?.name ?? owner}/`;
}

const EXT: Record<Kind, string> = { portrait: 'png', cutin: 'png', skill: 'gif', model: 'vrm', voice: 'mp3', sfx: 'wav', music: 'mp3', hand: 'glb' };

export function suggestedFile(owner: string, d: SlotDef, who: Who[]): string {
  const k = kindOf(d);
  const name = d.group === 'music' ? (MUSIC_SLOTS.find((m) => m.id === d.slot)?.name ?? d.slot) : d.label;
  return `${folderOf(owner, k, who)}${clean(name)}.${EXT[k]}`;
}

function fallbackOf(owner: string, d: SlotDef, who: Who[]): string {
  const c = who.find((x) => x.id === owner);
  // 不分角色的（提示音、手模、背景音乐）照这一类说；背景音乐也有叫 result 的格子，别当成结算图
  if (!c) return kindInfo(kindOf(d)).fallback;
  const glyph = `「${c.name.slice(-1)}」字`;
  const art = hasDefaultArt(owner);
  switch (d.slot) {
    case 'face':
      return art ? '用自带的头像' : `头像框里显示${glyph}`;
    case 'blank':
      return art ? '换了「头像」就用它，没换用自带的吃惊表情' : `换了「头像」就用它，没换显示${glyph}`;
    case 'power':
      return art ? '换了「头像」就用它，没换用自带的认真表情' : EYE_PORTRAIT.has(owner) ? '换了「头像」就用它，没换用游戏现画的睁眼（这个人的瞳色）' : `换了「头像」就用它，没换显示${glyph}`;
    case 'riichi':
    case 'call':
    case 'ability':
    case 'win':
      return art ? '用自带的立绘' : `只有色带和${glyph}`;
    case 'eyes':
      return '用游戏现画的眼睛（这个人的瞳色、发色）';
    case 'result':
      return '用「和牌切入」';
    case 'model':
      return LOOKS[owner] && !LOOKS[owner].borrowed ? '用自带的模型' : '借通用模型占位，染成这个角色的发色';
  }
  return kindInfo(kindOf(d)).fallback;
}

function specOf(d: SlotDef): string {
  const k = kindOf(d);
  if (k === 'portrait') return '竖图 3:4，建议 600×800';
  if (k === 'cutin') return d.slot === 'result' ? '竖图或横图，建议 1200×1600，透明背景' : d.slot === 'eyes' ? '横图 16:5，建议 1600×500，眼睛放中间；或 MP4 / WebM' : '竖图 3:4，建议 1200×1600，透明背景';
  if (k === 'skill') return 'GIF / MP4 / WebM，最长 6 秒';
  if (k === 'model') return '.vrm，建议 10 MB 以内';
  if (k === 'voice') return `一句，最长 ${VOICE_MAX_SECONDS} 秒`;
  if (k === 'sfx') return '0.1～1.5 秒';
  if (k === 'music') return '1～4 分钟，能循环';
  return '带骨骼的右手 .glb';
}

// 放图时的裁剪框（cropper.ts）：可选的比例（第一个是一开始的）、存多大（长边，不放大）、框一开始上下放在哪、
// 右边的小预览照什么样子画。不是图的格子（模型、声音）没有
export interface CropSpec {
  ratios: { label: string; r: number | null }[];
  long: number;
  focusY: number;
  look: 'face' | 'eyes' | 'plain';
  hint: string; // 裁剪框上面的一句：框住什么
}

const FREE_CROP = { label: '不限', r: null };
// 还没对上格子的图（对照表里）：不限比例
export const PLAIN_CROP: CropSpec = { ratios: [FREE_CROP, { label: '3:4 竖', r: 3 / 4 }, { label: '4:3 横', r: 4 / 3 }], long: 1600, focusY: 0.5, look: 'plain', hint: '' };

export function cropOf(d: SlotDef): CropSpec | null {
  if (!d.media.includes('image')) return null;
  const tall = { label: '3:4 竖', r: 3 / 4 };
  const wide = { label: '4:3 横', r: 4 / 3 };
  const k = kindOf(d);
  if (k === 'portrait')
    return { ratios: [{ label: '3:4 头像框', r: 3 / 4 }, { label: '1:1 方', r: 1 }, FREE_CROP], long: 800, focusY: 0.4, look: 'face', hint: '框住脸，头顶留一点。头像框会铺满这个框' };
  if (d.slot === 'eyes')
    return { ratios: [{ label: '16:5 睁眼特写', r: 16 / 5 }, FREE_CROP], long: 1600, focusY: 0.42, look: 'eyes', hint: '框住两只眼睛（眉毛到下眼睑），左右留一点。能力发动时从中间一条缝张开' };
  if (d.slot === 'result') return { ...PLAIN_CROP, hint: '结算画面左边的图，竖的横的都行' };
  if (k === 'cutin') return { ratios: [tall, wide, FREE_CROP], long: 1600, focusY: 0.45, look: 'plain', hint: '人放中间，透明背景最好' };
  return PLAIN_CROP;
}

// 这一格的图比例差太多（游戏里会被裁掉一大块）时提醒一句；差不多就是 null。切入、结算横竖都行，不管
export function ratioWarn(d: SlotDef, w: number, h: number): string | null {
  const r = w / h;
  if (kindOf(d) === 'portrait' && (r > 1.05 || r < 0.5)) return '和头像框（3:4）差得多，游戏里会裁掉一大块';
  if (d.slot === 'eyes' && (r < 2.4 || r > 4.2)) return '和睁眼特写的长条（16:5）差得多，游戏里只露出中间一条';
  return null;
}

export function slotGuide(owner: string, d: SlotDef, who: Who[]): SlotGuide {
  return { when: d.hint, fallback: fallbackOf(owner, d, who), spec: specOf(d), file: suggestedFile(owner, d, who), key: KEY_SLOTS.has(d.slot) };
}

// 完整清单（表格）：每个角色、每个格子一行，交给画师、配音的人照着做。Excel 打开要 BOM 才认 UTF-8
export function checklistCsv(who: Who[], owners: string[], has: (owner: string, slot: string) => boolean): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [['角色', '类别', '格子', '什么时候出现', '规格', '不换会怎样', '建议文件名', '现在']];
  for (const owner of owners) {
    const ownerName = owner === GLOBAL ? '通用' : owner === MUSIC ? '背景音乐' : (who.find((c) => c.id === owner)?.name ?? owner);
    for (const d of slotsFor(owner, who)) {
      const g = slotGuide(owner, d, who);
      const label = d.group === 'music' ? (MUSIC_SLOTS.find((m) => m.id === d.slot)?.name ?? d.label) : d.label;
      rows.push([ownerName, kindInfo(kindOf(d)).name, label, g.when, g.spec, g.fallback, g.file, has(owner, d.slot) ? '已换' : '']);
    }
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

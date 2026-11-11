// 背景音乐的五个格子，和每个格子里放的曲子。
//
// 内置的曲子放在 public/music/<格子>.mp3（不进 git：免费授权的曲子不让单独再分发，只跟着游戏一起发）。
// 文件在就放，不在就当这一格是空的；这里的表只是给它补上曲名、作者、音量、循环点。
// 玩家在声音设置里换上的自己的曲子记在浏览器里（IndexedDB），盖在内置的上面。

export type MusicSlot = 'menu' | 'east' | 'south' | 'tense' | 'result';

export const MUSIC_SLOTS: { id: MusicSlot; name: string; note: string }[] = [
  { id: 'menu', name: '选人页', note: '选角色、团体赛排阵' },
  { id: 'east', name: '对局 · 东场', note: '没有南场的曲子时，南场也放它' },
  { id: 'south', name: '对局 · 南场', note: '没有的话接着放东场的' },
  { id: 'tense', name: '对局 · 紧张', note: '有人立直、最后一局、团体赛大将战' },
  { id: 'result', name: '结算', note: '整场打完，看名次的时候' },
];

export interface TrackInfo {
  // 曲名、作者、出处：声音设置里列出来（有的站要求署名）
  title: string;
  by: string;
  url?: string;
  // 这首曲子自己的音量（增益，1 是原样）：几首曲子响度对齐用
  gain?: number;
  // 循环点（秒）：放到 loopEnd 跳回 loopStart。不写就是从头到尾整首循环
  loopStart?: number;
  loopEnd?: number;
}

// 内置曲子的说明。没写的格子，文件在的话照样放，只是没有曲名
export const BUILTIN: Partial<Record<MusicSlot, TrackInfo>> = {};

export const builtinUrl = (slot: MusicSlot): string => `music/${slot}.mp3`;

// 放到一半切走、回来接着放的格子；紧张和结算每次从头
export const RESUMES: ReadonlySet<MusicSlot> = new Set(['menu', 'east', 'south']);

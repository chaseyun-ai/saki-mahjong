// 界面皮肤：选人页上切换，记在浏览器里。CSS 按 <html data-theme> 换样式（src/ui/themes.css，新加的四套在 themes2.css），
// 3D/2.5D 牌桌的桌布、牌背、桌框颜色在建牌桌时从这里取（tableColors）。
// 牌桌风格：桌面和中央仪表盘配成一套，跟皮肤分开选（视觉设置里的「牌桌风格」）；默认跟皮肤走，就是原来的样子。
// 2D 牌桌按 <html data-table> 换桌布和中间那块（src/ui/tableStyles.css）

export type ThemeId = 'classic' | 'broadcast' | 'washi' | 'awaken' | 'porcelain' | 'neon' | 'manga' | 'arcade';

export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'broadcast', name: '大赛转播' },
  { id: 'washi', name: '和风雀庄' },
  { id: 'awaken', name: '能力觉醒' },
  { id: 'porcelain', name: '白瓷简约' },
  { id: 'neon', name: '赛博霓虹' },
  { id: 'manga', name: '漫画分镜' },
  { id: 'arcade', name: '复古街机' },
  { id: 'classic', name: '经典' },
];

export interface TableColors {
  // 桌布的径向渐变：中心、中间、边缘
  felt: [string, string, string];
  // 桌布上那一圈细线
  feltLine: string;
  back: string;
  frame: string;
  trim: string;
  // 背景和地板
  room: string;
  // 中央仪表盘：底色（中心、边缘）、描边、主字色、次要字色、强调色（局数、轮到谁），局数用的字体
  console: { bg: [string, string]; line: string; ink: string; dim: string; accent: string; title: string };
  // 下面几项只有牌桌风格里有；皮肤自带的牌桌不写，就是布纹桌布、原来那种仪表盘
  // 桌面的材质：布纹、绿呢、木纹、哑光、亚麻、皮面
  pattern?: FeltPattern;
  // 仪表盘的画法（consoleLooks.ts）
  look?: ConsoleLook;
  // 桌框、包边的粗糙度和金属感
  frameFinish?: [number, number];
  trimFinish?: [number, number];
  // 仪表盘侧面的颜色，顶面自己发光的强度
  consoleBody?: string;
  consoleGlow?: number;
}

export type FeltPattern = 'cloth' | 'baize' | 'wood' | 'matte' | 'linen' | 'leather';
export type ConsoleLook = 'skin' | 'led' | 'plaque' | 'flat' | 'flap' | 'foil';

const TABLES: Record<ThemeId, TableColors> = {
  classic: {
    felt: ['#2c7079', '#1e525a', '#12363c'],
    feltLine: 'rgba(240,195,90,0.25)',
    back: '#2f78a8',
    frame: '#1d2023',
    trim: '#b9a477',
    room: '#0d2024',
    console: { bg: ['#1a1e21', '#07090a'], line: 'rgba(200,180,130,0.55)', ink: '#f2ead6', dim: '#98a2a6', accent: '#ffc861', title: "700 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
  broadcast: {
    felt: ['#285488', '#1a3c69', '#0e2346'],
    feltLine: 'rgba(255,211,77,0.3)',
    back: '#d9a03a',
    frame: '#141a2a',
    trim: '#b9a477',
    room: '#0a1226',
    console: { bg: ['#13244a', '#050b1a'], line: '#ffd34d', ink: '#ffffff', dim: '#9fb0d0', accent: '#ffd34d', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
  washi: {
    felt: ['#3f7650', '#2a573a', '#183823'],
    feltLine: 'rgba(233,199,122,0.3)',
    back: '#9a3524',
    frame: '#3b2414',
    trim: '#c9a256',
    room: '#1a0f08',
    console: { bg: ['#3d2414', '#160b04'], line: '#c9a256', ink: '#f3ead7', dim: '#c9b08a', accent: '#e9c77a', title: "400 1em 'Ma Shan Zheng','Noto Serif SC',serif" },
  },
  awaken: {
    felt: ['#56459a', '#352a6e', '#1d1646'],
    feltLine: 'rgba(216,200,255,0.3)',
    back: '#e0679a',
    frame: '#1a1230',
    trim: '#d8c8ff',
    room: '#100a24',
    console: { bg: ['#2e1866', '#0e0626'], line: '#a98bff', ink: '#ffffff', dim: '#c9b8ff', accent: '#ff9ad1', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
  // 白瓷简约：浅色，青瓷色桌布、靛蓝牌背、米白桌框
  porcelain: {
    felt: ['#d3e5da', '#b7d2c3', '#93b5a3'],
    feltLine: 'rgba(61,90,128,0.28)',
    back: '#3d5a80',
    frame: '#ebe6dc',
    trim: '#b9b0a2',
    room: '#efeae0',
    console: { bg: ['#ffffff', '#ebe6dc'], line: '#c9c1b2', ink: '#1d232a', dim: '#5b636d', accent: '#a83f29', title: "700 1em 'Noto Serif SC','Noto Sans SC','PingFang SC',serif" },
  },
  // 赛博霓虹：近黑的桌布配青色细线，青蓝牌背（品红只留给和牌、立直这些要紧的字）
  neon: {
    felt: ['#121d33', '#0c1424', '#070b14'],
    feltLine: 'rgba(63,224,255,0.45)',
    back: '#1e7fa6',
    frame: '#070b14',
    trim: '#3fe0ff',
    room: '#04070e',
    console: { bg: ['#0a1630', '#02040a'], line: '#3fe0ff', ink: '#eaf4ff', dim: '#9db1c7', accent: '#ff5cc8', title: "900 1em 'Orbitron','Noto Sans SC','PingFang SC',sans-serif" },
  },
  // 漫画分镜：浅灰纸色桌布、黑牌背、黑桌框
  manga: {
    felt: ['#f3f1eb', '#e2dfd6', '#c9c5ba'],
    feltLine: 'rgba(18,18,18,0.4)',
    back: '#1a1a1a',
    frame: '#121212',
    trim: '#f5f5f5',
    room: '#e9e6dd',
    console: { bg: ['#ffffff', '#e7e3d9'], line: '#141414', ink: '#141414', dim: '#555555', accent: '#c2141f', title: "400 1em 'ZCOOL KuaiLe','Noto Sans SC','PingFang SC',sans-serif" },
  },
  // 复古街机：靛蓝桌布配黄线，金黄牌背
  arcade: {
    felt: ['#2a2670', '#221e52', '#17143a'],
    feltLine: 'rgba(255,210,63,0.5)',
    back: '#e0a82e',
    frame: '#0d0b1e',
    trim: '#ffd23f',
    room: '#0d0b1e',
    console: { bg: ['#221d5a', '#0d0b1e'], line: '#ffd23f', ink: '#f6f5ff', dim: '#b0abe0', accent: '#ff7fa3', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
  },
};

// ---------- 牌桌风格 ----------

export type TableStyleId = 'skin' | 'auto' | 'wood' | 'night' | 'flap' | 'club';

// 每套只用一个桌面色、一个仪表盘底色、一个强调色；仪表盘上的字和底色都量过对比度（正文 4.5:1 以上）
const STYLE_TABLES: Record<Exclude<TableStyleId, 'skin'>, TableColors> = {
  // 自动麻将机：绿呢桌布、黑色亮面机身，点数是琥珀色数码管
  auto: {
    felt: ['#2a6d4f', '#215b44', '#163f30'],
    feltLine: 'rgba(255,255,255,0.16)',
    back: '#2f6fb0',
    frame: '#151617',
    trim: '#9aa0a6',
    room: '#0c1411',
    console: { bg: ['#1a1b1d', '#070708'], line: '#3a2a20', ink: '#ffb02e', dim: '#d6cabc', accent: '#ffb02e', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'baize',
    look: 'led',
    frameFinish: [0.28, 0.3],
    trimFinish: [0.32, 0.85],
    consoleBody: '#0d0e10',
    consoleGlow: 0.55,
  },
  // 原木：深色胡桃木桌面、铜色包边，仪表盘是一块浅色木牌，墨色字，轮到谁盖一个朱红印
  wood: {
    felt: ['#5f412a', '#4e3522', '#3a2718'],
    feltLine: 'rgba(240,210,160,0.2)',
    back: '#2f6a4f',
    frame: '#2c1d12',
    trim: '#b58e4f',
    room: '#140d08',
    console: { bg: ['#efdfbd', '#e4cc9f'], line: '#7d5d3a', ink: '#2b1b0e', dim: '#5a4029', accent: '#9b2c17', title: "900 1em 'Noto Serif SC','STSong',serif" },
    pattern: 'wood',
    look: 'plaque',
    frameFinish: [0.55, 0],
    trimFinish: [0.35, 0.7],
    consoleBody: '#3a2717',
    consoleGlow: 0.12,
  },
  // 深夜：炭灰哑光桌布，仪表盘只有灰白两色加一点青，不发光、没花纹，适合长时间打
  night: {
    felt: ['#2d3239', '#252a30', '#1b1f24'],
    feltLine: 'rgba(255,255,255,0.1)',
    back: '#3d7f86',
    frame: '#1a1d21',
    trim: '#4d555e',
    room: '#0d0f12',
    console: { bg: ['#1d2126', '#181b1f'], line: '#353b44', ink: '#eef1f5', dim: '#a9b1bc', accent: '#5fd3c6', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'matte',
    look: 'flat',
    frameFinish: [0.5, 0.15],
    trimFinish: [0.4, 0.6],
    consoleBody: '#121417',
    consoleGlow: 0.3,
  },
  // 翻牌屏：藏青亚麻桌布、铝框，点数像车站的翻牌显示屏，一位数一块牌
  flap: {
    felt: ['#2b4763', '#22394f', '#182a3b'],
    feltLine: 'rgba(255,255,255,0.16)',
    back: '#d0612a',
    frame: '#9aa3ab',
    trim: '#dfe3e7',
    room: '#0e1620',
    console: { bg: ['#d3d8dd', '#b9c0c7'], line: '#6c747c', ink: '#f5f5f2', dim: '#1f262d', accent: '#ff8a1f', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'linen',
    look: 'flap',
    frameFinish: [0.35, 0.75],
    trimFinish: [0.25, 0.9],
    consoleBody: '#8b939b',
    consoleGlow: 0.18,
  },
  // 酒红皮革：酒红皮面、黑胡桃桌框、金色包边，仪表盘是黑皮面烫金字
  club: {
    felt: ['#6a2429', '#57191f', '#3f1216'],
    feltLine: 'rgba(226,194,127,0.28)',
    back: '#23503f',
    frame: '#1b120e',
    trim: '#c9a45c',
    room: '#120a09',
    console: { bg: ['#1f1714', '#140e0c'], line: '#b8955a', ink: '#f1e6cc', dim: '#c2a874', accent: '#e2c27f', title: "900 1em 'Noto Serif SC','STSong',serif" },
    pattern: 'leather',
    look: 'foil',
    frameFinish: [0.42, 0.1],
    trimFinish: [0.3, 0.9],
    consoleBody: '#19120f',
    consoleGlow: 0.2,
  },
};

export const TABLE_STYLES: { id: TableStyleId; name: string; note: string }[] = [
  { id: 'skin', name: '跟皮肤走', note: '桌布、牌背、仪表盘用界面皮肤自带的那套' },
  { id: 'auto', name: '自动麻将机', note: '绿呢桌布、黑色机身，点数是琥珀色数码管，像雀庄里的全自动麻将桌' },
  { id: 'wood', name: '原木', note: '胡桃木桌面、铜色包边；仪表盘是一块浅色木牌，墨色字，轮到谁盖一个朱红印' },
  { id: 'night', name: '深夜', note: '炭灰哑光桌布，仪表盘只有灰白两色加一点青，不发光、没花纹，适合长时间打' },
  { id: 'flap', name: '翻牌屏', note: '藏青亚麻桌布、铝框，点数像车站的翻牌显示屏，一位数一块牌' },
  { id: 'club', name: '酒红皮革', note: '酒红皮面、黑胡桃桌框、金色包边，仪表盘是黑皮面烫金字' },
];

const STYLE_KEY = 'saki-table-style';

function isTableStyle(v: unknown): v is TableStyleId {
  return TABLE_STYLES.some((t) => t.id === v);
}

let currentStyle: TableStyleId = (() => {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return isTableStyle(v) ? v : 'skin';
  } catch {
    return 'skin';
  }
})();

export function currentTableStyle(): TableStyleId {
  return currentStyle;
}

export function setTableStyle(id: TableStyleId): void {
  currentStyle = id;
  try {
    localStorage.setItem(STYLE_KEY, id);
  } catch {
    // 存不下来就只管这一次
  }
  applyTheme();
}

const KEY = 'saki-theme';
const DEFAULT: ThemeId = 'broadcast';

function isTheme(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

let current: ThemeId = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : DEFAULT;
  } catch {
    // 有的地方不让用本地存储，用默认皮肤
    return DEFAULT;
  }
})();

export function currentTheme(): ThemeId {
  return current;
}

export function setTheme(id: ThemeId): void {
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 存不下来就只管这一次
  }
  applyTheme();
}

export function applyTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = current;
  // 2D 牌桌的桌布和中间那块按这个换；跟皮肤走时不挂
  if (currentStyle === 'skin') delete root.dataset.table;
  else root.dataset.table = currentStyle;
}

// 皮肤自带的牌桌（视觉设置里皮肤按钮上的小色样用这个）
export function skinTableColors(id: ThemeId = current): TableColors {
  return TABLES[id];
}

// 对局里实际用的牌桌：选了牌桌风格就用那套，跟皮肤走就用皮肤自带的
export function tableColors(id: ThemeId = current, style: TableStyleId = currentStyle): TableColors {
  return style === 'skin' ? TABLES[id] : STYLE_TABLES[style];
}

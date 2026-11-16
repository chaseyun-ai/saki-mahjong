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
  // 桌面的材质：布纹、绿呢、木纹、哑光、亚麻、细沙、青草
  pattern?: FeltPattern;
  // 仪表盘的画法（consoleLooks.ts）
  look?: ConsoleLook;
  // 桌框、包边的粗糙度和金属感
  frameFinish?: [number, number];
  trimFinish?: [number, number];
  // 仪表盘侧面的颜色，顶面自己发光的强度
  consoleBody?: string;
  consoleGlow?: number;
  // 款式（形状）：桌框、包边、仪表盘做成什么样子
  form?: TableForm;
  // 全自动麻将机（只有自动麻将机这套有）：每局开始中间那块抬起来把旧牌收进去，四块升降板托着新码好的牌山从桌面里升上来；
  // 机器里两副牌轮流用，两副的牌背颜色不一样（backs，第一副就是 back），一局换一副
  machine?: { backs: [string, string] };
  // 实际用的仪表盘形状（tableColors() 照视觉设置里的「仪表盘形状」填：跟牌桌走时是牌桌风格自己的，跟皮肤走是方盒）
  shape?: ConsoleForm;
}

export type FeltPattern = 'cloth' | 'baize' | 'wood' | 'matte' | 'linen' | 'sand' | 'grass';
export type ConsoleLook = 'skin' | 'led' | 'plaque' | 'flat' | 'flap' | 'tide' | 'sky';
// 仪表盘的形状：圆角方盒（原来的）、矮木牌、圆盘、切角方盒、软包（大圆角、边上鼓起来，顶上一圈包边）
export type ConsoleForm = 'box' | 'plate' | 'disc' | 'chamfer' | 'cushion';

// 牌桌的款式。只有牌桌风格里有；皮肤自带的牌桌不写，就是原来的圆角桌框、金属包边、圆角方仪表盘
export interface TableForm {
  // 桌框外圈的四个角：圆角（原来的）、直角（四块木板拼的，角上一道斜拼缝）、大圆角、切角
  corner: 'round' | 'square' | 'pill' | 'chamfer';
  // 桌框上下边倒圆多大：大的像一圈软包、木桌的圆边，小的利落
  bevel: number;
  // 桌框内侧：金属包边条（原来的）、桌框面上嵌一道铜线、没有、低一级的铝台阶、一圈麻绳
  trim: 'strip' | 'inlay' | 'none' | 'step' | 'rope';
  // 桌框面上一排小件：铆钉
  studs?: 'rivet';
  // 这套牌桌自己的仪表盘形状（视觉设置里「仪表盘形状」选「跟牌桌走」时用这个）
  console: ConsoleForm;
  // 桌布上那圈线：一道（原来的）、两道、只在四个角上画一截、不画
  line: 'single' | 'double' | 'corners' | 'none';
}

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

export type TableStyleId = 'skin' | 'auto' | 'wood' | 'night' | 'flap' | 'beach' | 'meadow';

// 每套只用一个桌面色、一个仪表盘底色、一个强调色；仪表盘上的字和底色都量过对比度（正文 4.5:1 以上）
const STYLE_TABLES: Record<Exclude<TableStyleId, 'skin'>, TableColors> = {
  // 自动麻将机：绿呢桌布、黑色亮面机身，点数是琥珀色数码管。蓝、黄两副牌轮流用
  auto: {
    felt: ['#2a6d4f', '#215b44', '#163f30'],
    feltLine: 'rgba(255,255,255,0.16)',
    back: '#2f6fb0',
    machine: { backs: ['#2f6fb0', '#d99a1e'] },
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
    // 雀庄的全自动麻将桌：就是原来的样子，圆角桌框、金属包边、圆角方盒
    form: { corner: 'round', bevel: 0.14, trim: 'strip', console: 'box', line: 'single' },
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
    // 木桌：直角桌框、圆边，四块木板拼起来，框面上嵌一道铜线；仪表盘是一块矮矮的木牌；桌布上两道线
    form: { corner: 'square', bevel: 0.22, trim: 'inlay', console: 'plate', line: 'double' },
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
    // 什么都收着：大圆角的薄桌框、没有包边，仪表盘是一块薄圆盘，桌布上不画线
    form: { corner: 'pill', bevel: 0.06, trim: 'none', console: 'disc', line: 'none' },
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
    // 车站的铝件：切角桌框、平顶一排铆钉，内侧低一级的亮铝台阶；仪表盘是高一点的切角铝盒；桌布上只在四个角画一截
    form: { corner: 'chamfer', bevel: 0.04, trim: 'step', studs: 'rivet', console: 'chamfer', line: 'corners' },
  },
  // 沙滩：细沙桌面（细细的沙粒、几道风吹出来的沙纹）、漂流木桌框、一圈麻绳；仪表盘是一汪海水，白字，轮到谁亮一块阳光黄
  beach: {
    felt: ['#e3c48a', '#d4ad6c', '#bb9257'],
    feltLine: 'rgba(110,80,40,0.3)',
    back: '#0f6670',
    frame: '#8f806c',
    trim: '#cdb68a',
    room: '#0b222c',
    console: { bg: ['#0c5a63', '#083a42'], line: '#7ccfc8', ink: '#f4fbfa', dim: '#c3e6e2', accent: '#ffd166', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'sand',
    look: 'tide',
    frameFinish: [0.85, 0],
    trimFinish: [0.9, 0],
    consoleBody: '#0a3b42',
    consoleGlow: 0.3,
    // 冲上岸的漂流木：大圆角、圆边的桌框，和桌布接缝的地方一圈麻绳；仪表盘是一块圆盘（一汪海水）；桌布上一道线，像用手指在沙上划的
    form: { corner: 'pill', bevel: 0.26, trim: 'rope', console: 'disc', line: 'single' },
  },
  // 草甸：青草桌面（一片片深浅不一的草、零星几朵小花）、橡木桌框；仪表盘是一块蓝天白云，深蓝字，轮到谁亮一块草绿
  meadow: {
    felt: ['#4a7c31', '#41722e', '#30561f'],
    feltLine: 'rgba(240,250,210,0.2)',
    back: '#9d88d0',
    frame: '#6e4f32',
    trim: '#d8c69c',
    room: '#0c1a0f',
    console: { bg: ['#e2f2ff', '#b8dbf3'], line: '#6d9fc4', ink: '#14304c', dim: '#30577a', accent: '#2f7a3a', title: "900 1em 'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" },
    pattern: 'grass',
    look: 'sky',
    frameFinish: [0.7, 0],
    trimFinish: [0.6, 0],
    consoleBody: '#5a3f27',
    consoleGlow: 0.12,
    // 橡木桌：圆角、圆边，没有包边；仪表盘是软包那种大圆角的木盒，顶上一圈浅色木边，里面镶一块蓝天；桌布上不画线
    form: { corner: 'round', bevel: 0.3, trim: 'none', console: 'cushion', line: 'none' },
  },
};

export const TABLE_STYLES: { id: TableStyleId; name: string; note: string }[] = [
  { id: 'skin', name: '跟皮肤走', note: '桌布、牌背、仪表盘用界面皮肤自带的那套' },
  { id: 'auto', name: '自动麻将机', note: '绿呢桌布、黑色机身、圆角方盒仪表盘，点数是琥珀色数码管。每局开始中间那块抬起来把旧牌收进去，四块升降板托着新牌山从桌面里升上来；蓝、黄两副牌一局换一副' },
  { id: 'wood', name: '原木', note: '胡桃木桌面、直角木框嵌一道铜线；仪表盘是一块矮矮的浅色木牌，墨色字，轮到谁盖一个朱红印' },
  { id: 'night', name: '深夜', note: '炭灰哑光桌布、大圆角薄框；仪表盘是一块圆盘，只有灰白两色加一点青，不发光、没花纹，适合长时间打' },
  { id: 'flap', name: '翻牌屏', note: '藏青亚麻桌布、切角铝框钉一排铆钉；仪表盘是切角铝盒，点数像车站的翻牌显示屏，一位数一块牌' },
  { id: 'beach', name: '沙滩', note: '细沙桌面、漂流木桌框绕一圈麻绳；仪表盘是一汪海水色的圆盘，白字，轮到谁亮一块阳光黄；青绿牌背' },
  { id: 'meadow', name: '草甸', note: '青草桌面、橡木桌框；仪表盘是一块蓝天白云，深蓝字，轮到谁亮一块草绿；淡紫牌背' },
];

const STYLE_KEY = 'saki-table-style';

function isTableStyle(v: unknown): v is TableStyleId {
  return TABLE_STYLES.some((t) => t.id === v);
}

let currentStyle: TableStyleId = (() => {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    // 选过已经去掉的酒红皮革：换成顶替它的沙滩
    if (v === 'club') return 'beach';
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

// 仪表盘形状：可以跟着牌桌风格走，也可以单独选，哪套牌桌、哪个皮肤都能配哪种形状
export type ConsoleShapeId = 'auto' | ConsoleForm;

export const CONSOLE_SHAPES: { id: ConsoleShapeId; name: string; note: string }[] = [
  { id: 'auto', name: '跟牌桌走', note: '用牌桌风格自己的形状（自动麻将机方盒、原木矮牌、深夜圆盘、翻牌屏切角、沙滩圆盘、草甸软包），跟皮肤走时是方盒' },
  { id: 'box', name: '方盒', note: '圆角方盒，原来的样子' },
  { id: 'plate', name: '矮牌', note: '矮矮的一块方牌，直角' },
  { id: 'disc', name: '圆盘', note: '一块薄圆盘，四家的点数往中间收一点' },
  { id: 'chamfer', name: '切角', note: '四个角切掉的方盒，高一点' },
  { id: 'cushion', name: '软包', note: '大圆角，边上鼓起来，顶上一圈包边' },
];

// 每种形状的仪表盘有多高（原来方盒的几倍）
export const CONSOLE_SCALE: Record<ConsoleForm, number> = { box: 1, plate: 0.55, disc: 0.8, chamfer: 1.35, cushion: 1.1 };

const SHAPE_KEY = 'saki-console-shape';

function isConsoleShape(v: unknown): v is ConsoleShapeId {
  return CONSOLE_SHAPES.some((t) => t.id === v);
}

let currentShape: ConsoleShapeId = (() => {
  try {
    const v = localStorage.getItem(SHAPE_KEY);
    return isConsoleShape(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
})();

export function currentConsoleShape(): ConsoleShapeId {
  return currentShape;
}

export function setConsoleShape(id: ConsoleShapeId): void {
  currentShape = id;
  try {
    localStorage.setItem(SHAPE_KEY, id);
  } catch {
    // 存不下来就只管这一次
  }
  applyTheme();
}

// 实际用哪种形状：跟牌桌走时用牌桌风格自己的，跟皮肤走是原来的方盒
export function consoleShapeOf(style: TableStyleId = currentStyle, shape: ConsoleShapeId = currentShape): ConsoleForm {
  if (shape !== 'auto') return shape;
  return style === 'skin' ? 'box' : (STYLE_TABLES[style].form?.console ?? 'box');
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
  // 2D 中间那块的形状：单独选了才挂（跟牌桌走时照牌桌风格、皮肤自己的）
  if (currentShape === 'auto') delete root.dataset.console;
  else root.dataset.console = currentShape;
}

// 皮肤自带的牌桌（视觉设置里皮肤按钮上的小色样用这个）
export function skinTableColors(id: ThemeId = current): TableColors {
  return TABLES[id];
}

// 对局里实际用的牌桌：选了牌桌风格就用那套，跟皮肤走就用皮肤自带的
export function tableColors(id: ThemeId = current, style: TableStyleId = currentStyle, shape: ConsoleShapeId = currentShape): TableColors {
  return { ...(style === 'skin' ? TABLES[id] : STYLE_TABLES[style]), shape: consoleShapeOf(style, shape) };
}

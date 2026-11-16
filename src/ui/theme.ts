// 界面皮肤：选人页上切换，记在浏览器里。CSS 按 <html data-theme> 换样式（src/ui/themes.css，新加的四套在 themes2.css），
// 3D/2.5D 牌桌的桌布、牌背、桌框颜色在建牌桌时从这里取（tableColors）

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
  document.documentElement.dataset.theme = current;
}

export function tableColors(id: ThemeId = current): TableColors {
  return TABLES[id];
}

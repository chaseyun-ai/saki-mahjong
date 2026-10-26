// 界面皮肤：选人页上切换，记在浏览器里。CSS 按 <html data-theme> 换样式（src/ui/themes.css），
// 3D/2.5D 牌桌的桌布、牌背、桌框颜色在建牌桌时从这里取（tableColors）

export type ThemeId = 'classic' | 'broadcast' | 'washi' | 'awaken';

export const THEMES: { id: ThemeId; name: string }[] = [
  { id: 'broadcast', name: '大赛转播' },
  { id: 'washi', name: '和风雀庄' },
  { id: 'awaken', name: '能力觉醒' },
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
}

const TABLES: Record<ThemeId, TableColors> = {
  classic: { felt: ['#2c7079', '#1e525a', '#12363c'], feltLine: 'rgba(240,195,90,0.25)', back: '#2f78a8', frame: '#1d2023', trim: '#b9a477', room: '#0d2024' },
  broadcast: { felt: ['#285488', '#1a3c69', '#0e2346'], feltLine: 'rgba(255,211,77,0.3)', back: '#d9a03a', frame: '#141a2a', trim: '#b9a477', room: '#0a1226' },
  washi: { felt: ['#3f7650', '#2a573a', '#183823'], feltLine: 'rgba(233,199,122,0.3)', back: '#9a3524', frame: '#3b2414', trim: '#c9a256', room: '#1a0f08' },
  awaken: { felt: ['#56459a', '#352a6e', '#1d1646'], feltLine: 'rgba(216,200,255,0.3)', back: '#e0679a', frame: '#1a1230', trim: '#d8c8ff', room: '#100a24' },
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

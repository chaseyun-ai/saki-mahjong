// 白水哩番缚的几种样子（试看用，挑好以后留一种）：投影朝内 / 朝外，几种锁链，头像上的锁，音效。记在浏览器里。

export type RiiProj = 'in' | 'out';
export type ChainStyleId = 'square' | 'steel' | 'heavy' | 'silver' | 'spirit';
export type PlockStyleId = 'badge' | 'frame' | 'cross' | 'seal' | 'glow';
export type RiiSfxId = 'real' | 'bright';

// 番缚的音效（riiSound.ts）：写实的金属声 / 更亮、更像动画的光效
export const SFX_LOOKS: { id: RiiSfxId; name: string }[] = [
  { id: 'real', name: '写实' },
  { id: 'bright', name: '闪亮' },
];

// 头像上的锁（app.ts 的 riiLockHtml 画，样子在 style.css 的 .rii-plock.<id>）
export const PLOCK_LOOKS: { id: PlockStyleId; name: string }[] = [
  { id: 'badge', name: '锁徽' },
  { id: 'frame', name: '锁链框' },
  { id: 'cross', name: '交叉锁链' },
  { id: 'seal', name: '缚印' },
  { id: 'glow', name: '光锁' },
];

export interface ChainLook {
  id: ChainStyleId;
  name: string;
  size: number; // 链环多大（1 是一张牌宽的一半左右）
  thick: number; // 链条粗细（占链环半径的比例）
  stretch: number; // 链环多长（1 是圆环）
  color: string; // 亮的一面
  dark: string; // 暗的一面
  metal: number;
  rough: number;
  glow: number; // 自己发光（光之锁链）
  glowColor: string;
  square?: boolean; // 方形的链环（圆角方框）
}

export const CHAIN_LOOKS: ChainLook[] = [
  { id: 'square', name: '方链', size: 1.05, thick: 0.27, stretch: 1.3, color: '#adb5c1', dark: '#7f8793', metal: 0.9, rough: 0.36, glow: 0, glowColor: '#000000', square: true },
  { id: 'steel', name: '钢链', size: 1, thick: 0.29, stretch: 1.38, color: '#b4bcc8', dark: '#8a919c', metal: 0.9, rough: 0.34, glow: 0, glowColor: '#000000' },
  { id: 'heavy', name: '粗铁链', size: 1.3, thick: 0.38, stretch: 1.15, color: '#8a8178', dark: '#4e4741', metal: 0.75, rough: 0.6, glow: 0, glowColor: '#000000' },
  { id: 'silver', name: '细银链', size: 0.72, thick: 0.2, stretch: 1.65, color: '#f4f7fc', dark: '#c4ccd8', metal: 0.8, rough: 0.3, glow: 0.45, glowColor: '#9aa8bd' },
  { id: 'spirit', name: '光之锁链', size: 1, thick: 0.24, stretch: 1.45, color: '#d6e6ff', dark: '#8fb2ff', metal: 0.2, rough: 0.4, glow: 1.1, glowColor: '#6f9dff' },
];

const KEY = 'saki.riiLook';

interface Saved {
  proj: RiiProj;
  chain: ChainStyleId;
  plock: PlockStyleId;
  sfx: RiiSfxId;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return {
      proj: s?.proj === 'out' ? 'out' : 'in',
      chain: CHAIN_LOOKS.some((c) => c.id === s?.chain) ? s.chain : 'square',
      plock: PLOCK_LOOKS.some((c) => c.id === s?.plock) ? s.plock : 'badge',
      sfx: SFX_LOOKS.some((c) => c.id === s?.sfx) ? s.sfx : 'real',
    };
  } catch {
    return { proj: 'in', chain: 'square', plock: 'badge', sfx: 'real' };
  }
}

export const riiLook: Saved = load();

export function setRiiLook(patch: Partial<Saved>): void {
  Object.assign(riiLook, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(riiLook));
  } catch {
    // 无痕模式存不了，这一次照样能换
  }
}

export function chainLook(id: ChainStyleId = riiLook.chain): ChainLook {
  return CHAIN_LOOKS.find((c) => c.id === id) ?? CHAIN_LOOKS[0];
}

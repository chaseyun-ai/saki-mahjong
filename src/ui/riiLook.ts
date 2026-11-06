// 白水哩番缚的几种样子（试看用，挑好以后留一种）：投影朝内 / 朝外，几种锁链。记在浏览器里。

export type RiiProj = 'in' | 'out';
export type ChainStyleId = 'steel' | 'heavy' | 'silver' | 'spirit';

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
}

export const CHAIN_LOOKS: ChainLook[] = [
  { id: 'steel', name: '钢链', size: 1, thick: 0.29, stretch: 1.38, color: '#b4bcc8', dark: '#8a919c', metal: 0.9, rough: 0.34, glow: 0, glowColor: '#000000' },
  { id: 'heavy', name: '粗铁链', size: 1.3, thick: 0.38, stretch: 1.15, color: '#8a8178', dark: '#4e4741', metal: 0.75, rough: 0.6, glow: 0, glowColor: '#000000' },
  { id: 'silver', name: '细银链', size: 0.72, thick: 0.2, stretch: 1.65, color: '#f4f7fc', dark: '#c4ccd8', metal: 0.8, rough: 0.3, glow: 0.45, glowColor: '#9aa8bd' },
  { id: 'spirit', name: '光之锁链', size: 1, thick: 0.24, stretch: 1.45, color: '#d6e6ff', dark: '#8fb2ff', metal: 0.2, rough: 0.4, glow: 1.1, glowColor: '#6f9dff' },
];

const KEY = 'saki.riiLook';

interface Saved {
  proj: RiiProj;
  chain: ChainStyleId;
}

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return {
      proj: s?.proj === 'out' ? 'out' : 'in',
      chain: CHAIN_LOOKS.some((c) => c.id === s?.chain) ? s.chain : 'steel',
    };
  } catch {
    return { proj: 'in', chain: 'steel' };
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

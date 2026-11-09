// 白水哩番缚的样子：投影朝内 / 朝外，几种锁链，头像上的锁，音效。记在浏览器里。
// 平常的对局只在留下来的几种里挑（选人页白水哩头像右上角的设置，KEPT）；
// 「白水哩 · 姬子测试」窗口里全部都能挑，记在另一份里，只用在测试开的对局。

export type RiiProj = 'in' | 'out';
export type ChainStyleId = 'square' | 'steel' | 'heavy' | 'silver' | 'spirit';
export type PlockStyleId = 'badge' | 'frame' | 'cross' | 'seal' | 'glow';
export type RiiSfxId = 'real' | 'bright';

// 投影朝内：牌面朝着自己；朝外：牌面朝着桌子中间
export const PROJ_LOOKS: { id: RiiProj; name: string }[] = [
  { id: 'in', name: '朝内' },
  { id: 'out', name: '朝外' },
];

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

// 平常的对局留下来的几种（投影只有朝内）
export const KEPT = {
  proj: ['in'] as RiiProj[],
  chain: ['square', 'steel'] as ChainStyleId[],
  plock: ['seal', 'glow'] as PlockStyleId[],
  sfx: ['real', 'bright'] as RiiSfxId[],
};

export type RiiLookProfile = 'main' | 'test';
const KEYS: Record<RiiLookProfile, string> = { main: 'saki.riiLook', test: 'saki.riiLookTest' };

interface Saved {
  proj: RiiProj;
  chain: ChainStyleId;
  plock: PlockStyleId;
  sfx: RiiSfxId;
}

const DEFAULTS: Saved = { proj: 'in', chain: 'square', plock: 'seal', sfx: 'real' };

// 平常的对局：不在留下来那几种里的（以前挑过、后来去掉了）换回默认
function sanitize(s: Partial<Saved> | null, all: boolean): Saved {
  const ok = <T extends string>(v: unknown, list: readonly T[], kept: readonly T[]): v is T => typeof v === 'string' && (all ? list : kept).includes(v as T);
  return {
    proj: ok(s?.proj, ['in', 'out'] as RiiProj[], KEPT.proj) ? s!.proj! : DEFAULTS.proj,
    chain: ok(s?.chain, CHAIN_LOOKS.map((c) => c.id), KEPT.chain) ? s!.chain! : DEFAULTS.chain,
    plock: ok(s?.plock, PLOCK_LOOKS.map((c) => c.id), KEPT.plock) ? s!.plock! : DEFAULTS.plock,
    sfx: ok(s?.sfx, SFX_LOOKS.map((c) => c.id), KEPT.sfx) ? s!.sfx! : DEFAULTS.sfx,
  };
}

function load(p: RiiLookProfile): Saved {
  let raw: Partial<Saved> | null = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEYS[p]) ?? 'null');
    // 测试那一份第一次打开时照平常的来
    if (!raw && p === 'test') raw = JSON.parse(localStorage.getItem(KEYS.main) ?? 'null');
  } catch {
    raw = null;
  }
  return sanitize(raw, p === 'test');
}

let profile: RiiLookProfile = 'main';

// 现在用的这一份（画面、声音都照它）
export const riiLook: Saved = load('main');

// 换一份用：平常的对局 / 测试开的对局（选人页上的两个设置窗口也各管各的）
export function useRiiLook(p: RiiLookProfile): void {
  profile = p;
  Object.assign(riiLook, load(p));
}

export function riiLookProfile(): RiiLookProfile {
  return profile;
}

export function setRiiLook(patch: Partial<Saved>): void {
  Object.assign(riiLook, sanitize({ ...riiLook, ...patch }, profile === 'test'));
  try {
    localStorage.setItem(KEYS[profile], JSON.stringify(riiLook));
  } catch {
    // 无痕模式存不了，这一次照样能换
  }
}

// 设置窗口里列出来的几种：平常的只列留下来的，测试的全部
export function lookChoices(p: RiiLookProfile = profile): {
  proj: { id: RiiProj; name: string }[];
  chain: ChainLook[];
  plock: { id: PlockStyleId; name: string }[];
  sfx: { id: RiiSfxId; name: string }[];
} {
  const all = p === 'test';
  return {
    proj: PROJ_LOOKS.filter((x) => all || KEPT.proj.includes(x.id)),
    chain: CHAIN_LOOKS.filter((x) => all || KEPT.chain.includes(x.id)),
    plock: PLOCK_LOOKS.filter((x) => all || KEPT.plock.includes(x.id)),
    sfx: SFX_LOOKS.filter((x) => all || KEPT.sfx.includes(x.id)),
  };
}

export function chainLook(id: ChainStyleId = riiLook.chain): ChainLook {
  return CHAIN_LOOKS.find((c) => c.id === id) ?? CHAIN_LOOKS[0];
}

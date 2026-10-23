import { DEFAULT_DISCARD, DiscardParams, RIICHI_DISCARD } from '../ui3d/discardMotion';

// 出牌动作参数的预设：两个内置（只读），其余是自己存的，放在这个浏览器的 localStorage 里。
// 正式牌局不读这里；调好的参数导出成 JSON，再写进 discardMotion.ts 的默认值。

export interface Preset {
  name: string;
  params: DiscardParams;
  builtin?: boolean;
}

export const BUILTIN_PRESETS: Preset[] = [
  { name: '默认出牌', params: { ...DEFAULT_DISCARD }, builtin: true },
  { name: '立直出牌', params: { ...RIICHI_DISCARD }, builtin: true },
];

export const PARAM_KEYS = Object.keys(DEFAULT_DISCARD) as (keyof DiscardParams)[];

// 滑块怎么显示：存的是秒、世界单位、米、弧度，界面上换成秒、毫米、度，人比较好读
export interface ParamSpec {
  label: string;
  unit: string;
  scale: number; // 显示值 = 参数 × scale
  min: number; // 显示值的范围
  max: number;
  step: number;
  hint: string;
}

// 1 米 = 23 个世界单位（和牌桌上人物的放大倍数一致）；牌宽 1 个世界单位约 43 毫米
const WORLD_MM = 1000 / 23;
const DEG = 180 / Math.PI;

export const PARAM_SPECS: Record<keyof DiscardParams, ParamSpec> = {
  reach: { label: '伸手', unit: '秒', scale: 1, min: 0.05, max: 1, step: 0.01, hint: '从休息位置伸到牌上' },
  carry: { label: '搬运', unit: '秒', scale: 1, min: 0.05, max: 1, step: 0.01, hint: '拿着牌移到牌河' },
  settle: { label: '放下停顿', unit: '秒', scale: 1, min: 0, max: 1, step: 0.01, hint: '牌落下后手停一下' },
  back: { label: '收手', unit: '秒', scale: 1, min: 0.05, max: 1.5, step: 0.01, hint: '手回到休息位置' },
  lift: { label: '抬起高度', unit: '毫米', scale: WORLD_MM, min: 0, max: 250, step: 1, hint: '搬运途中牌最多抬多高' },
  gripBack: { label: '手腕在牌后', unit: '毫米', scale: 1000, min: -50, max: 200, step: 1, hint: '手腕比接触点靠自己多远' },
  gripUp: { label: '手腕在牌上', unit: '毫米', scale: 1000, min: -30, max: 150, step: 1, hint: '手腕比接触点高多少' },
  arcMax: { label: '出手拱起', unit: '毫米', scale: 1000, min: 0, max: 300, step: 1, hint: '手离开休息位置时最多往上拱多高' },
  leanMax: { label: '最大前倾', unit: '度', scale: DEG, min: 0, max: 70, step: 0.5, hint: '伸手时身体最多前倾多少' },
  wristBend: { label: '手腕下弯', unit: '度', scale: DEG, min: -30, max: 70, step: 0.5, hint: '伸出去的手腕往下弯多少' },
};

const STORE_KEY = 'saki-mahjong.discard-presets.v1';
const DRAFT_KEY = 'saki-mahjong.discard-draft.v1';

// 从任意对象里取出参数：缺的用默认值补上，不是有限数字就整个不要
export function sanitizeParams(raw: unknown): DiscardParams | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out = { ...DEFAULT_DISCARD };
  let found = 0;
  for (const k of PARAM_KEYS) {
    if (!(k in src)) continue;
    const v = src[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[k] = v;
    found++;
  }
  return found ? out : null;
}

// 导入：可以是一个预设 {name, params}、一组预设，或者只有参数本身
export function parsePresets(text: string): Preset[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON');
  }
  const list = Array.isArray(data) ? data : [data];
  const out: Preset[] = [];
  list.forEach((item, i) => {
    const obj = (item ?? {}) as { name?: unknown; params?: unknown };
    const params = sanitizeParams(obj.params ?? item);
    if (!params) throw new Error(`第 ${i + 1} 个预设的参数不对`);
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 40) : `导入的预设 ${i + 1}`;
    out.push({ name, params });
  });
  if (!out.length) throw new Error('里面没有预设');
  return out;
}

// 导出：保留三位小数就够了
export function exportPreset(p: Preset): string {
  const params = Object.fromEntries(PARAM_KEYS.map((k) => [k, Math.round(p.params[k] * 1000) / 1000]));
  return JSON.stringify({ name: p.name, params }, null, 2);
}

export function sameParams(a: DiscardParams, b: DiscardParams): boolean {
  return PARAM_KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
}

// localStorage 在隐私模式、预览里可能用不了，读写都包起来，失败就当没有
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadUserPresets(): Preset[] {
  const data = read(STORE_KEY);
  if (!Array.isArray(data)) return [];
  try {
    return parsePresets(JSON.stringify(data)).filter((p) => !BUILTIN_PRESETS.some((b) => b.name === p.name));
  } catch {
    return [];
  }
}

export function saveUserPresets(list: Preset[]): boolean {
  return write(
    STORE_KEY,
    list.map((p) => ({ name: p.name, params: p.params })),
  );
}

// 正在调的参数（没存成预设也不会因为刷新页面丢掉）
export interface Draft {
  preset: string;
  params: DiscardParams;
}

export function loadDraft(): Draft | null {
  const d = read(DRAFT_KEY) as { preset?: unknown; params?: unknown } | null;
  const params = d && sanitizeParams(d.params);
  if (!d || !params || typeof d.preset !== 'string') return null;
  return { preset: d.preset, params };
}

export function saveDraft(d: Draft): void {
  write(DRAFT_KEY, d);
}

import { DEFAULT_DISCARD, DiscardParams, RIICHI_DISCARD } from '../ui3d/discardMotion';
import { DEFAULT_LAYOUT, LAYOUT_LIMITS, TableLayout, clampLayout } from '../ui3d/tableLayout';

// 调试场景里两套可调参数的预设：出牌动作和牌桌尺寸。每套有内置的（只读），其余是自己存的，
// 放在这个浏览器的 localStorage 里。正式牌局不读这里；调好的参数导出成 JSON，再写进代码里的默认值。

// 每个参数都是数字的一组参数
type Nums<P> = { [K in keyof P]: number };

export interface Preset<P extends Nums<P> = DiscardParams> {
  name: string;
  params: P;
  builtin?: boolean;
}

// 滑块怎么显示：存的是秒、世界单位、米、弧度、倍数，界面上换成人比较好读的单位
export interface ParamSpec {
  label: string;
  unit: string;
  scale: number; // 显示值 = 参数 × scale
  min: number; // 显示值的范围
  max: number;
  step: number;
  hint: string;
}

// 正在调的参数（没存成预设也不会因为刷新页面丢掉）
export interface Draft<P extends Nums<P>> {
  preset: string;
  params: P;
}

// 一套参数的预设怎么存、怎么导入导出
export interface ParamKit<P extends Nums<P>> {
  keys: (keyof P & string)[];
  specs: Record<keyof P, ParamSpec>;
  builtins: Preset<P>[];
  saveAsName: string; // 另存为时默认填的名字
  sanitize(raw: unknown): P | null;
  parse(text: string): Preset<P>[];
  exportOne(p: Preset<P>): string;
  same(a: P, b: P): boolean;
  loadUser(): Preset<P>[];
  saveUser(list: Preset<P>[]): boolean;
  loadDraft(): Draft<P> | null;
  saveDraft(d: Draft<P>): void;
}

interface KitConfig<P extends Nums<P>> {
  defaults: P;
  specs: Record<keyof P, ParamSpec>;
  builtins: Preset<P>[];
  saveAsName: string;
  storeKey: string;
  draftKey: string;
  clamp?: (p: P) => P; // 导入的参数先拉回可调范围
}

function makeKit<P extends Nums<P>>(cfg: KitConfig<P>): ParamKit<P> {
  const keys = Object.keys(cfg.defaults) as (keyof P & string)[];

  // 从任意对象里取出参数：缺的用默认值补上，不是有限数字就整个不要
  const sanitize = (raw: unknown): P | null => {
    if (!raw || typeof raw !== 'object') return null;
    const src = raw as Record<string, unknown>;
    const out = { ...cfg.defaults };
    let found = 0;
    for (const k of keys) {
      if (!(k in src)) continue;
      const v = src[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      out[k] = v as P[typeof k];
      found++;
    }
    if (!found) return null;
    return cfg.clamp ? cfg.clamp(out) : out;
  };

  // 导入：可以是一个预设 {name, params}、一组预设，或者只有参数本身
  const parse = (text: string): Preset<P>[] => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('不是有效的 JSON');
    }
    const list = Array.isArray(data) ? data : [data];
    const out: Preset<P>[] = [];
    list.forEach((item, i) => {
      const obj = (item ?? {}) as { name?: unknown; params?: unknown };
      const params = sanitize(obj.params ?? item);
      if (!params) throw new Error(`第 ${i + 1} 个预设的参数不对`);
      const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 40) : `导入的预设 ${i + 1}`;
      out.push({ name, params });
    });
    if (!out.length) throw new Error('里面没有预设');
    return out;
  };

  return {
    keys,
    specs: cfg.specs,
    builtins: cfg.builtins,
    saveAsName: cfg.saveAsName,
    sanitize,
    parse,
    // 导出：保留三位小数就够了
    exportOne: (p) => {
      const params = Object.fromEntries(keys.map((k) => [k, Math.round(p.params[k] * 1000) / 1000]));
      return JSON.stringify({ name: p.name, params }, null, 2);
    },
    same: (a, b) => keys.every((k) => Math.abs(a[k] - b[k]) < 1e-9),
    loadUser: () => {
      const data = read(cfg.storeKey);
      if (!Array.isArray(data)) return [];
      try {
        return parse(JSON.stringify(data)).filter((p) => !cfg.builtins.some((b) => b.name === p.name));
      } catch {
        return [];
      }
    },
    saveUser: (list) =>
      write(
        cfg.storeKey,
        list.map((p) => ({ name: p.name, params: p.params })),
      ),
    loadDraft: () => {
      const d = read(cfg.draftKey) as { preset?: unknown; params?: unknown } | null;
      const params = d && sanitize(d.params);
      if (!d || !params || typeof d.preset !== 'string') return null;
      return { preset: d.preset, params };
    },
    saveDraft: (d) => {
      write(cfg.draftKey, d);
    },
  };
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

// ---------- 出牌动作 ----------

// 1 米 = 23 个世界单位（人物大小 100% 时的放大倍数）
const WORLD_MM = 1000 / 23;
const DEG = 180 / Math.PI;

export const DISCARD_KIT = makeKit<DiscardParams>({
  defaults: DEFAULT_DISCARD,
  builtins: [
    { name: '默认出牌', params: { ...DEFAULT_DISCARD }, builtin: true },
    { name: '立直出牌', params: { ...RIICHI_DISCARD }, builtin: true },
  ],
  specs: {
    reach: { label: '伸手', unit: '秒', scale: 1, min: 0.05, max: 1, step: 0.01, hint: '从休息位置伸到牌上' },
    carry: { label: '搬运', unit: '秒', scale: 1, min: 0.05, max: 1, step: 0.01, hint: '拿着牌移到牌河' },
    settle: { label: '放下停顿', unit: '秒', scale: 1, min: 0, max: 1, step: 0.01, hint: '牌落下后手停一下' },
    back: { label: '收手', unit: '秒', scale: 1, min: 0.05, max: 1.5, step: 0.01, hint: '手回到休息位置' },
    lift: { label: '抬起高度', unit: '毫米', scale: WORLD_MM, min: 0, max: 250, step: 1, hint: '搬运途中牌最多抬多高（按人物大小 100% 换算）' },
    gripBack: { label: '手腕在牌后', unit: '毫米', scale: 1000, min: -50, max: 200, step: 1, hint: '手腕比接触点靠自己多远' },
    gripUp: { label: '手腕在牌上', unit: '毫米', scale: 1000, min: -30, max: 150, step: 1, hint: '手腕比接触点高多少' },
    arcMax: { label: '出手拱起', unit: '毫米', scale: 1000, min: 0, max: 300, step: 1, hint: '手离开休息位置时最多往上拱多高' },
    leanMax: { label: '最大前倾', unit: '度', scale: DEG, min: 0, max: 70, step: 0.5, hint: '伸手时身体最多前倾多少' },
    wristBend: { label: '手腕下弯', unit: '度', scale: DEG, min: -30, max: 70, step: 0.5, hint: '伸出去的手腕往下弯多少' },
  },
  saveAsName: '我的出牌',
  storeKey: 'saki-mahjong.discard-presets.v1',
  draftKey: 'saki-mahjong.discard-draft.v1',
});

// ---------- 牌桌尺寸 ----------

// 范围按显示的小数位往里收，滑块拖到头也不会超出可调范围
const range = (k: keyof TableLayout, scale: number, step: number): [number, number] => {
  const [lo, hi] = LAYOUT_LIMITS[k];
  return [Math.ceil((lo * scale) / step - 1e-6) * step, Math.floor((hi * scale) / step + 1e-6) * step];
};
const tableSpec = (k: keyof TableLayout, label: string, unit: string, scale: number, step: number, hint: string): ParamSpec => {
  const [min, max] = range(k, scale, step);
  return { label, unit, scale, min: +min.toFixed(4), max: +max.toFixed(4), step, hint };
};

export const TABLE_KIT = makeKit<TableLayout>({
  defaults: DEFAULT_LAYOUT,
  builtins: [{ name: '默认牌桌', params: { ...DEFAULT_LAYOUT }, builtin: true }],
  specs: {
    size: tableSpec('size', '人物大小', '%', 100, 1, '人物相对牌和桌子的大小，200% 左右接近真实比例'),
    handToEdge: tableSpec('handToEdge', '手牌到桌边', '牌宽', 1, 0.05, '手牌背面到桌框内沿的空隙；桌边和人跟着挪'),
    wallToHand: tableSpec('wallToHand', '牌山到手牌', '牌宽', 1, 0.05, '牌山外沿到手牌正面的空隙；手牌、桌边和人一起挪'),
    wallToPond: tableSpec('wallToPond', '牌山到牌河', '牌宽', 1, 0.01, '牌山内沿到牌河第一行的空隙；再小第三行压到牌山，再大和别家的牌河撞上'),
    frame: tableSpec('frame', '桌框宽度', '牌宽', 1, 0.05, '出牌时手要跨过的那一圈桌框'),
    seatGap: tableSpec('seatGap', '人离桌沿', '厘米', 100, 0.5, '髋部到桌框外沿，按人物身材算'),
    seatDrop: tableSpec('seatDrop', '桌面高度', '厘米', 100, 0.5, '桌面比坐着的人的髋部高多少，越大人坐得越低'),
  },
  saveAsName: '我的牌桌',
  storeKey: 'saki-mahjong.table-presets.v1',
  draftKey: 'saki-mahjong.table-draft.v1',
  clamp: clampLayout,
});

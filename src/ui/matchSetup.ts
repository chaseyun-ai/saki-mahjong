import type { Rules } from '../engine/game';

// 单人对局开局前的设置弹窗：点了角色以后弹出来，选好规则再开局。上次选的记在浏览器里，下次照着弹

export interface MatchSettings {
  length: 'one' | 'east' | 'south';
  start: number;
  target: number;
  tobi: boolean;
  red: 0 | 3 | 4;
  kuitan: boolean;
  minHan: 1 | 2 | 4;
  // 公开手牌：别人的手牌亮着打（只是画面上看得见，电脑照旧不看别人的牌）
  open: boolean;
}

export const DEFAULT_SETTINGS: MatchSettings = {
  length: 'south',
  start: 25000,
  target: 30000,
  tobi: true,
  red: 4,
  kuitan: true,
  minHan: 1,
  open: false,
};

const KEY = 'saki-match-settings';

export function loadSettings(): MatchSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') return sanitize({ ...DEFAULT_SETTINGS, ...saved });
  } catch {
    // 无痕模式之类读不到：用默认的
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: MatchSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 存不了就算了，下次还是默认的
  }
}

// 每一项能选的值；value 用字符串写在按钮上，点的时候再换回来
interface Option {
  label: string;
  value: string;
}
interface Row {
  key: keyof MatchSettings;
  name: string;
  options: Option[];
}

const onOff: Option[] = [
  { label: '开启', value: 'true' },
  { label: '关闭', value: 'false' },
];

const ROWS: Row[] = [
  {
    key: 'length',
    name: '局数',
    options: [
      { label: '一局', value: 'one' },
      { label: '东风', value: 'east' },
      { label: '半庄', value: 'south' },
    ],
  },
  {
    key: 'start',
    name: '起始点数',
    options: [25000, 50000, 100000].map((n) => ({ label: String(n), value: String(n) })),
  },
  { key: 'target', name: '一位必要点数', options: [] },
  { key: 'tobi', name: '击飞', options: onOff },
  {
    key: 'red',
    name: '赤宝牌',
    options: [
      { label: '关闭', value: '0' },
      { label: '三赤', value: '3' },
      { label: '四赤', value: '4' },
    ],
  },
  { key: 'kuitan', name: '食断', options: onOff },
  {
    key: 'minHan',
    name: '番缚',
    options: [
      { label: '一番缚', value: '1' },
      { label: '二番缚', value: '2' },
      { label: '四番缚', value: '4' },
    ],
  },
  { key: 'open', name: '公开手牌', options: onOff },
];

// 按钮上写的值换回设置里的值
export function setOption(s: MatchSettings, key: string, value: string): void {
  const row = ROWS.find((r) => r.key === key);
  if (!row || !row.options.some((o) => o.value === value)) return;
  const v = value === 'true' ? true : value === 'false' ? false : /^\d+$/.test(value) ? Number(value) : value;
  (s as unknown as Record<string, unknown>)[key] = v;
}

// 一位必要点数自由输入：只要整百的正数，乱写的照默认
export function parseTarget(text: string): number {
  const n = Math.round(Number(text.replace(/[^\d]/g, '')) / 100) * 100;
  return n > 0 ? Math.min(n, 9_999_900) : DEFAULT_SETTINGS.target;
}

function sanitize(s: MatchSettings): MatchSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of ROWS) {
    if (r.key === 'target') continue;
    setOption(out, r.key, String(s[r.key]));
  }
  out.target = parseTarget(String(s.target));
  return out;
}

export function rulesOf(s: MatchSettings): Partial<Rules> {
  return { target: s.target, tobi: s.tobi, red: s.red, kuitan: s.kuitan, minHan: s.minHan };
}

// 弹窗：name 是选的角色
export function setupHtml(s: MatchSettings, name: string, color: string): string {
  const rows = ROWS.map((r) => {
    const body =
      r.key === 'target'
        ? `<input class="setup-input" id="setup-target" type="text" inputmode="numeric" value="${s.target}" aria-label="一位必要点数" />`
        : r.options
            .map((o) => {
              const on = String(s[r.key]) === o.value;
              return `<button class="${on ? 'on' : ''}" aria-pressed="${on}" data-ui="setup-opt" data-k="${r.key}" data-v="${o.value}">${o.label}</button>`;
            })
            .join('');
    return `<div class="setup-row"><span class="setup-name">${r.name}</span><div class="setup-opts">${body}</div></div>`;
  }).join('');
  return `
    <div class="modal setup-modal" role="dialog" aria-modal="true" aria-label="对局设置">
      <div class="setup" style="--c:${color}">
        <h2>对局设置<small>${name}</small></h2>
        ${rows}
        <div class="setup-actions">
          <button data-ui="setup-cancel">返回</button>
          <button class="primary" data-ui="setup-go">开始对战</button>
        </div>
      </div>
    </div>`;
}

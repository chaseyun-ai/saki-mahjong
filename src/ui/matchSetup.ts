import { CHARACTERS, type Character } from '../abilities/characters';
import type { Rules } from '../engine/game';
import type { Rng } from '../engine/rng';
import { SCHOOLS, membersOf } from './schools';
import { THEMES, type ThemeId, tableColors } from './theme';

// 选人页右上角的两个设置面板：对局设置（规则、对手）和视觉设置（皮肤、牌桌视角、动画）。
// 改了马上记在浏览器里，点头像、按出场都照这里的设置开局

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
  // 摸牌路径（3D、2.5D 牌桌）：on 牌沿弧线从牌山飞进手里，off 在牌山上淡出、手里淡入，self 只有自己的飞
  drawPath: 'on' | 'off' | 'self';
  // 微变化：落桌声、电脑思考时间、出牌动作、牌河摆放每次都差一点点，久玩不腻（vary.ts）
  vary: boolean;
  // 对手：下家、对家、上家坐谁（角色 id），空的是随机
  opponents: string[];
  // 自己用龙门渊透华时开局就是治水（不用等点数变动 10 万）：选人页透华头像旁边的“常态 / 治水”切换
  chisui: boolean;
  // 2.5D 牌桌的布局：classic 是原版；improved 是参考雀魂的试做版（只在改良里改，原版不动，试砸了就换回原版）
  layout: 'classic' | 'improved';
  // 改良布局里自己手牌的画法：B 没有透视、单独一层（雀魂那样）；C 同 B，牌往前倾、牌顶露得多
  hand: 'B' | 'C';
  // 一局结束以后的画面：classic 原版结算弹窗；staged 新结算（试做，照雀魂分几页：和牌、点数移动），只在 3D、2.5D 牌桌上
  result: 'classic' | 'staged';
}

export const SEAT_NAMES = ['下家', '对家', '上家'];

export const DEFAULT_SETTINGS: MatchSettings = {
  length: 'south',
  start: 25000,
  target: 30000,
  tobi: true,
  red: 4,
  kuitan: true,
  minHan: 1,
  open: false,
  drawPath: 'on',
  vary: true,
  opponents: ['', '', ''],
  chisui: false,
  layout: 'classic',
  hand: 'B',
  result: 'classic',
};

const KEY = 'saki-match-settings';

export function loadSettings(): MatchSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') return sanitize({ ...DEFAULT_SETTINGS, ...saved });
  } catch {
    // 无痕模式之类读不到：用默认的
  }
  // 对手名单要另拷一份：改对手时不能连默认设置一起改掉
  return { ...DEFAULT_SETTINGS, opponents: [...DEFAULT_SETTINGS.opponents] };
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
  // 名字下面的一行小字说明
  note?: string;
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
  { key: 'open', name: '公开手牌', options: onOff, note: '别人的手牌亮着打，电脑照旧不看' },
  {
    key: 'drawPath',
    name: '摸牌路径',
    note: '3D、2.5D 牌桌：牌从牌山飞进手里',
    options: [
      { label: '开启', value: 'on' },
      { label: '关闭', value: 'off' },
      { label: '仅自己', value: 'self' },
    ],
  },
  { key: 'vary', name: '微变化', options: onOff, note: '落桌声、出牌动作、牌河每次差一点点' },
  {
    key: 'layout',
    name: '2.5D 布局',
    note: '改良是参考雀魂的试做版，随时可以换回原版',
    options: [
      { label: '原版', value: 'classic' },
      { label: '改良（试做）', value: 'improved' },
    ],
  },
  {
    key: 'hand',
    name: '改良布局的手牌',
    note: 'B 张张一样、牌顶露一条；C 牌往前倾、牌顶露得多',
    options: [
      { label: 'B 正对', value: 'B' },
      { label: 'C 前倾', value: 'C' },
    ],
  },
  {
    key: 'result',
    name: '结算画面',
    note: '新结算是试做：和牌、点数移动分页放，3D、2.5D 牌桌',
    options: [
      { label: '原版', value: 'classic' },
      { label: '新（试做）', value: 'staged' },
    ],
  },
];

// 两个面板各管哪几项（存在同一份设置里）
const MATCH_KEYS: (keyof MatchSettings)[] = ['length', 'start', 'target', 'tobi', 'red', 'kuitan', 'minHan', 'open'];
const VISUAL_KEYS: (keyof MatchSettings)[] = ['drawPath', 'vary'];

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
  const ids = Array.isArray(s.opponents) ? s.opponents : [];
  out.opponents = [0, 1, 2].map((i) => (CHARACTERS.some((c) => c.id === ids[i]) ? ids[i] : ''));
  out.chisui = s.chisui === true;
  return out;
}

// 三个对手（下家、对家、上家）：选了的照选的坐，选了自己、重复的和“随机”从剩下的角色里随机抽
export function pickOpponents(s: MatchSettings, me: string, rng: Rng): Character[] {
  const taken = new Set([me]);
  const chosen = s.opponents.map((id) => {
    if (!id || taken.has(id)) return null;
    taken.add(id);
    return CHARACTERS.find((c) => c.id === id) ?? null;
  });
  const pool = rng.shuffle(CHARACTERS.filter((c) => !taken.has(c.id)));
  return chosen.map((c) => c ?? pool.pop()!);
}

function opponentsHtml(s: MatchSettings): string {
  const groups = SCHOOLS.map(
    (sc) => `<optgroup label="${sc.name}">${membersOf(sc.name).map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}</optgroup>`,
  ).join('');
  return SEAT_NAMES.map((seat, i) => {
    const html = `<option value="">随机</option>${groups}`.replace(`value="${s.opponents[i]}"`, `value="${s.opponents[i]}" selected`);
    return `<label class="setup-seat"><span>${seat}</span><select class="setup-select" data-seat="${i}" aria-label="${seat}">${html}</select></label>`;
  }).join('');
}

export function rulesOf(s: MatchSettings): Partial<Rules> {
  return { target: s.target, tobi: s.tobi, red: s.red, kuitan: s.kuitan, minHan: s.minHan };
}

// 一排选项按钮：on 的那个亮着
function optsHtml(ui: string, key: string, options: Option[], current: string): string {
  return options
    .map((o) => {
      const on = current === o.value;
      return `<button class="${on ? 'on' : ''}" aria-pressed="${on}" data-ui="${ui}" data-k="${key}" data-v="${o.value}">${o.label}</button>`;
    })
    .join('');
}

function rowHtml(name: string, body: string, note?: string, cls = ''): string {
  return `<div class="setup-row${cls ? ` ${cls}` : ''}"><span class="setup-name">${name}${note ? `<small>${note}</small>` : ''}</span><div class="setup-opts">${body}</div></div>`;
}

function settingRows(s: MatchSettings, keys: (keyof MatchSettings)[]): string {
  return keys
    .map((k) => {
      const r = ROWS.find((x) => x.key === k)!;
      const body =
        r.key === 'target'
          ? `<input class="setup-input" id="setup-target" type="text" inputmode="numeric" value="${s.target}" aria-label="一位必要点数" /><span class="setup-unit">点</span>`
          : optsHtml('setup-opt', r.key, r.options, String(s[r.key]));
      return rowHtml(r.name, body, r.note);
    })
    .join('');
}

function panelHtml(kind: string, title: string, sub: string, body: string, actions: string): string {
  return `
    <div class="modal setup-modal set-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="setup set-panel set-${kind}">
        <h2>${title}<small>${sub}</small><button class="set-x" data-ui="panel-close" aria-label="关闭">×</button></h2>
        ${body}
        <div class="setup-actions">${actions}<button class="primary" data-ui="panel-close">完成</button></div>
      </div>
    </div>`;
}

const section = (name: string) => `<h3 class="set-sec">${name}</h3>`;

// 个人对局用的规则：一句话说清楚，显示在出场按钮旁边。窄的地方只放前半句（局数、点数）
export function ruleSummary(s: MatchSettings): { main: string; opp: string } {
  const len = { one: '一局', east: '东风', south: '半庄' }[s.length];
  const picked = s.opponents.filter(Boolean).length;
  return { main: `${len} · ${s.start / 10000} 万点`, opp: picked ? `指定 ${picked} 位对手` : '对手随机' };
}

// 对局设置：对手、规则、公开手牌
export function matchPanelHtml(s: MatchSettings): string {
  const opponents = `<div class="setup-row"><span class="setup-name">对手<small>空着的从其余角色里随机抽</small></span><div class="setup-opts setup-seats">${opponentsHtml(s)}</div></div>`;
  const body = section('对手') + opponents + section('规则') + settingRows(s, MATCH_KEYS.slice(0, -1)) + section('显示') + settingRows(s, MATCH_KEYS.slice(-1));
  return panelHtml('match', '对局设置', '个人对局照这里开局，团体赛按比赛规则', body, '<button data-ui="match-reset">恢复默认</button>');
}

export type TableMode = '25d' | '3d' | '2d';
export const TABLE_MODES: { id: TableMode; name: string; note: string }[] = [
  { id: '25d', name: '2.5D', note: '从上往下看的 3D 牌桌' },
  { id: '3d', name: '3D 实验', note: '坐着人物，要先下载模型' },
  { id: '2d', name: '2D', note: '平面牌桌，最省电' },
];

const MODE_KEY = 'saki-table-mode';

export function loadTableMode(): TableMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (TABLE_MODES.some((m) => m.id === v)) return v as TableMode;
  } catch {
    // 读不到就用默认的
  }
  return '25d';
}

export function saveTableMode(m: TableMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // 存不了就只管这一次
  }
}

// 视觉设置：界面皮肤（带桌布和牌背的小色样）、牌桌视角、摸牌路径和微变化；页面主人多一行素材
export function visualPanelHtml(s: MatchSettings, theme: ThemeId, mode: TableMode, skins: boolean): string {
  const themes = THEMES.map((t) => {
    const c = tableColors(t.id);
    const on = t.id === theme;
    return `<button class="set-theme${on ? ' on' : ''}" aria-pressed="${on}" data-ui="vis-theme" data-v="${t.id}" style="--f:${c.felt[1]};--b:${c.back};--a:${c.console.accent}"><i aria-hidden="true"></i>${t.name}</button>`;
  }).join('');
  const modeNote = TABLE_MODES.find((m) => m.id === mode)?.note;
  const modes = TABLE_MODES.map((m) => {
    const on = m.id === mode;
    return `<button class="${on ? 'on' : ''}" aria-pressed="${on}" data-ui="vis-mode" data-v="${m.id}">${m.name}</button>`;
  }).join('');
  const art = skins ? section('素材') + rowHtml('角色素材', '<button class="set-link" data-ui="skins">换头像、切入图 ›</button>', '只有页面主人看得到') : '';
  const body = section('界面') + rowHtml('界面皮肤', themes, undefined, 'set-themes') + rowHtml('牌桌视角', modes, modeNote) + settingRows(s, s.layout === 'improved' ? ['layout', 'hand', 'result'] : ['layout', 'result']) + section('动画') + settingRows(s, VISUAL_KEYS) + art;
  return panelHtml('visual', '视觉设置', '改了马上生效', body, '');
}

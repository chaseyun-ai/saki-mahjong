import { CHARACTERS, baseAi, type Character } from '../abilities/characters';
import { Rng } from '../engine/rng';
import { POSITIONS, TEAM_START } from '../team/team';
import { SCHOOLS, membersOf } from '../ui/schools';
import { TeamSim } from './teamSim';

// 全国大赛的晋级表（用户 2026-11-19 定：选一所原作学校出战，东西两个半区，全部抽签）
// - 13 所原作学校 + 3 所虚拟的无能力学校，一共 16 校，抽签分进东区、西区各 8 校
// - 每区第一轮两桌（每桌四校，前两名晋级）→ 半区决赛一桌（前两名进总决赛）→ 总决赛东西各两校同桌，第一名夺冠
// - 每一桌都是真打的团体赛（teamSim.ts）：先锋到大将各一个半庄，点数接着走。
//   玩家那桌玩家自己打（App 的团体赛画面），别桌在后台真打；每桌的种子由大赛种子定，存档读回来重算结果不变
// 整个状态是普通对象，可以直接 JSON 存档

export const ROUNDS = ['第一轮', '半区决赛', '决赛'];
export const HALVES = ['东区', '西区'];
const FIRST_NAMES = ['东区 A 桌', '东区 B 桌', '西区 A 桌', '西区 B 桌'];

// 虚拟学校：没有能力、没有立绘，五个人都是普通电脑（照样真打）
export const VIRTUAL_SCHOOLS = [
  { name: '越谷女子', short: '越谷', color: '#8a8f99' },
  { name: '剑谷高中', short: '剑谷', color: '#7d8796' },
  { name: '赞甲高中', short: '赞甲', color: '#8e8778' },
];

export interface Entrant {
  name: string;
  short: string;
  color: string;
  mine: boolean;
  minor: boolean; // 虚拟学校：没能力，名字底下标“虚拟”
  ids: string[]; // 先锋到大将的角色 id（虚拟学校是 npc- 开头的）
  lineup: string[]; // 先锋到大将的名字
  power: number[]; // 先锋到大将每个人的强度（角色费用 1–5；虚拟学校、替补按 1 算），只用来排同分
}

export interface TableResult {
  points: number[]; // 按 schools 的顺序，比赛结束时的点数
  order: number[]; // 名次（schools 的下标），前两名晋级
}

export interface BracketTable {
  round: number;
  name: string;
  half: number | null; // 0 东区、1 西区；总决赛是 null
  schools: string[]; // 学校名
  result: TableResult | null;
}

export interface Bracket {
  seed: number;
  mine: string; // 玩家选的学校
  entrants: Record<string, Entrant>;
  tables: BracketTable[];
  round: number; // 现在打到第几轮（ROUNDS 的下标）；全部打完是 ROUNDS.length
  champion: string | null;
  retries: number; // 玩家那桌重打了几次
}

const SUB = '替补';

// 原作学校报名的五个人：先锋到大将（schools.ts 的出场顺序），不够五个人用替补补上
function entrantOf(school: string, mine: boolean): Entrant {
  const info = SCHOOLS.find((s) => s.name === school);
  const members = membersOf(school).slice(0, POSITIONS.length);
  const ids = members.map((c) => c.id);
  const lineup = members.map((c) => c.name);
  const power = members.map((c) => c.cost);
  while (lineup.length < POSITIONS.length) {
    ids.push(`npc-${school}-${lineup.length}`);
    lineup.push(SUB);
    power.push(1);
  }
  return { name: school, short: info?.short ?? school, color: info?.color ?? '#9aa7b0', mine, minor: false, ids, lineup, power };
}

function virtualEntrant(v: (typeof VIRTUAL_SCHOOLS)[number]): Entrant {
  return { name: v.name, short: v.short, color: v.color, mine: false, minor: true, ids: POSITIONS.map((_, p) => `npc-${v.short}-${p}`), lineup: POSITIONS.map((p) => `${v.short}${p}`), power: POSITIONS.map(() => 1) };
}

// 能报名的学校：有角色的原作学校
export const PLAYABLE_SCHOOLS = SCHOOLS.filter((s) => membersOf(s.name).length > 0).map((s) => s.name);

// 全国抽签：16 校打乱，前 8 校东区、后 8 校西区，每区按顺序四校一桌
export function createBracket(seed: number, mine: string): Bracket {
  if (!PLAYABLE_SCHOOLS.includes(mine)) throw new Error(`没有这所学校：${mine}`);
  const b: Bracket = { seed, mine, entrants: {}, tables: [], round: 0, champion: null, retries: 0 };
  for (const s of PLAYABLE_SCHOOLS) b.entrants[s] = entrantOf(s, s === mine);
  for (const v of VIRTUAL_SCHOOLS) b.entrants[v.name] = virtualEntrant(v);
  const all = new Rng(seed).shuffle(Object.keys(b.entrants)).slice(0, 16);
  b.tables = FIRST_NAMES.map((name, i) => ({ round: 0, name, half: i < 2 ? 0 : 1, schools: all.slice(i * 4, i * 4 + 4), result: null }));
  return b;
}

export const roundTables = (b: Bracket, round = b.round) => b.tables.filter((t) => t.round === round);
export const myTable = (b: Bracket, round = b.round) => roundTables(b, round).find((t) => t.schools.includes(b.mine)) ?? null;
// 这一所学校在哪个半区（第一轮的分桌定的）
export const halfOf = (b: Bracket, school: string): number => roundTables(b, 0).find((t) => t.schools.includes(school))?.half ?? 0;

// 上场的人（Character）：原作学校照角色表；虚拟学校、替补是没有能力的普通电脑
export function lineupOf(b: Bracket, school: string): Character[] {
  const e = b.entrants[school];
  return e.ids.map(
    (id, p) =>
      CHARACTERS.find((c) => c.id === id) ?? {
        id,
        name: e.lineup[p],
        school: e.name,
        color: e.color,
        cost: 1,
        ability: null,
        ai: { ...baseAi },
        note: e.minor ? `${e.name}的${POSITIONS[p]}。没有能力，靠扎实的牌效和防守。` : undefined,
      },
  );
}

// 名次：点数高的在前，同分时强度高的在前，再同就按桌上的顺序
function rank(b: Bracket, t: BracketTable, points: number[]): number[] {
  const str = (i: number) => b.entrants[t.schools[i]].power.reduce((a, x) => a + x, 0);
  return [0, 1, 2, 3].sort((x, y) => points[y] - points[x] || str(y) - str(x) || x - y);
}

// 每一桌固定的种子（大赛种子、第几轮、第几桌；玩家重打不影响别桌）
export function tableSeed(b: Bracket, t: BracketTable): number {
  const i = roundTables(b, t.round).indexOf(t);
  return (Math.imul(b.seed ^ 0x9e3779b9, 31) + t.round * 7919 + i * 104729) >>> 0;
}

// 这一桌的后台真打（还没开始算）。salt：玩家那桌重打后交给电脑时换个种子，不然和上次一模一样
export function tableSim(b: Bracket, t: BracketTable, salt = 0): TeamSim {
  return new TeamSim(
    t.schools.map((s) => lineupOf(b, s)),
    (tableSeed(b, t) + salt * 7777) >>> 0,
  );
}

// 记下一桌的结果（点数按 t.schools 的顺序）
export function setResult(b: Bracket, t: BracketTable, points: number[]): TableResult {
  t.result = { points: [...points], order: rank(b, t, points) };
  return t.result;
}

// 这一轮还没出结果的别桌（不含玩家那桌）
export const pendingOthers = (b: Bracket): BracketTable[] => roundTables(b).filter((t) => !t.result && !t.schools.includes(b.mine));

// 别桌一口气真打完（测试、托管时用；画面里用后台慢慢算的 BgRunner）
export function simulateOthers(b: Bracket): void {
  for (const t of pendingOthers(b)) setResult(b, t, tableSim(b, t).runAll());
}

// 玩家那桌打完：交上来四所学校的最终点数（按 t.schools 的顺序）
export function reportMine(b: Bracket, points: number[]): TableResult {
  const t = myTable(b);
  if (!t) throw new Error('这一轮没有比赛');
  return setResult(b, t, points);
}

export const advancers = (t: BracketTable): string[] => (t.result ? t.result.order.slice(0, 2).map((i) => t.schools[i]) : []);

// 玩家这一轮是否出局（这桌还没结果时是 false）。决赛只有第一名算赢，第二名也给重打的机会
export function myOut(b: Bracket): boolean {
  const t = myTable(b);
  if (!t?.result) return false;
  if (t.round === ROUNDS.length - 1) return t.schools[t.result.order[0]] !== b.mine;
  return !advancers(t).includes(b.mine);
}

// 输了重打：只清掉玩家这桌的结果，别桌不动
export function retryMine(b: Bracket): void {
  const t = myTable(b);
  if (t) t.result = null;
  b.retries++;
}

export const roundDone = (b: Bracket) => roundTables(b).every((t) => t.result);

// 这一轮全部打完后进下一轮：东区两桌的前两名凑东区决赛、西区同样；两个半区决赛的前两名进总决赛
export function advance(b: Bracket): void {
  if (!roundDone(b)) throw new Error('这一轮还有比赛没打完');
  const done = roundTables(b);
  if (done.length === 1) {
    b.champion = done[0].schools[done[0].result!.order[0]];
    b.round = ROUNDS.length;
    return;
  }
  b.round++;
  if (done.length === 4) {
    for (const half of [0, 1]) {
      const [x, y] = done.filter((t) => t.half === half);
      b.tables.push({ round: b.round, name: `${HALVES[half]}决赛`, half, schools: [...advancers(x), ...advancers(y)], result: null });
    }
  } else {
    b.tables.push({ round: b.round, name: '决赛', half: null, schools: done.flatMap(advancers), result: null });
  }
}

// 原作角色查表
export const charactersOf = (school: string): Character[] => CHARACTERS.filter((c) => c.school === school);

// 存档：浏览器里只留一届（读不到、存不了都当没有）
const SAVE_KEY = 'saki.national';
export function saveBracket(b: Bracket | null): void {
  try {
    if (b) localStorage.setItem(SAVE_KEY, JSON.stringify(b));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // 存不了就只管这一次
  }
}
export function loadBracket(): Bracket | null {
  try {
    const b = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Bracket | null;
    if (b && typeof b === 'object' && Array.isArray(b.tables) && b.entrants?.[b.mine]) return b;
  } catch {
    // 坏了就当没有
  }
  return null;
}

export { TEAM_START };

import { CHARACTERS, type Character } from '../abilities/characters';
import { Rng } from '../engine/rng';
import { POSITIONS, TEAM_START } from '../team/team';
import { SCHOOLS, membersOf } from '../ui/schools';

// 剧情模式的全国大赛晋级表（方案 A：十六校三轮）
// - 16 所学校分 4 桌，每桌四校，前两名晋级：第一轮 4 桌 → 半决赛 2 桌 → 决赛 1 桌
// - 原作学校的位置固定；A 桌就是原作二回战的“清澄、姬松、永水、宫守”
// - 我校在全国抽签时抽进 B/C/D 桌的空位，另两个空位放只有名字、没有能力的小校
// - 别桌的结果按两边五个人的强度（费用档位）加随机数瞬间算出来；种子固定，存档后读回来结果不变
// - 我校这桌的结果由真正打完的比赛交上来（reportMine）；输了可以 retryMine 重打这一场
// 整个状态是普通对象，可以直接 JSON 存档

export const MY_SCHOOL = '我校'; // 原创学校的名字定下来之前先用这个占位
export const ROUNDS = ['第一轮', '半决赛', '决赛'];

// 第一轮的分桌。null 是空位：一个给我校（抽签决定），其余放小校
const FIRST_ROUND: (string | null)[][] = [
  ['清澄高中', '姬松高中', '永水女子', '宫守女子'],
  ['临海女子', '有珠山高中', '龙门渊高中', null],
  ['白糸台高中', '新道寺女子', '风越女子', null],
  ['千里山女子', '阿知贺女子学院', '鹤贺学园', null],
];
export const TABLE_NAMES = ['A 桌', 'B 桌', 'C 桌', 'D 桌'];

// 没有能力、没有立绘的小校，只用来填空位
export const MINOR_SCHOOLS = [
  { name: '越谷女子', short: '越谷女子', color: '#8a8f99' },
  { name: '剑谷高中', short: '剑谷', color: '#7d8796' },
];

export interface Entrant {
  name: string;
  short: string;
  color: string;
  mine: boolean;
  minor: boolean; // 小校：没能力，名字底下标“小校”
  lineup: string[]; // 先锋到大将的名字（不够五人的用“替补”补上）
  power: number[]; // 先锋到大将每个人的强度（角色费用 1–5；替补和小校按 1 算）
}

export interface TableResult {
  points: number[]; // 按 schools 的顺序，大将战打完时的点数
  order: number[]; // 名次（schools 的下标），前两名晋级
}

export interface BracketTable {
  round: number;
  name: string;
  schools: string[]; // 学校名
  result: TableResult | null;
}

export interface Bracket {
  seed: number;
  draws: number; // 已经用掉的随机数次数，读档后接着往下算
  entrants: Record<string, Entrant>;
  tables: BracketTable[];
  round: number; // 现在打到第几轮（ROUNDS 的下标）；全部打完是 ROUNDS.length
  champion: string | null;
  retries: number; // 我校重打了几次
}

// 每个位置的点数浮动：强度每高一档平均多赚 STEP 点，再加正负 SPREAD 的随机
const STEP = 5000;
const SPREAD = 14000;

const SUB = '替补';

function entrantOf(school: string): Entrant {
  const info = SCHOOLS.find((s) => s.name === school);
  const members = membersOf(school).slice(0, POSITIONS.length);
  const lineup = members.map((c) => c.name);
  const power = members.map((c) => c.cost);
  while (lineup.length < POSITIONS.length) {
    lineup.push(SUB);
    power.push(1);
  }
  return { name: school, short: info?.short ?? school, color: info?.color ?? '#9aa7b0', mine: false, minor: false, lineup, power };
}

// 我校的阵容：原创角色做出来之前，五个位置都按 myPower 档算
export interface MySchool {
  name?: string;
  color?: string;
  lineup?: string[];
  power?: number[];
}

function myEntrant(my: MySchool): Entrant {
  return {
    name: MY_SCHOOL,
    short: my.name ?? MY_SCHOOL,
    color: my.color ?? '#ffcc33',
    mine: true,
    minor: false,
    lineup: my.lineup ?? POSITIONS.map((p) => `我校${p}`),
    power: my.power ?? POSITIONS.map(() => 3),
  };
}

// 从存档里的种子接着取随机数：每取一次 draws 加一，读档后同样的操作得到同样的结果
function rngAt(b: Bracket): () => number {
  const r = new Rng(b.seed);
  for (let i = 0; i < b.draws; i++) r.next();
  return () => (b.draws++, r.next());
}

// 全国抽签：我校随机进 B/C/D 桌的一个空位，其余空位放小校
export function createBracket(seed: number, my: MySchool = {}): Bracket {
  const b: Bracket = { seed, draws: 0, entrants: {}, tables: [], round: 0, champion: null, retries: 0 };
  const rng = rngAt(b);
  const open: [number, number][] = [];
  FIRST_ROUND.forEach((t, ti) => t.forEach((s, si) => s === null && open.push([ti, si])));
  const mine = Math.floor(rng() * open.length);
  const minors = [...MINOR_SCHOOLS];
  const first = FIRST_ROUND.map((t) => [...t]);
  open.forEach(([ti, si], k) => {
    if (k === mine) first[ti][si] = MY_SCHOOL;
    else {
      const m = minors.shift()!;
      first[ti][si] = m.name;
      b.entrants[m.name] = { ...entrantOf(m.name), short: m.short, color: m.color, minor: true, lineup: POSITIONS.map((p) => `${m.short}${p}`), power: POSITIONS.map(() => 1) };
    }
  });
  for (const t of first)
    for (const s of t as string[]) {
      if (s === MY_SCHOOL) b.entrants[s] = myEntrant(my);
      else b.entrants[s] ??= entrantOf(s);
    }
  b.tables = first.map((schools, i) => ({ round: 0, name: TABLE_NAMES[i], schools: schools as string[], result: null }));
  return b;
}

export const roundTables = (b: Bracket, round = b.round) => b.tables.filter((t) => t.round === round);
export const myTable = (b: Bracket, round = b.round) => roundTables(b, round).find((t) => t.schools.includes(MY_SCHOOL)) ?? null;

// 名次：点数高的在前，同分时强度高的在前，再同就按桌上的顺序
function rank(b: Bracket, t: BracketTable, points: number[]): number[] {
  const str = (i: number) => b.entrants[t.schools[i]].power.reduce((a, x) => a + x, 0);
  return [0, 1, 2, 3].sort((x, y) => points[y] - points[x] || str(y) - str(x) || x - y);
}

// 一桌团体赛：五个位置依次打，每个位置按四个人的强度差加随机数分点
export function simulateTable(b: Bracket, t: BracketTable, rnd: () => number): TableResult {
  const pts = t.schools.map(() => TEAM_START);
  const ents = t.schools.map((s) => b.entrants[s]);
  for (let p = 0; p < POSITIONS.length; p++) {
    const pw = ents.map((e) => e.power[p]);
    const avg = pw.reduce((a, x) => a + x, 0) / 4;
    // 先各自算，再整体挪回总和为零（麻将的点数是从别人那里拿的）
    const raw = pw.map((x) => (x - avg) * STEP + (rnd() + rnd() + rnd() - 1.5) * SPREAD);
    const mean = raw.reduce((a, x) => a + x, 0) / 4;
    raw.forEach((d, i) => (pts[i] += Math.round((d - mean) / 100) * 100));
    // 有队被打飞，整场立刻结束
    if (pts.some((x) => x < 0)) break;
  }
  const fix = TEAM_START * 4 - pts.reduce((a, x) => a + x, 0);
  pts[pts.indexOf(Math.max(...pts))] += fix; // 四舍五入的零头给第一名，总和保持 40 万
  return { points: pts, order: rank(b, t, pts) };
}

// 这一轮除了我校那桌，其余桌都算出结果
export function simulateOthers(b: Bracket): void {
  const rnd = rngAt(b);
  for (const t of roundTables(b)) if (!t.result && !t.schools.includes(MY_SCHOOL)) t.result = simulateTable(b, t, rnd);
}

// 我校这桌真正打完：交上来四所学校的最终点数（按 t.schools 的顺序）
export function reportMine(b: Bracket, points: number[]): TableResult {
  const t = myTable(b);
  if (!t) throw new Error('我校这一轮没有比赛');
  t.result = { points: [...points], order: rank(b, t, points) };
  return t.result;
}

// 我校这桌在没有真比赛时也能模拟（预览和托管用）
export function simulateMine(b: Bracket): TableResult {
  const t = myTable(b);
  if (!t) throw new Error('我校这一轮没有比赛');
  t.result = simulateTable(b, t, rngAt(b));
  return t.result;
}

export const advancers = (t: BracketTable): string[] => (t.result ? t.result.order.slice(0, 2).map((i) => t.schools[i]) : []);

// 我校这一轮是否出局（这桌还没结果时是 false）。决赛只有第一名算赢，第二名也给重打的机会
export function myOut(b: Bracket): boolean {
  const t = myTable(b);
  if (!t?.result) return false;
  if (t.round === ROUNDS.length - 1) return t.schools[t.result.order[0]] !== MY_SCHOOL;
  return !advancers(t).includes(MY_SCHOOL);
}

// 输了重打：只清掉我校这桌的结果，别桌不动
export function retryMine(b: Bracket): void {
  const t = myTable(b);
  if (t) t.result = null;
  b.retries++;
}

export const roundDone = (b: Bracket) => roundTables(b).every((t) => t.result);

// 这一轮全部打完后进下一轮：第一轮 A+B 的前两名、C+D 的前两名各凑一桌；半决赛两桌的前两名进决赛
export function advance(b: Bracket): void {
  if (!roundDone(b)) throw new Error('这一轮还有比赛没打完');
  const done = roundTables(b);
  if (done.length === 1) {
    b.champion = done[0].schools[done[0].result!.order[0]];
    b.round = ROUNDS.length;
    return;
  }
  b.round++;
  const names = done.length === 4 ? ['半决赛 1', '半决赛 2'] : ['决赛'];
  for (let i = 0; i < done.length; i += 2) {
    b.tables.push({ round: b.round, name: names[i / 2], schools: [...advancers(done[i]), ...advancers(done[i + 1])], result: null });
  }
}

// 原作角色查表（剧情里我校以外的出场人物）
export const charactersOf = (school: string): Character[] => CHARACTERS.filter((c) => c.school === school);

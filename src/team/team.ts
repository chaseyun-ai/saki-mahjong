import { CHARACTERS, baseAi, type Character } from '../abilities/characters';
import type { BindKey } from '../abilities/types';
import { Rng } from '../engine/rng';

// 团体赛拟真：红、绿、黄、蓝四队，玩家是其中一队的队长。
// 1. 选人：从 5 费档往下，每档每队选一人（正好 15 费）。顺序蛇形：5 费按开局抽的顺序，4 费倒过来，3 费再正过来……
// 2. 布阵：60 秒把自己队的五个人排到先锋、次锋、中坚、副将、大将；电脑队的布阵开打才公布
// 3. 比赛：每队带着 TEAM_START 点，五个位置依次各打一个半庄（Game 的 team 规则），点数接着走，立直棒留给下一个位置；
//    有队点数小于 0 整场立刻结束。大将战打完按队伍点数排名

export const TEAM_START = 100000;
export const TIERS = [5, 4, 3, 2, 1];
export const POSITIONS = ['先锋', '次锋', '中坚', '副将', '大将'];
export const TEAMS = [
  { id: 'red', name: '红队', color: '#d64545' },
  { id: 'green', name: '绿队', color: '#3aa860' },
  { id: 'yellow', name: '黄队', color: '#d6a92a' },
  { id: 'blue', name: '蓝队', color: '#3f74d6' },
];

// 电脑选人时同一档里的偏好（前面的先挑）；没写的排在后面，替补最后
const AI_PREF = ['teru', 'koromo', 'komaki', 'awai', 'takami', 'saki', 'toyone', 'sawaya', 'nelly', 'hisa', 'toki', 'ryuuka', 'momo', 'yuuki', 'sera', 'suzu', 'rii', 'kasumi', 'mihoko', 'sumire', 'hiroe', 'seiko', 'kuro', 'yu', 'nodoka', 'ako', 'kyouko', 'mako', 'himeko', 'kirame', 'izumi'];
// 电脑按偏好挑的概率，不然从这一档剩下的人里随便挑一个
const AI_BEST = 0.6;

// 替补选手：哪一档凑不够四个人，就用替补补上（没有能力、牌效一般）。新角色做出来就不用了
const SUB_NAMES = ['替补·甲', '替补·乙', '替补·丙', '替补·丁', '替补·戊', '替补·己', '替补·庚', '替补·辛'];
export const isSub = (c: Character) => c.id.startsWith('sub-');

export function draftPool(): Map<number, Character[]> {
  const pool = new Map<number, Character[]>();
  let n = 0;
  for (const tier of TIERS) {
    const list = CHARACTERS.filter((c) => c.cost === tier);
    while (list.length < TEAMS.length) {
      const name = SUB_NAMES[n++ % SUB_NAMES.length];
      list.push({ id: `sub-${tier}-${list.length}`, name, school: '替补', cost: tier, color: '#8a8f99', ability: null, ai: { ...baseAi } });
    }
    pool.set(tier, list);
  }
  return pool;
}

// 第 tier 档的选人顺序（队伍下标）：5 费按 first，4 费倒过来，以此类推
export function snakeOrder(first: number[], tier: number): number[] {
  return (5 - tier) % 2 === 0 ? [...first] : [...first].reverse();
}

const prefRank = (c: Character) => (isSub(c) ? 999 : AI_PREF.includes(c.id) ? AI_PREF.indexOf(c.id) : 100);

export function aiPick(options: Character[], rng: Rng): Character {
  const real = options.filter((c) => !isSub(c));
  const from = real.length ? real : options;
  if (rng.chance(AI_BEST)) return [...from].sort((a, b) => prefRank(a) - prefRank(b))[0];
  return from[rng.int(from.length)];
}

export interface TeamState {
  id: string;
  name: string;
  color: string;
  human: boolean;
  picks: Character[]; // 按 5 费到 1 费
  lineup: Character[]; // 按先锋到大将
  points: number;
}

export interface MatchRecord {
  pos: number;
  seats: number[]; // 每个座位是哪一队
  chars: Character[]; // 每个座位上的人
  start: number[]; // 开局时每队（按队伍下标）的点数
  end: number[];
}

export class TeamRun {
  rng: Rng;
  teams: TeamState[];
  pool = draftPool();
  first: number[]; // 5 费档的选人顺序
  tierIdx = 0; // TIERS 的第几档
  turn = 0; // 这一档轮到第几个
  pos = 0; // 打到第几个位置
  riichiSticks = 0; // 上一场留下的立直棒
  // 每队的白水哩拿到的钥匙，带给后面位置的鹤田姬子
  keys: BindKey[][] = TEAMS.map(() => []);
  history: MatchRecord[] = [];

  constructor(
    seed: number,
    readonly human = 0,
  ) {
    this.rng = new Rng(seed);
    this.teams = TEAMS.map((t, i) => ({ ...t, human: i === human, picks: [], lineup: [], points: TEAM_START }));
    this.first = this.rng.shuffle([0, 1, 2, 3]);
  }

  // ---------- 选人 ----------

  get tier(): number {
    return TIERS[this.tierIdx];
  }

  get drafting(): boolean {
    return this.tierIdx < TIERS.length;
  }

  // 这一档的选人顺序
  order(tier = this.tier): number[] {
    return snakeOrder(this.first, tier);
  }

  // 现在轮到哪一队（选完了是 null）
  picker(): number | null {
    return this.drafting ? this.order()[this.turn] : null;
  }

  // 这个人被哪一队选走了
  takenBy(c: Character): number | null {
    const i = this.teams.findIndex((t) => t.picks.some((x) => x.id === c.id));
    return i < 0 ? null : i;
  }

  available(tier = this.tier): Character[] {
    return (this.pool.get(tier) ?? []).filter((c) => this.takenBy(c) === null);
  }

  // 轮到的队选人。返回是否选上了
  pick(team: number, id: string): boolean {
    if (this.picker() !== team) return false;
    const c = this.available().find((x) => x.id === id);
    if (!c) return false;
    this.teams[team].picks.push(c);
    if (++this.turn >= TEAMS.length) {
      this.turn = 0;
      this.tierIdx++;
    }
    if (!this.drafting) this.defaultLineups();
    return true;
  }

  // 电脑队选一个
  aiPick(): Character | null {
    const team = this.picker();
    if (team === null || this.teams[team].human) return null;
    const c = aiPick(this.available(), this.rng);
    this.pick(team, c.id);
    return c;
  }

  // 选完以后的默认布阵：玩家队按选的顺序（5 费当先锋），电脑队随机排（有哩和姬子时，姬子排在哩后面）
  private defaultLineups(): void {
    for (const t of this.teams) {
      t.lineup = t.human ? [...t.picks] : this.rng.shuffle([...t.picks]);
      const rii = t.lineup.findIndex((c) => c.id === 'rii');
      const himeko = t.lineup.findIndex((c) => c.id === 'himeko');
      if (!t.human && rii >= 0 && himeko >= 0 && himeko < rii) this.swap(this.teams.indexOf(t), rii, himeko);
    }
  }

  // 玩家调换两个位置
  swap(team: number, a: number, b: number): void {
    const l = this.teams[team].lineup;
    [l[a], l[b]] = [l[b], l[a]];
  }

  // ---------- 比赛 ----------

  get over(): boolean {
    return this.pos >= POSITIONS.length || this.teams.some((t) => t.points < 0);
  }

  // 这一场的座位：玩家的队坐 0 号位，其余三队随机
  seating(): number[] {
    const others = this.rng.shuffle([0, 1, 2, 3].filter((i) => i !== this.human));
    return [this.human, ...others];
  }

  // 这一场打完：每个座位（按 seats）最后的点数、剩下的立直棒、白水哩拿到的钥匙
  finish(seats: number[], scores: number[], riichiSticks: number, keys: BindKey[][] = []): void {
    const start = this.teams.map((t) => t.points);
    seats.forEach((team, s) => (this.teams[team].points = scores[s]));
    seats.forEach((team, s) => this.keys[team].push(...(keys[s] ?? [])));
    this.history.push({ pos: this.pos, seats, chars: seats.map((t) => this.teams[t].lineup[this.pos]), start, end: this.teams.map((t) => t.points) });
    this.riichiSticks = riichiSticks;
    this.pos++;
  }

  // 名次（队伍下标）：点数高的在前，同分时选人顺序靠前的在前
  ranking(): number[] {
    return [0, 1, 2, 3].sort((a, b) => this.teams[b].points - this.teams[a].points || this.first.indexOf(a) - this.first.indexOf(b));
  }
}

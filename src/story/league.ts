import { CHARACTERS, baseAi, type Character } from '../abilities/characters';
import { Rng } from '../engine/rng';
import { SCHOOLS } from '../ui/schools';
import { VIRTUAL_SCHOOLS } from './bracket';
import { HanchanSim, SOLO_START } from './hanchanSim';

// 全国大赛个人赛（用户 2026-11-20 定的方案 A：32 人瑞士轮积分赛 + 决赛桌）
// - 32 人：13 所原作学校每校两人（SOLO_ROSTER），加 6 名虚拟选手（团体赛那三所虚拟学校各两人，没有能力）。
//   玩家从全部角色里挑一位报名：在名单上就是她本人，不在名单上就顶掉最后一名虚拟选手
// - 预赛 6 轮，每轮一个半庄、8 桌。第 1 轮抽签（同校的不同桌），之后每轮按积分 1–4 名一桌、5–8 名一桌……
// - 积分照原作长野县个人战：每场（终局点数 − 25000）÷ 1000，加起来排名。同分比单场最高的终局点数，再比费用
// - 预赛积分前 4 名进决赛桌，积分清零再打 2 个半庄，两场加起来定冠军；预赛积分只在决赛同分时用
// - 每一场都是真打的半庄（hanchanSim.ts）：玩家那桌玩家自己打，别桌在后台真打；每桌的种子由大赛种子定，
//   玩家重打只换自己那桌，存档读回来重算结果不变
// 整个状态是普通对象，可以直接 JSON 存档。积分在这里都按点数存（−20500 这样），画面上再除以 1000

export const PRELIM_ROUNDS = 6;
export const FINAL_GAMES = 2;
export const TOTAL_ROUNDS = PRELIM_ROUNDS + FINAL_GAMES;
export const FINALISTS = 4;
export const PLAYERS = 32;
const TABLE_NAMES = ['A 桌', 'B 桌', 'C 桌', 'D 桌', 'E 桌', 'F 桌', 'G 桌', 'H 桌'];
export const FINAL_TABLE = '决赛桌';

export const roundName = (r: number): string => (r < PRELIM_ROUNDS ? `第 ${r + 1} 轮` : `决赛第 ${r - PRELIM_ROUNDS + 1} 场`);
// 积分榜表头用的短名
export const roundShort = (r: number): string => (r < PRELIM_ROUNDS ? `${r + 1}` : `决${r - PRELIM_ROUNDS + 1}`);

// 13 所学校的两名代表（学校按 schools.ts 的顺序；方案文档里列的名单）
export const SOLO_ROSTER = ['saki', 'nodoka', 'koromo', 'toka', 'mihoko', 'kana', 'yumi', 'momo', 'shizuno', 'kuro', 'toki', 'ryuuka', 'rii', 'himeko', 'teru', 'awai', 'komaki', 'hatsumi', 'toyone', 'aislinn', 'hiroe', 'suzu', 'nelly', 'satoha', 'sawaya', 'yukiko'];
const VIRTUAL_TAGS = ['甲', '乙'];

export interface SoloPlayer {
  id: string; // 角色 id；虚拟选手是 npc-solo- 开头的
  name: string;
  school: string;
  short: string; // 学校简称
  color: string;
  cost: number; // 角色费用 1–5（虚拟选手按 1 算），只用来排同分
  minor: boolean; // 虚拟选手：没能力
}

export interface SoloTable {
  round: number;
  name: string;
  seats: number[]; // 四个人（players 的下标）
  scores: number[] | null; // 终局点数，按 seats 的顺序；还没打完是 null
}

export interface League {
  seed: number;
  mine: number; // 玩家是 players 里第几个
  players: SoloPlayer[];
  tables: SoloTable[];
  round: number; // 现在打到第几场（0–5 预赛，6、7 决赛）；全部打完是 TOTAL_ROUNDS
  finalists: number[] | null; // 预赛打完后定的决赛 4 人（按预赛名次）
  podium: number[] | null; // 决赛打完后的名次（4 人）
  retries: number; // 玩家重打了几次
}

function schoolInfo(name: string) {
  const s = SCHOOLS.find((x) => x.name === name);
  return { short: s?.short ?? name, color: s?.color ?? '#9aa7b0' };
}

function playerOf(c: Character): SoloPlayer {
  const s = schoolInfo(c.school);
  return { id: c.id, name: c.name, school: c.school, short: s.short, color: s.color, cost: c.cost, minor: false };
}

const virtualPlayers = (): SoloPlayer[] =>
  VIRTUAL_SCHOOLS.flatMap((v) => VIRTUAL_TAGS.map((tag) => ({ id: `npc-solo-${v.short}-${tag}`, name: `${v.short}·${tag}`, school: v.name, short: v.short, color: v.color, cost: 1, minor: true })));

// 能报名的人：全部角色
export const PICKABLE = CHARACTERS.map((c) => c.id);
export const isRepresentative = (id: string): boolean => SOLO_ROSTER.includes(id);

// 报名、抽第 1 轮：32 人打乱，同校的人不同桌
export function createLeague(seed: number, pick: string): League {
  const me = CHARACTERS.find((c) => c.id === pick);
  if (!me) throw new Error(`没有这个角色：${pick}`);
  const players = [...SOLO_ROSTER.map((id) => playerOf(CHARACTERS.find((c) => c.id === id)!)), ...virtualPlayers()];
  let mine = players.findIndex((p) => p.id === pick);
  if (mine < 0) {
    mine = players.length - 1;
    players[mine] = playerOf(me);
  }
  const l: League = { seed, mine, players, tables: [], round: 0, finalists: null, podium: null, retries: 0 };
  const rng = new Rng(seed);
  let order = rng.shuffle(players.map((_, i) => i));
  for (let k = 0; k < 500 && !schoolsApart(l, order); k++) order = rng.shuffle(order);
  l.tables = chunk(order).map((seats, i) => ({ round: 0, name: TABLE_NAMES[i], seats, scores: null }));
  return l;
}

const chunk = (order: number[]): number[][] => TABLE_NAMES.map((_, i) => order.slice(i * 4, i * 4 + 4));
const schoolsApart = (l: League, order: number[]) => chunk(order).every((t) => new Set(t.map((p) => l.players[p].school)).size === 4);

export const roundTables = (l: League, round = l.round): SoloTable[] => l.tables.filter((t) => t.round === round);
export const myTable = (l: League, round = l.round): SoloTable | null => roundTables(l, round).find((t) => t.seats.includes(l.mine)) ?? null;
export const roundDone = (l: League): boolean => l.round < TOTAL_ROUNDS && roundTables(l).every((t) => t.scores);
// 这一场还没出结果的别桌（不含玩家那桌）
export const pendingOthers = (l: League): SoloTable[] => roundTables(l).filter((t) => !t.scores && !t.seats.includes(l.mine));
export const inFinal = (l: League, p = l.mine): boolean => !!l.finalists?.includes(p);

// 上场的人（Character）：原作角色照角色表；虚拟选手是没有能力的普通电脑
export function charOf(l: League, p: number): Character {
  const e = l.players[p];
  return (
    CHARACTERS.find((c) => c.id === e.id) ?? {
      id: e.id,
      name: e.name,
      school: e.school,
      color: e.color,
      cost: 1,
      ability: null,
      ai: { ...baseAi },
      note: `${e.school}的选手。没有能力，靠扎实的牌效和防守。`,
    }
  );
}

// 每一桌固定的种子（大赛种子、第几场、第几桌；玩家重打不影响别桌）
export function tableSeed(l: League, t: SoloTable): number {
  const i = roundTables(l, t.round).indexOf(t);
  return (Math.imul(l.seed ^ 0x85ebca6b, 31) + t.round * 7919 + i * 104729) >>> 0;
}

// 这一桌的后台真打（还没开始算）。salt：玩家那桌重打后交给电脑时换个种子，不然和上次一模一样
export function tableSim(l: League, t: SoloTable, salt = 0): HanchanSim {
  return new HanchanSim(
    t.seats.map((p) => charOf(l, p)),
    (tableSeed(l, t) + salt * 7777) >>> 0,
  );
}

// 记下一桌的终局点数（按 t.seats 的顺序）
export function setResult(t: SoloTable, scores: number[]): void {
  if (scores.length !== 4) throw new Error('一桌要四个人的点数');
  t.scores = [...scores];
}

// 玩家那桌打完：交上来四个人的终局点数（按 t.seats 的顺序）
export function reportMine(l: League, scores: number[]): SoloTable {
  const t = myTable(l);
  if (!t) throw new Error('这一场玩家没有比赛');
  setResult(t, scores);
  return t;
}

// 重打：只清掉玩家这桌的结果，别桌不动
export function retryMine(l: League): void {
  const t = myTable(l);
  if (!t) return;
  t.scores = null;
  l.retries++;
}

// 别桌一口气真打完（测试、node 里用；画面里用后台慢慢算的 BgRunner）
export function simulateOthers(l: League): void {
  for (const t of pendingOthers(l)) setResult(t, tableSim(l, t).runAll());
}

// ---------- 积分 ----------

// 一个人在这一桌的收支（点数，没打完是 null）
export function netOf(t: SoloTable, p: number): number | null {
  const k = t.seats.indexOf(p);
  return k < 0 || !t.scores ? null : t.scores[k] - SOLO_START;
}

export interface Standing {
  p: number; // players 的下标
  games: (number | null)[]; // 每一场的收支（点数），没打、不在这一场的是 null；下标是第几场
  total: number; // 预赛收支合计（点数）
  best: number; // 预赛单场最高的终局点数（同分时比这个），一场没打是 0
  final: number | null; // 决赛两场的收支合计（不在决赛的是 null）
}

export function standingOf(l: League, p: number): Standing {
  const games: (number | null)[] = Array.from({ length: TOTAL_ROUNDS }, () => null);
  let total = 0;
  let best = 0;
  let final: number | null = null;
  for (const t of l.tables) {
    const n = netOf(t, p);
    if (n === null) continue;
    games[t.round] = n;
    if (t.round < PRELIM_ROUNDS) {
      total += n;
      best = Math.max(best, n + SOLO_START);
    } else final = (final ?? 0) + n;
  }
  return { p, games, total, best, final };
}

// 预赛的排名：收支合计 → 单场最高 → 费用 → 名单顺序
const byPrelim = (l: League) => (a: Standing, b: Standing) => b.total - a.total || b.best - a.best || l.players[b.p].cost - l.players[a.p].cost || a.p - b.p;

export function prelimStandings(l: League): Standing[] {
  return l.players.map((_, p) => standingOf(l, p)).sort(byPrelim(l));
}

// 现在的总名次：决赛打完后前 4 名照决赛，没打完时决赛 4 人按决赛收支（同分按预赛）排在最前；其余按预赛积分
export function standings(l: League): Standing[] {
  const pre = prelimStandings(l);
  if (!l.finalists) return pre;
  const rank = new Map(pre.map((s, i) => [s.p, i]));
  const top = pre.filter((s) => l.finalists!.includes(s.p));
  if (l.podium) top.sort((a, b) => l.podium!.indexOf(a.p) - l.podium!.indexOf(b.p));
  else top.sort((a, b) => (b.final ?? 0) - (a.final ?? 0) || rank.get(a.p)! - rank.get(b.p)!);
  return [...top, ...pre.filter((s) => !l.finalists!.includes(s.p))];
}

// 这一场全部打完后进下一场：预赛按积分分桌；预赛打完定决赛 4 人；决赛两场打完定名次
export function advance(l: League): void {
  if (!roundDone(l)) throw new Error('这一场还有比赛没打完');
  const done = l.round;
  l.round++;
  if (l.round < PRELIM_ROUNDS) {
    l.tables.push(...chunk(prelimStandings(l).map((s) => s.p)).map((seats, i) => ({ round: l.round, name: TABLE_NAMES[i], seats, scores: null })));
    return;
  }
  if (done === PRELIM_ROUNDS - 1) l.finalists = prelimStandings(l).slice(0, FINALISTS).map((s) => s.p);
  if (l.round < TOTAL_ROUNDS) {
    l.tables.push({ round: l.round, name: FINAL_TABLE, seats: [...l.finalists!], scores: null });
    return;
  }
  const pre = prelimStandings(l).map((s) => s.p);
  l.podium = l.finalists!.map((p) => standingOf(l, p)).sort((a, b) => (b.final ?? 0) - (a.final ?? 0) || pre.indexOf(a.p) - pre.indexOf(b.p)).map((s) => s.p);
}

export const finished = (l: League): boolean => !!l.podium;
export const champion = (l: League): number | null => l.podium?.[0] ?? null;
// 玩家现在的名次（从 1 数）
export const myPlace = (l: League): number => standings(l).findIndex((s) => s.p === l.mine) + 1;

// 一口气打完一整届（测试、node 里用）：play 给玩家那桌出结果，不给就也让电脑真打
export function runLeague(l: League, play?: (l: League, t: SoloTable) => number[]): League {
  while (!finished(l)) {
    simulateOthers(l);
    const t = myTable(l);
    if (t && !t.scores) setResult(t, play ? play(l, t) : tableSim(l, t).runAll());
    advance(l);
  }
  return l;
}

// 存档：浏览器里只留一届（读不到、存不了都当没有）；和团体赛（saki.national）各存各的
const SAVE_KEY = 'saki.nationalSolo';
export function saveLeague(l: League | null): void {
  try {
    if (l) localStorage.setItem(SAVE_KEY, JSON.stringify(l));
    else localStorage.removeItem(SAVE_KEY);
  } catch {
    // 存不了就只管这一次
  }
}
export function loadLeague(): League | null {
  try {
    const l = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as League | null;
    if (l && typeof l === 'object' && Array.isArray(l.players) && l.players.length === PLAYERS && Array.isArray(l.tables) && l.players[l.mine]) return l;
  } catch {
    // 坏了就当没有
  }
  return null;
}

import type { HandEvent } from './hands';
import {
  FINAL_TABLE,
  FINALISTS,
  FOCUS_FROM,
  type League,
  netOf,
  PRELIM_ROUNDS,
  prelimStandings,
  roundName,
  roundTables,
  type SoloTable,
  standingOf,
  TOTAL_ROUNDS,
} from './league';

// 个人赛的场外信息（用户 2026-11-20 定的第一批热闹化）：
// - 赛事快报：每一场从各桌真打出来的和牌里挑最热闹的几条（役满、大牌、海底岭上、击飞、种子爆冷、连续一位……）
// - 对局词条：焦点桌（第 3 轮起的 A 桌、决赛桌）、同门内战、死亡之组、复仇之战
// - 卡线提示：预赛最后两轮，算出玩家要进前 4 这一场大概要多少
// 全是从存档里的结果现算的，不另外存

const fmt = (n: number) => n.toLocaleString('en-US');
const pts = (n: number) => {
  const v = (Math.abs(n) / 1000).toFixed(1);
  return n > 0 ? `+${v}` : n < 0 ? `−${v}` : `±${v}`;
};

export interface NewsItem {
  table: string;
  text: string;
  weight: number; // 越大越靠前
  mine: boolean; // 和玩家有关
}

// 这些役出现就值得一提（原作里的招牌：衣的海底、咲的岭上……）
const FLAVOR = ['海底捞月', '河底捞鱼', '岭上开花', '天和', '地和', '人和', '一发'];
const isYakuman = (h: HandEvent) => h.limit.includes('役满');

function handNews(l: League, t: SoloTable, h: HandEvent): NewsItem | null {
  const name = (k: number) => l.players[t.seats[k]].name;
  const flavor = h.yaku.filter((y) => FLAVOR.includes(y) && y !== '一发');
  const how = h.from < 0 ? '自摸' : `${name(h.from)}放铳`;
  const mine = t.seats[h.win] === l.mine || (h.from >= 0 && t.seats[h.from] === l.mine);
  if (isYakuman(h)) {
    const big = h.yaku.filter((y) => !['立直', '门前清自摸和', '一发'].includes(y)).slice(0, 2).join('、');
    return { table: t.name, text: `役满！${name(h.win)}${h.round}和出${big ? `${big}，` : ''}${h.limit} ${fmt(h.gain)} 点（${how}）`, weight: 100 + h.gain / 1000, mine };
  }
  const head = flavor.length ? `${flavor.join('、')}！` : '';
  if (h.limit === '三倍满' || h.limit === '倍满') return { table: t.name, text: `${head}${name(h.win)}${h.round}${h.limit} ${fmt(h.gain)} 点（${how}）`, weight: (h.limit === '三倍满' ? 60 : 48) + h.gain / 1000, mine };
  if (flavor.length) return { table: t.name, text: `${head}${name(h.win)}${h.round}${h.limit ? `${h.limit} ` : ''}${fmt(h.gain)} 点`, weight: 34 + h.gain / 2000, mine };
  return null;
}

// 一个人在第 r 场（预赛）是不是第一位
const firstAt = (l: League, p: number, r: number): boolean => {
  const t = roundTables(l, r).find((x) => x.seats.includes(p));
  if (!t?.scores) return false;
  const k = t.seats.indexOf(p);
  return t.scores.every((s, i) => i === k || s < t.scores![k]);
};

function tableNews(l: League, t: SoloTable): NewsItem[] {
  if (!t.scores) return [];
  const out: NewsItem[] = [];
  for (const h of t.hands ?? []) {
    const n = handNews(l, t, h);
    if (n) out.push(n);
  }
  const order = [0, 1, 2, 3].sort((a, b) => t.scores![b] - t.scores![a]);
  t.seats.forEach((p, k) => {
    const e = l.players[p];
    const mine = p === l.mine;
    const score = t.scores![k];
    if (score < 0) out.push({ table: t.name, text: `击飞！${e.name}被打到 ${fmt(score)} 点`, weight: 70, mine });
    // 种子垫底（预赛）
    if (e.seed && order[3] === k && t.round < PRELIM_ROUNDS && score >= 0) out.push({ table: t.name, text: `爆冷：种子${e.name}这一场垫底（${pts(score - 25000)}）`, weight: 44, mine });
    // 连续一位（预赛，三连起）
    if (t.round < PRELIM_ROUNDS && order[0] === k) {
      let n = 0;
      for (let r = t.round; r >= 0 && firstAt(l, p, r); r--) n++;
      if (n >= 3) out.push({ table: t.name, text: `${e.name}${['', '', '', '三', '四', '五', '六'][n]}连一位！`, weight: 50 + n, mine });
    }
  });
  // 大胜：一场 +40 以上
  const top = order[0];
  const big = t.scores[top] - 25000;
  if (big >= 40000 && !out.some((x) => x.weight >= 60)) out.push({ table: t.name, text: `${l.players[t.seats[top]].name}一场 ${pts(big)}，大胜`, weight: 38 + big / 10000, mine: t.seats[top] === l.mine });
  return out;
}

// 第 r 场的快报：最热闹的 max 条，一桌最多两条；和玩家有关的加一点分
export function roundNews(l: League, r: number, max = 4): NewsItem[] {
  const all = roundTables(l, r).flatMap((t) => tableNews(l, t));
  all.sort((a, b) => b.weight + (b.mine ? 5 : 0) - (a.weight + (a.mine ? 5 : 0)));
  const per = new Map<string, number>();
  const out: NewsItem[] = [];
  for (const n of all) {
    if (out.length >= max) break;
    const c = per.get(n.table) ?? 0;
    if (c >= 2) continue;
    per.set(n.table, c + 1);
    out.push(n);
  }
  return out;
}

// 积分榜上放哪一场的快报：这一场已经有桌出了热闹的结果就放这一场，不然放上一场
export function latestNews(l: League): { round: number; items: NewsItem[] } | null {
  const now = Math.min(l.round, TOTAL_ROUNDS - 1);
  for (const r of [now, now - 1]) {
    if (r < 0) continue;
    const items = roundNews(l, r);
    if (items.length) return { round: r, items };
  }
  return null;
}

// ---------- 对局词条 ----------

export const isFocus = (t: SoloTable): boolean => t.name === FINAL_TABLE || (t.round >= FOCUS_FROM && t.round < PRELIM_ROUNDS && t.name === 'A 桌');

export interface TableTag {
  label: string;
  note: string; // 鼠标移上去的说明 / 底栏上的话
}

// 以前同桌过、在那一桌名次压过玩家的人
function beatMeBefore(l: League, t: SoloTable): number[] {
  const out: number[] = [];
  for (const old of l.tables) {
    if (old.round >= t.round || !old.scores || !old.seats.includes(l.mine)) continue;
    const me = old.scores[old.seats.indexOf(l.mine)];
    for (const p of t.seats) if (p !== l.mine && old.seats.includes(p) && old.scores[old.seats.indexOf(p)] > me && !out.includes(p)) out.push(p);
  }
  return out;
}

export function tableTags(l: League, t: SoloTable): TableTag[] {
  const tags: TableTag[] = [];
  const schools = new Map<string, number[]>();
  for (const p of t.seats) schools.set(l.players[p].school, [...(schools.get(l.players[p].school) ?? []), p]);
  // 一桌两对同校也只挂一个
  const mates = [...schools.values()].filter((ps) => ps.length >= 2);
  if (mates.length) tags.push({ label: '同门内战', note: mates.map((ps) => `${ps.map((p) => l.players[p].name).join('、')}是同校`).join('；') });
  const seeds = t.seats.filter((p) => l.players[p].seed);
  if (seeds.length >= 3 && t.name !== FINAL_TABLE) tags.push({ label: '死亡之组', note: `${seeds.length} 名种子同桌` });
  if (t.seats.includes(l.mine)) {
    const rivals = beatMeBefore(l, t);
    if (rivals.length) tags.push({ label: '复仇之战', note: `${rivals.map((p) => l.players[p].name).join('、')}之前同桌时压过你` });
  }
  return tags;
}

// ---------- 卡线提示 ----------

// 预赛最后两轮、玩家这一场还没打时：按「别人这一场都 ±0」估，要进前 4 这一场大概要多少
export function bubbleHint(l: League): string | null {
  const r = l.round;
  if (r < PRELIM_ROUNDS - 2 || r >= PRELIM_ROUNDS) return null;
  const t = roundTables(l, r).find((x) => x.seats.includes(l.mine));
  if (!t || t.scores) return null;
  // 这一场开打前的积分（这一场别桌已经出的结果不算，大家都按上一轮完的时候比）
  const before = (p: number) => standingOf(l, p).total - (roundTables(l, r).reduce((a, x) => a + (netOf(x, p) ?? 0), 0));
  const me = before(l.mine);
  const others = l.players.map((_, p) => p).filter((p) => p !== l.mine).map(before).sort((a, b) => b - a);
  const line = others[FINALISTS - 1]; // 别人里的第 4 名
  const last = r === PRELIM_ROUNDS - 1;
  const span = last ? '这一场' : '最后两场加起来';
  // 名次和积分榜上写的一样（同分时的先后照积分榜）
  const rank = prelimStandings(l).findIndex((x) => x.p === l.mine) + 1;
  if (me > line) return `第 ${rank} 名，比第 5 名多 ${pts(me - line).slice(1)}：${span}只要别输超过这么多就守得住决赛线（按别人${last ? '这一场' : ''}±0 估）。`;
  return `第 ${rank} 名，离决赛线（第 4 名 ${pts(line)}）差 ${pts(line - me + 100).slice(1)}：${span}大概要 ${pts(line - me + 100)} 以上（按别人${last ? '这一场' : ''}±0 估）。`;
}

export const newsTitle = (r: number) => `${roundName(r)}快报`;

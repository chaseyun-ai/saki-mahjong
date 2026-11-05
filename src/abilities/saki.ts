import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { type Kind, type TileId, kindLabel, kindOf, toCounts } from '../engine/tiles';
import { awaiWaitingForCorner } from './awai';
import { avoidOwnUra } from './doraControl';
import type { Ability } from './types';

// 宫永咲（清澄）：岭上开花。
// - 王牌感知：看得到 4 张岭上牌，也知道自己的杠材（刻子、碰的第四张）在牌山哪里（界面上杠材的第四张一直透明、在牌山前面投影出牌面，
//   鼠标移到岭上牌上时岭上牌也投影出来）。
//   电脑照这个打：听牌前不杠，岭上牌能让手牌前进才提前杠（杠来进手）；淡等着转角暗杠时，留着岭上那张牌的对子、刻子，等淡打出来大明杠
// - 杠的气息：杠完能听牌时，容易摸到第四张；对子容易长成刻子。听牌开杠，岭上牌就是和了牌
// - 配牌偏对子：淡的时间迟滞只把她压到 SAKI.awaiLag 向听（原作里别人五向听，她七对子四向听）
// - 天意（正负零）：她下意识地往 29500–30500 打。离得太远（落后）时天意发力，领先太多就收手
// - 她的杠一般不给自己加宝牌：她开杠翻出的杠宝牌、她和牌时的里宝牌不指向她自己的牌（doraControl），岭上摸到赤宝牌照常可以
// - 会被稳乃的深山削弱，满 6 个标记的稳乃在场时失效
// 强度参数（测试和平衡脚本会临时改它们）
export const SAKI = {
  kanTile: 0.8, // 杠完能听牌时，下一张摸到第四张
  pairTile: 0.3, // 没立直时，对子长成刻子
  rinshanWin: 1, // 听牌开杠，岭上牌是和了牌
  dealPairs: 2, // 配牌至少几个对子（刻子也算）
  dealPairExtra: 0.4, // 再多一个对子的概率
  awaiLag: 4, // 淡的时间迟滞只压到几向听
  // 天意：正负零的目标
  target: 30000,
  band: 500,
  pushBelow: 8000, // 比目标少这么多：天意发力
  calmAbove: 8000, // 比目标多这么多：收手
  push: { kanTile: 1, pairTile: 0.5, rinshanWin: 1 },
  calm: { kanTile: 0.45, pairTile: 0.12, rinshanWin: 0.75 },
};

export type SakiMood = 'push' | 'even' | 'calm';

// 天意：现在离正负零多远
export function sakiMood(g: Game, seat: number): SakiMood {
  const d = g.players[seat].score - SAKI.target;
  if (d <= -SAKI.pushBelow) return 'push';
  if (d >= SAKI.calmAbove) return 'calm';
  return 'even';
}

function power(g: Game, seat: number) {
  const m = sakiMood(g, seat);
  return m === 'push' ? SAKI.push : m === 'calm' ? SAKI.calm : SAKI;
}

function handKinds(g: Game, seat: number, n: number): number[] {
  const counts = toCounts(g.players[seat].hand);
  const kinds: number[] = [];
  for (let k = 0; k < 34; k++) if (counts[k] === n) kinds.push(k);
  return kinds;
}

// 杠材：手里的暗刻、碰出去的刻子
export function sakiKanKinds(g: Game, seat: number): Kind[] {
  const kinds = handKinds(g, seat, 3);
  for (const m of g.players[seat].melds) if (m.type === 'pon') kinds.push(kindOf(m.tiles[0]));
  return kinds;
}

// 摸到第四张开杠以后（手里 13 张时算）能不能听牌
function readyAfterKan(g: Game, seat: number, k: Kind): boolean {
  const p = g.players[seat];
  const c = toCounts(p.hand);
  if (c[k] >= 3) {
    c[k] -= 3;
    return waitingKinds(c, p.melds.length + 1).length > 0;
  }
  return waitingKinds(c, p.melds.length).length > 0;
}

// 王牌感知：牌山里她杠材的第四张（一直看得见）。岭上牌她也看得穿（g.wall.rinshan）
export function sakiKanTiles(g: Game, seat: number): Set<TileId> {
  const kinds = new Set(sakiKanKinds(g, seat));
  return new Set(g.wall.live.filter((t) => kinds.has(kindOf(t))));
}

// 她看得穿的全部牌：岭上牌和牌山里杠材的第四张
export function sakiSeesThrough(g: Game, seat: number): Set<TileId> {
  return new Set([...g.wall.rinshan, ...sakiKanTiles(g, seat)]);
}

// 淡在等转角暗杠：她摸的岭上牌是现在的第一张岭上牌。淡立直了只能打出来
export function sakiAwaiFeed(g: Game, seat: number): Kind | null {
  if (!g.wall.rinshan.length) return null;
  for (let s = 0; s < 4; s++) {
    if (s === seat || g.active(s)?.id !== 'awai') continue;
    if (awaiWaitingForCorner(g, s) !== null) return kindOf(g.wall.rinshan[0]);
  }
  return null;
}

// 配牌偏对子：把孤张换成另一张孤张的同种牌，凑到 want 个对子
function pairUp(g: Game, seat: number, want: number): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  for (let n = 0; n < 4; n++) {
    const counts = toCounts(mine.map((i) => w.live[i]));
    if (counts.filter((c) => c >= 2).length >= want) return;
    const singles = new Set(counts.flatMap((c, k) => (c === 1 ? [k] : [])));
    if (singles.size < 2) return;
    let done = false;
    for (const i of g.rng.shuffle(mine.filter((j) => singles.has(kindOf(w.live[j]))))) {
      const k = kindOf(w.live[i]);
      if (w.bringToLive(i, (t) => kindOf(t) !== k && singles.has(kindOf(t)), g.rng, (j) => j >= 52)) {
        done = true;
        break;
      }
    }
    if (!done) return;
  }
}

export const sakiAbility: Ability = {
  id: 'saki',
  name: '岭上开花',
  description: `王牌感知：牌山里自己杠材的第四张一直是透明的，牌山前面投影出牌面；鼠标移到岭上牌上，岭上牌也投影出来。杠的气息：杠完能听牌时 ${SAKI.kanTile * 100}% 摸到第四张，对子容易长成刻子；听牌开杠，岭上牌就是和了牌。配牌偏对子，淡的时间迟滞只压到 ${SAKI.awaiLag} 向听。天意：往正负零（${SAKI.target - SAKI.band}–${SAKI.target + SAKI.band}）打，落后 ${SAKI.pushBelow} 以上时天意发力，领先 ${SAKI.calmAbove} 以上收手。她的杠一般不给自己加宝牌、里宝牌（岭上的赤宝牌照拿）。`,

  lagShanten: SAKI.awaiLag,

  beforeDeal(g, seat) {
    pairUp(g, seat, SAKI.dealPairs + (g.rng.chance(SAKI.dealPairExtra) ? 1 : 0));
  },

  beforeDraw(g: Game, seat: number, rinshan: boolean) {
    const p = g.players[seat];
    const pw = power(g, seat);
    if (rinshan) {
      const waits = waitingKinds(toCounts(p.hand), p.melds.length);
      if (waits.length === 0 || !g.rng.chance(pw.rinshanWin)) return;
      if (g.wall.bringToRinshan((t) => waits.includes(kindOf(t)), g.rng)) {
        g.emit({ type: 'ability', seat, ability: 'saki', text: '岭上开花' });
      }
      return;
    }
    if (g.totalKans() >= 4 || g.wall.remaining <= 1) return;
    // 杠的气息：杠完能听牌的刻子才来第四张
    const kinds = sakiKanKinds(g, seat).filter((k) => readyAfterKan(g, seat, k));
    if (kinds.length > 0 && g.rng.chance(pw.kanTile)) {
      if (g.wall.bringToLive(0, (t) => kinds.includes(kindOf(t)), g.rng)) {
        g.emit({ type: 'ability', seat, ability: 'saki', text: '杠的气息' });
        return;
      }
    }
    // 对子容易长成刻子，为开杠做准备。淡等着转角暗杠时，先长岭上那张牌的对子（等淡打出来大明杠）
    if (p.riichi) return;
    const pairs = handKinds(g, seat, 2);
    if (pairs.length === 0 || !g.rng.chance(pw.pairTile)) return;
    const feed = sakiAwaiFeed(g, seat);
    if (feed !== null && pairs.includes(feed) && g.wall.bringToLive(0, (t) => kindOf(t) === feed, g.rng)) return;
    g.wall.bringToLive(0, (t) => pairs.includes(kindOf(t)), g.rng);
  },

  // 和牌时里宝牌不指向她自己的牌
  claimUra(g, seat, winTile) {
    avoidOwnUra(g, seat, winTile);
  },

  badge(g, seat) {
    const m = sakiMood(g, seat);
    return m === 'push' ? '天意' : null;
  },

  insight(g, seat) {
    const kinds = sakiKanKinds(g, seat);
    const m = sakiMood(g, seat);
    const mood = m === 'push' ? '天意发力中（离正负零太远）' : m === 'calm' ? '领先太多，收着打' : '在正负零附近';
    return [kinds.length ? `在等杠：${kinds.map(kindLabel).join('、')}` : '手里还没有能杠的刻子', '听牌后开杠，岭上牌就是和了牌', mood];
  },
};

// 电脑的咲：要不要开这个杠。after 是杠完的手牌（张数），melds 是杠完的副露数
export function sakiKanOk(g: Game, seat: number, after: number[], melds: number): boolean {
  const p = g.players[seat];
  if (p.riichi || g.wall.remaining <= 8) return true;
  const sh = shanten(after, melds);
  if (sh === 0) return true;
  // 杠来进手：她看得到岭上牌，摸进来能前进（或者又是一个杠材）就杠
  const next = g.wall.rinshan[0];
  if (next === undefined) return false;
  const k = kindOf(next);
  if (after[k] === 3) return true;
  const c = after.slice();
  c[k]++;
  return shanten(c, melds) < sh;
}

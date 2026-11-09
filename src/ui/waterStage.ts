import { isDoraTile } from '../abilities/kuro';
import type { Game, Stage } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, isRed, kindOf, toCounts } from '../engine/tiles';

// 「衣 · 海底捞月测试」：每一局都让海底归她、一路平静地打到海底自摸，看海水一点点没过牌山、最后捞月砸牌。
// - 她坐庄家的下家（没人鸣牌时最后一张就是她摸），开局时 app 安排好起家
// - 配牌：她一上来就听牌（123m 456m 789p 99s 34s，听 2s、5s），海底捞月一发动她就听着牌，别家鸣不了牌
// - 和了牌（2s、5s）只在牌山最后留一张（就是海底），其余的都藏进王牌：谁都摸不到、打不出来，
//   电脑的她不会提前荣和，也不会因为看着和了牌一张张被打出来而改听
// - 没人鸣牌、开杠时谁摸牌山的哪一张是定好的：她要摸的那几张先摆成用不上的孤张（电脑的她摸什么切什么，听牌一直不变）
// - 别家摸不到让自己听牌的牌（不然荣和、立直把这一局抢走），也凑不成九种九牌、四张一样的（暗杠的岭上摸牌会把海底挪走）
// 牌是在所有能力动完以后才摆的（Game 的 stage）

// 测试局的对手：没有能力的三位（国广一、泽村智纪、二条泉），不会用能力把海底挪走
export const SEA_TEST_OPPONENTS = ['hajime', 'tomoki', 'izumi'];

export const SEA_HAND = [0, 1, 2, 3, 4, 5, 15, 16, 17, 26, 26, 20, 21];
export const SEA_WAITS = [19, 22];

// 配牌发掉的是牌山前 52 张
const DEALT = 52;

const swap = (a: TileId[], i: number, b: TileId[], j: number) => ([a[i], b[j]] = [b[j], a[i]]);
const isWait = (t: TileId) => SEA_WAITS.includes(kindOf(t));
const isYaochu = (k: number) => k >= 27 || k % 9 === 0 || k % 9 === 8;

// 手里用不上的孤张：手里没有，数牌前后两格也没有同花色的牌
function stray(counts: number[], k: number): boolean {
  if (counts[k] > 0) return false;
  if (k >= 27) return true;
  return [-2, -1, 1, 2].every((d) => (k % 9) + d < 0 || (k % 9) + d > 8 || counts[k + d] === 0);
}

// 王牌里没公开的：岭上牌、没翻开的宝牌指示牌、里宝牌指示牌
const hiddenPools = (g: Game) => [[g.wall.rinshan, 0], [g.wall.doraIndicators, g.wall.doraRevealed], [g.wall.uraIndicators, 0]] as [TileId[], number][];

// live[i] 换成 ok 的牌：先在牌山里 from 允许的位置找，找不到再从王牌里没公开的找
function fill(g: Game, i: number, ok: (t: TileId) => boolean, from: (j: number) => boolean): boolean {
  const w = g.wall;
  const good = (t: TileId) => ok(t) && !w.locked.has(t);
  const j = w.live.findIndex((t, j) => j !== i && from(j) && good(t));
  if (j >= 0) {
    swap(w.live, i, w.live, j);
    return true;
  }
  for (const [pool, start] of hiddenPools(g)) {
    const d = pool.findIndex((t, d) => d >= start && good(t));
    if (d < 0) continue;
    swap(w.live, i, pool, d);
    return true;
  }
  return false;
}

function stageDeal(g: Game, seat: number): void {
  const w = g.wall;
  const last = w.live.length - 1;
  const mine = new Set(g.dealIndices(seat));
  // 配牌以后她摸的是牌山的第 1、5、9……张（庄家摸第 0 张），最后一张就是海底
  const hers = (j: number) => j >= DEALT && (j - DEALT) % 4 === 1;
  // 配牌以外、海底以前、不是她要摸的位置：随便拿来换
  const spare = (j: number) => j >= DEALT && j < last && !hers(j);

  // 她的配牌摆成 SEA_HAND：多出来的和缺的那种对换
  const want = [...SEA_HAND];
  const extra: number[] = [];
  for (const i of mine) {
    const j = want.indexOf(kindOf(w.live[i]));
    if (j >= 0 && !isRed(w.live[i])) want.splice(j, 1);
    else extra.push(i);
  }
  for (const i of extra) {
    const k = want.shift();
    if (k === undefined) break;
    fill(g, i, (t) => kindOf(t) === k && !isRed(t), (j) => !mine.has(j));
  }

  // 和了牌：牌山最后一张放一张，别的（别家配牌里的、牌山里的）和王牌里没公开的别的牌对换
  if (!isWait(w.live[last]) && !w.locked.has(w.live[last])) fill(g, last, isWait, (j) => !mine.has(j));
  for (let i = 0; i < last; i++) {
    const t = w.live[i];
    if (mine.has(i) || !isWait(t) || w.locked.has(t)) continue;
    for (const [pool, start] of hiddenPools(g)) {
      const d = pool.findIndex((u, d) => d >= start && !isWait(u) && !w.locked.has(u));
      if (d < 0) continue;
      swap(w.live, i, pool, d);
      break;
    }
  }
  // 藏起来的锁住：海底捞月挑海底牌时只看得到牌山最后那一张（不然挑中藏在王牌里的那种，海底就定不下来）
  for (const [pool, start] of hiddenPools(g)) {
    for (let d = start; d < pool.length; d++) if (isWait(pool[d])) w.locked.add(pool[d], 'stage');
  }

  // 别家配牌：四张一样的拆掉一张，幺九牌拆到七种以内（庄家多摸一张也凑不成九种九牌）
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const idx = g.dealIndices(s);
    const counts = toCounts(idx.map((i) => w.live[i]));
    const kinds = () => counts.filter((n, k) => n > 0 && isYaochu(k)).length;
    for (const i of idx) {
      const k = kindOf(w.live[i]);
      const quad = counts[k] >= 4;
      if (!quad && !(isYaochu(k) && counts[k] === 1 && kinds() >= 8)) continue;
      const ok = (t: TileId) => !isWait(t) && !isYaochu(kindOf(t)) && counts[kindOf(t)] < 3;
      const before = w.live[i];
      if (w.locked.has(before) || !fill(g, i, ok, spare)) continue;
      counts[kindOf(before)]--;
      counts[kindOf(w.live[i])]++;
    }
  }

  // 她要摸的那几张：用不上的孤张，不是宝牌（第一张也不是风牌，免得凑出四风连打）
  const handCounts = toCounts(SEA_HAND.map((k) => k * 4));
  const quiet = (t: TileId) => !isWait(t) && stray(handCounts, kindOf(t)) && !isDoraTile(g, t);
  for (let i = DEALT + 1; i < last; i += 4) {
    const ok = i === DEALT + 1 ? (t: TileId) => quiet(t) && (kindOf(t) < 27 || kindOf(t) > 30) : quiet;
    if (!ok(w.live[i])) fill(g, i, ok, spare);
  }
}

// 下一张（live[0]）不是 bad 的牌：和 from 允许的位置换（不动最后一张海底和锁住的牌），牌山里没有就和王牌里没公开的换。
// 条件从严到松一条条试：严的找不到能换的牌就退一步
function avoid(g: Game, from: (j: number) => boolean, ...bads: ((t: TileId) => boolean)[]): void {
  const w = g.wall;
  if (w.live.length < 2 || w.locked.has(w.live[0])) return;
  for (const bad of bads) {
    if (!bad(w.live[0])) return;
    if (fill(g, 0, (t) => !bad(t), (j) => j > 0 && j < w.live.length - 1 && from(j))) return;
  }
}

// 她往后要摸的那几张（第 0 张以后）要是被能力换掉了（一向听地狱、满潮会把牌山里的牌换来换去），
// 从别人要摸的位置、王牌里没公开的牌里找用不上的孤张补回来
function keepQuiet(g: Game, hers: (j: number) => boolean, quiet: (t: TileId) => boolean): void {
  const w = g.wall;
  const last = w.live.length - 1;
  for (let j = 1; j < last; j++) {
    if (hers(j) && !quiet(w.live[j]) && !w.locked.has(w.live[j])) fill(g, j, quiet, (k) => k > 0 && k < last && !hers(k));
  }
}

function stageDraw(g: Game, seat: number, rinshan: boolean, me: number): void {
  if (rinshan || g.wall.live.length < 2) return;
  const q = g.players[seat];
  const counts = toCounts(q.hand);
  // 牌山的第 j 张是谁摸：这一张是 seat 摸，往后一家一张轮下去
  const hers = (j: number) => (seat + j) % 4 === me;
  const herCounts = toCounts(g.players[me].hand);
  const quiet = (t: TileId) => !isWait(t) && stray(herCounts, kindOf(t)) && !isDoraTile(g, t);
  keepQuiet(g, hers, quiet);
  if (seat === me) {
    // 别家的能力换过她这一张时：先从她自己往后要摸的那几张里找孤张，再退一步
    const strict = (t: TileId) => !quiet(t);
    avoid(g, hers, strict);
    avoid(g, () => true, strict, (t) => isWait(t) || counts[kindOf(t)] >= 2, isWait);
    return;
  }
  avoid(
    g,
    (j) => !hers(j),
    (t) => {
      if (isWait(t) || counts[kindOf(t)] >= 3) return true;
      counts[kindOf(t)]++;
      // 摸进来以后打掉一张能听牌：十四张的向听 ≤ 0
      const sh = shanten(counts, q.melds.length);
      counts[kindOf(t)]--;
      return sh <= 0;
    },
    // 实在躲不开时宁可让人听牌（听了牌也不能自摸），也不能开杠
    (t) => isWait(t) || counts[kindOf(t)] >= 3,
    isWait,
  );
}

export function koromoSeaStage(me: number): Stage {
  return {
    deal: (g) => stageDeal(g, me),
    draw: (g, seat, rinshan) => stageDraw(g, seat, rinshan, me),
  };
}

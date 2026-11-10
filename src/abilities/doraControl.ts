import type { Game } from '../engine/game';
import { KIND_COUNT, Kind, TileId, doraFromIndicator, kindOf, toCounts } from '../engine/tiles';
import { awaiKanUra } from './awai';
import { SHIZUNO, shizunoDora, shizunoMist } from './shizuno';

// 宝牌控制的统一入口。宝牌、杠宝牌、里宝牌分三个时刻定，每个时刻按同一张优先级表，上面的规矩下面不能违反：
// 1. 松实玄（能力还在）：别人手里不会有宝牌、赤宝牌，和牌也中不了里宝牌，新翻的杠宝牌不指向别人手里、副露已有的牌。谁都改不了
// 2. 高鸭稳乃深山（满 6 个标记）：开局宝牌、杠宝牌往她手里最多的牌变（shizuno.ts 自己定），她和牌时里宝牌也是
// 2b. 稳乃起雾（雾 L 级）：别家立直和牌时里宝牌按雾的浓度避开和牌那家（mistUra），淡的杠里按雾的浓度少中几张。
//     排在和牌的人自己的控里能力后面做，所以压得过它们；immune、absolute 的人（姬子拿钥匙、涅莉押 3 点、照）不受影响
// 3. 和牌的人自己的控里能力（Ability.claimUra：爽的海神威、涅莉押 2、3 点、稳乃、咲的自我限制）。只有和牌的那家算，所以互不冲突
// 4. 宫永咲：她开杠翻出的杠宝牌、她和牌时的里宝牌不指向她自己的牌（岭上摸到赤宝牌照常可以）。
//    这是她的控场能力，会被稳乃削弱；满 6 个标记的稳乃在场时直接失效（决赛大将战那次杠出了里宝牌）
//
// 开局宝牌在发牌时定（涅莉、稳乃的 beforeDeal）；杠宝牌在翻开前一刻定（settleKanDora）；里宝牌在和牌时定（settleUra）。
// 都是盖着的牌，翻开前换指示牌不违反“只换没公开的牌”。

// 玄的能力还在的那一家（没有就是 null）
export function kuroSeat(g: Game): number | null {
  for (let s = 0; s < 4; s++) {
    const a = g.abilities[s];
    if (a?.id === 'kuro' && g.isAbsolute(s) && !(g.abilityGameState[s] as { lost?: boolean }).lost) return s;
  }
  return null;
}

// 有满 6 个标记的稳乃在场（她的控宝牌压过咲的限制）
export function shizunoMountain(g: Game): boolean {
  return [0, 1, 2, 3].some((s) => g.active(s)?.id === 'shizuno' && shizunoDora(g, s));
}

// 一家现在的牌：手牌、副露（extra 是荣和的那张）
export function tilesOf(g: Game, seat: number, extra?: TileId): TileId[] {
  const p = g.players[seat];
  return [...p.hand, ...p.melds.flatMap((m) => m.tiles), ...(extra !== undefined ? [extra] : [])];
}

const indicatorOf = (want: Kind) => (t: TileId) => doraFromIndicator(kindOf(t)) === want;

// 把一张指示牌换成“指向的牌 avoid 里越少越好、prefer 里越多越好”。现在的已经最好就不换；换不到最好的就退一步
function steerAway(current: TileId, avoid: number[], prefer: number[] | null, bring: (pred: (t: TileId) => boolean) => boolean): void {
  const score = (k: Kind) => avoid[k] * 100 - (prefer ? prefer[k] : 0);
  const cur = score(doraFromIndicator(kindOf(current)));
  const kinds = Array.from({ length: KIND_COUNT }, (_, k) => k)
    .filter((k) => score(k) < cur)
    .sort((a, b) => score(a) - score(b));
  for (const k of kinds) if (bring(indicatorOf(k))) return;
}

// 第 i 张宝牌指示牌（杠宝牌）翻开前一刻：kanner 是开杠的人
export function settleKanDora(g: Game, i: number, kanner: number | undefined): void {
  const w = g.wall;
  if (i >= w.doraIndicators.length) return;
  // 不拿下一张要摸的牌来换：指示牌是打完牌才翻的，那一刻没有人看得到牌山动了（能力回放只在摸牌时对账）
  const bring = (pred: (t: TileId) => boolean) => w.bringToDora(i, pred, g.rng, (j) => j > 0);
  const kuro = kuroSeat(g);
  if (kuro !== null) {
    const others = toCounts([0, 1, 2, 3].filter((s) => s !== kuro).flatMap((s) => tilesOf(g, s)));
    steerAway(w.doraIndicators[i], others, toCounts(tilesOf(g, kuro)), bring);
    return;
  }
  // 稳乃满 6 个标记：她在自己打牌后已经定好了还没翻的杠宝牌，咲的限制不起作用
  if (shizunoMountain(g)) return;
  if (kanner !== undefined && g.active(kanner)?.id === 'saki' && !g.quelled(kanner) && !g.damped(kanner)) {
    steerAway(w.doraIndicators[i], toCounts(tilesOf(g, kanner)), null, bring);
  }
}

// 有人和牌：里宝牌这时才定。winners 按头跳顺序，winTile 是荣和的那张（自摸不给）。杠宝牌要先翻完（settleKanDora）
// 玄挡住所有和牌的别家；控里的能力只看第一家（一炮双响时后面的人用同一组里宝牌）
export function settleUra(g: Game, winners: number[], winTile?: TileId): void {
  const w = g.wall;
  const kuro = kuroSeat(g);
  const blocked = winners.filter((s) => s !== kuro && g.players[s].riichi);
  if (kuro !== null && blocked.length) {
    const theirs = toCounts(blocked.flatMap((s) => tilesOf(g, s, winTile)));
    // 牌山摸光了、岭上牌又被咲看着（锁住）时没有牌可换：没翻开的宝牌指示牌也拿来换
    for (let i = 0; i < w.doraRevealed; i++) steerAway(w.uraIndicators[i], theirs, null, (pred) => w.bringToUra(i, pred, g.rng, undefined, true));
    return;
  }
  const winner = winners[0];
  if (!g.players[winner].riichi) return;
  const own = g.active(winner);
  if (own?.claimUra && !g.quelled(winner) && !g.damped(winner)) own.claimUra(g, winner, winTile);
  mistUra(g, winner, winTile);
}

// 淡的杠里不受影响中四张；雾 L 级时最多中几张：1 级一半照旧、一半 2 张，2 级 2 张，3 级 1 张，4 级 0 张（期望 3、2、1、0）
function kanUraCap(g: Game, L: number): number {
  if (L <= 0) return 4;
  if (L === 1) return g.rng.chance(0.5) ? 4 : 2;
  return [4, 2, 2, 1, 0][Math.min(L, 4)];
}

// 稳乃的雾压别家立直和牌的里宝牌（她自己和牌时是 claimUra，不走这里）
function mistUra(g: Game, winner: number, winTile?: TileId): void {
  const sz = [0, 1, 2, 3].find((s) => s !== winner && g.active(s)?.id === 'shizuno' && shizunoMist(g, s) > 0 && !g.quelled(s));
  if (sz === undefined || g.isImmune(winner) || g.isAbsolute(winner)) return;
  const L = shizunoMist(g, sz);
  const w = g.wall;
  const theirs = toCounts(tilesOf(g, winner, winTile));
  const mine = toCounts(tilesOf(g, sz));
  const hits = (t: TileId) => theirs[doraFromIndicator(kindOf(t))];
  const kan = g.active(winner)?.id === 'awai' ? awaiKanUra(g, winner) : undefined;
  for (let i = 0; i < w.doraRevealed; i++) {
    const bring = (pred: (t: TileId) => boolean) => w.bringToUra(i, pred, g.rng);
    if (i === kan) {
      // 杠里：换成中得不超过 cap 张、尽量接近 cap 的指示牌（换不到就再少一张）
      const cap = kanUraCap(g, L);
      if (hits(w.uraIndicators[i]) <= cap) continue;
      for (let n = cap; n >= 0; n--) if (bring((t) => hits(t) === n)) break;
      continue;
    }
    if (g.rng.chance(SHIZUNO.mistUra[Math.min(L, SHIZUNO.mistUra.length - 1)])) steerAway(w.uraIndicators[i], theirs, mine, bring);
  }
}

// 咲和牌时：里宝牌不指向她自己的牌（满 6 个标记的稳乃在场时不管）
export function avoidOwnUra(g: Game, seat: number, winTile?: TileId): void {
  if (shizunoMountain(g)) return;
  const w = g.wall;
  const mine = toCounts(tilesOf(g, seat, winTile));
  for (let i = 0; i < w.doraRevealed; i++) steerAway(w.uraIndicators[i], mine, null, (pred) => w.bringToUra(i, pred, g.rng));
}

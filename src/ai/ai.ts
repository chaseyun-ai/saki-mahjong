import type { AiStyle } from '../abilities/characters';
import { awaiStarPlan, awaiStarsExtra, awaiWaitingForCorner } from '../abilities/awai';
import { dangerKinds, readOthers } from '../abilities/hiroe';
import { shiromiRipple } from '../abilities/shiromi';
import { angelDanger, nodokaAngel } from '../abilities/nodoka';
import { momoStealthNext } from '../abilities/momo';
import { ryuukaMugoku, ryuukaSensesTenpai } from '../abilities/ryuuka';
import { SERA, seraYakuhai } from '../abilities/sera';
import { SUMIRE, sumireAimedAt, sumireMarks, sumireTarget } from '../abilities/sumire';
import { forecastNextDraw } from './forecast';
import { kasumiSuit } from '../abilities/kasumi';
import { KOROMO_READERS, koromoDisruptor, koromoHaiteiOn } from '../abilities/koromo';
import { mihokoEyeOpen, mihokoLikelySafe, mihokoSafeKinds } from '../abilities/mihoko';
import { akoDistance, akoSense } from '../abilities/ako';
import { seikoFish } from '../abilities/seiko';
import { warmKind } from '../abilities/yu';
import { yuukiActive } from '../abilities/yuuki';
import { makoDanger, makoSuit } from '../abilities/mako';
import { KYOUKO, kyoukoTargets } from '../abilities/kyouko';
import { takamiHarvest, takamiSeeds } from '../abilities/takami';
import { NELLY, nellyBigDiscard, nellyBigReady, nellyDue, nellyFlush, nellyLiveWaits, nellySenses, nellySensesTenpai, nellySuit, nellyTarget, nellyTier, nellyTurn } from '../abilities/nelly';
import { sawayaActive, sawayaFocus } from '../abilities/sawaya';
import { komakiActiveGod } from '../abilities/komaki';
import { toyoneLurks, toyoneMode } from '../abilities/toyone';
import { TERU, teruDanger, teruFits, teruLadder, teruMirrored, teruTier, teruWinValue } from '../abilities/teru';
import { isDoraTile, kuroLost } from '../abilities/kuro';
import { himekoExtra, himekoPlan } from '../abilities/himeko';
import { bowlingOf, isPin } from '../abilities/arata';
import { hatsumiOpen } from '../abilities/hatsumi';
import { JUN } from '../abilities/jun';
import { tokaChisui } from '../abilities/toka';
import { kaoriYakuman } from '../abilities/kaori';
import { hirokoBias, hirokoDisrupt } from '../abilities/hiroko';
import { haruRush } from '../abilities/haru';
import { aislinnAiBrush, aislinnExtra, aislinnPlan } from '../abilities/aislinn';
import { sakiAwaiFeed, sakiKanOk } from '../abilities/saki';
import type { Action, Game } from '../engine/game';
import { evaluateWin } from '../engine/score';
import { kokushiShanten, shanten, standardShanten, waitingKinds } from '../engine/shanten';
import {
  EAST,
  KIND_COUNT,
  Kind,
  TileId,
  doraFromIndicator,
  isDragon,
  isHonor,
  isSimple,
  isWind,
  isYaochu,
  kindOf,
  toCounts,
} from '../engine/tiles';

// 规则型电脑对手：牌效 + 简单防守 + 会用自己的能力

export function chooseAction(g: Game, seat: number, style: AiStyle): Action {
  const legal = g.legalActions(seat);
  if (legal.length === 0) throw new Error(`座位 ${seat} 没有可做的操作`);
  if (style.gods) style = komakiStyle(g, seat, style);
  return g.phase === 'calls' ? chooseCall(g, seat, legal, style) : chooseTurn(g, seat, legal, style);
}

// 神代小莳：按附身的神换打法
function komakiStyle(g: Game, seat: number, style: AiStyle): AiStyle {
  switch (komakiActiveGod(g, seat)) {
    case 'sakuya':
      return { ...style, kanEager: true };
    case 'susanoo':
      return { ...style, fish: true };
    case 'amaterasu':
      return { ...style, reads: true };
    default:
      return style;
  }
}

// ---------- 可见牌统计 ----------

function visibleCounts(g: Game, seat: number): number[] {
  const c = new Array<number>(KIND_COUNT).fill(0);
  const add = (t: TileId) => c[kindOf(t)]++;
  g.players[seat].hand.forEach(add);
  for (const p of g.players) {
    // 隐身的桃子的牌河、副露看不见
    if (g.stealthed(p.seat, seat)) continue;
    p.discards.forEach((d) => !d.called && add(d.tile));
    p.melds.forEach((m) => m.tiles.forEach(add));
  }
  g.wall.visibleDoraIndicators().forEach(add);
  return c;
}

function ukeire(counts: number[], melds: number, visible: number[]): number {
  const cur = shanten(counts, melds);
  let total = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    const left = 4 - visible[k];
    if (left <= 0) continue;
    counts[k]++;
    if (shanten(counts, melds) < cur) total += left;
    counts[k]--;
  }
  return total;
}

// 孤张价值：越低越该先打
function tileValue(g: Game, seat: number, k: Kind, counts: number[]): number {
  let v = 0;
  if (isHonor(k)) {
    const yakuhai = isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind;
    v = counts[k] >= 2 ? 4 : yakuhai ? 1 : 0;
  } else {
    const n = k % 9;
    for (const d of [-2, -1, 1, 2]) {
      const m = n + d;
      if (m >= 0 && m <= 8 && counts[k + d] > 0) v += Math.abs(d) === 1 ? 2 : 1;
    }
    if (counts[k] >= 2) v += 3;
    v += isYaochu(k) ? 0 : 1;
  }
  const doraKinds = g.wall.visibleDoraIndicators().map((i) => doraFromIndicator(kindOf(i)));
  if (doraKinds.includes(k)) v += 2;
  return v;
}

// ---------- 防守 ----------

// 诚子：鸣满这么多次、听牌了就必和，不弃和
const SEIKO_SURE = 3;

// 优希：东场坐庄的烂听牌，牌山剩这么多以上才默听等改良
const YUUKI_AI = { waitLate: 30 };

// 团体赛（点数是队伍的点数）：没落后太多就以不放铳为先；落后很多才拼
const TEAM_CHASE = 30000;
function teamCareful(g: Game, seat: number): boolean {
  if (g.format !== 'team') return false;
  const top = Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score));
  return top - g.players[seat].score < TEAM_CHASE;
}

// 要防的人：立直的、副露三组以上的（团体赛里小心的时候两组就防）
// 诚子鸣了两次也要防（再鸣一次就必和）；咲开过杠也要防（岭上开花）；憧鸣过牌以后靠距离感看得出谁听牌了
function threats(g: Game, seat: number): number[] {
  const melds = teamCareful(g, seat) ? 2 : 3;
  const sense = g.abilities[seat]?.id === 'ako' && akoSense(g, seat);
  // 龙华的无极天：看得出谁听牌了
  const mugoku = g.abilities[seat]?.id === 'ryuuka' && ryuukaMugoku(g, seat);
  const nelly = g.abilities[seat]?.id === 'nelly' && nellySenses(g, seat);
  return [0, 1, 2, 3].filter((s) => {
    if (s === seat) return false;
    const p = g.players[s];
    if (g.seesRiichi(s, seat)) return true;
    // 隐身的桃子：立没立直、听没听牌都看不出来，鸣的牌也不当回事
    if (g.stealthed(s, seat)) return false;
    if (sense) return akoDistance(g, s) === 0;
    if (mugoku) return ryuukaSensesTenpai(g, s);
    // 涅莉：手里还有运势就看得出谁听牌了
    if (nelly && !g.isSealed(seat)) return nellySensesTenpai(g, s);
    const id = g.abilities[s]?.id;
    if (g.isSealed(s)) return p.melds.length >= melds;
    return p.melds.length >= melds || (id === 'seiko' && seikoFish(g, s) >= 2) || (id === 'saki' && p.melds.some((m) => m.type.endsWith('kan')));
  });
}

// ---------- 场况 ----------

// 个人赛最后两局领先第二名这么多以上，就以不放铳为先
const LEAD_SAFE = 8000;
function leadCareful(g: Game, seat: number): boolean {
  if (g.format === 'team' || !g.isLastRounds(2)) return false;
  const second = Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score));
  return g.players[seat].score - second >= LEAD_SAFE;
}

// 个人赛最后一局：这手和了对局就结束，名次却一点没往上爬（也不是第一），牌山还有就先不和，等更大的
function allLastHold(g: Game, seat: number, tsumo: boolean): boolean {
  if (g.format === 'team' || !g.isLastRounds(1) || seat === g.dealer || g.wall.remaining <= 4) return false;
  const p = g.players[seat];
  const tile = tsumo ? p.drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
  const r = g.winResult(seat, tile, tsumo);
  if (!r) return false;
  const after = g.players.map((q) => q.score);
  const bonus = g.honba * 300 + g.riichiSticks * 1000;
  if (tsumo) {
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const pay = s === g.dealer ? r.tsumoDealerPays : r.tsumoOtherPays;
      after[s] -= pay;
      after[seat] += pay;
    }
  } else {
    const from = g.callKind === 'chankan' ? g.kakanInfo!.seat : g.lastDiscard!.seat;
    after[from] -= r.ron;
    after[seat] += r.ron;
  }
  after[seat] += bonus;
  const rank = (sc: number[]) => sc.filter((v, s) => s !== seat && v > sc[seat]).length;
  const rankAfter = rank(after);
  // 东风战东 4 局：没人到一位必要点数就南入，对局不结束
  if (g.format === 'east' && g.roundWind === 0 && Math.max(...after) < g.rules.target) return false;
  return rankAfter > 0 && rankAfter === rank(g.players.map((q) => q.score));
}

// 衣听牌的局，海底轮到她：返回衣的座位（别人鸣一手不退向听的牌，把摸牌顺序错开），不是就 null
function koromoHaiteiSeat(g: Game, seat: number, scout = false): number | null {
  const n = g.wall.live.length;
  if (n > 12) return null;
  const k = [0, 1, 2, 3].find((s) => s !== seat && g.abilities[s]?.id === 'koromo' && !g.isSealed(s) && koromoHaiteiOn(g, s));
  if (k === undefined) return null;
  // 有经验的人每局都会去错开，别人每局只有一定概率想得到
  if (!koromoDisruptor(g, k, seat, scout || KOROMO_READERS.includes(g.abilities[seat]?.id ?? ''))) return null;
  // 她听牌了（假装知道衣的海底），不鸣的话最后一张归她
  if (!g.waits(k).length) return null;
  return (g.lastDiscard!.seat + n) % 4 === k ? k : null;
}

// viewer 眼里 threat 的牌河（桃子隐身以后打的牌看不见）
function seenDiscards(g: Game, viewer: number, threat: number) {
  return g.stealthed(threat, viewer) ? [] : g.players[threat].discards;
}

function danger(g: Game, viewer: number, threat: number, k: Kind, visible: number[]): number {
  const p = g.players[threat];
  const river = seenDiscards(g, viewer, threat);
  const discarded = new Set(river.map((d) => kindOf(d.tile)));
  if (discarded.has(k)) return 0;
  // 立直之后别人打过而他没荣和的牌也安全
  if (g.seesRiichi(threat, viewer)) {
    const riichiTime = g.events.findIndex((e) => e.type === 'discard' && e.seat === threat && e.riichi);
    const after = g.events
      .slice(riichiTime + 1)
      .filter((e) => e.type === 'discard')
      .map((e) => (e.type === 'discard' ? kindOf(e.tile) : -1));
    if (after.includes(k)) return 0;
  }
  // 字牌：见得越多越安全（只剩单骑、双碰能和）
  if (isHonor(k)) return visible[k] >= 3 ? 1 : visible[k] === 2 ? 2 : visible[k] === 1 ? 4 : 5;
  const n = k % 9;
  const suji = (d: number) => n + d >= 0 && n + d <= 8 && discarded.has(k + d);
  const lowSafe = n < 3 || suji(-3);
  const highSafe = n > 5 || suji(3);
  const base = lowSafe && highSafe ? (n === 0 || n === 8 ? 2 : 4) : n === 0 || n === 8 ? 6 : n === 1 || n === 7 ? 8 : 10;
  // 染手：打了好几张牌、一张这门花色都没打过，这门花色的牌都危险（涅莉宣言局的清一色就是这样）
  const suit = Math.floor(k / 9);
  const shown = river.length + p.melds.length * 3;
  const offSuit = river.every((d) => kindOf(d.tile) >= 27 || Math.floor(kindOf(d.tile) / 9) !== suit);
  return shown >= 6 && offSuit ? Math.max(base, 9) + 3 : base;
}

// ---------- 自己的回合 ----------

function chooseTurn(g: Game, seat: number, legal: Action[], style: AiStyle): Action {
  const p = g.players[seat];
  const find = (t: Action['type']) => legal.find((a) => a.type === t);

  // 爱丽丝的手绘板：碎了先看要不要用画笔；画着就照画上的牌打，凑齐就自摸，听牌了立直
  aislinnAiBrush(g, seat);
  const sketch = aislinnPlan(g, seat);
  if (sketch) {
    const tsumo = find('tsumo');
    if (tsumo) return tsumo;
    const visible = visibleCounts(g, seat);
    const risk = (t: TileId) => Math.max(0, ...threats(g, seat).map((o) => danger(g, seat, o, kindOf(t), visible)));
    const extra = aislinnExtra(g, seat, sketch).sort((a, b) => risk(a) - risk(b));
    // 只差最后自摸的那张时才立直（不然手牌锁住、凑不齐画上的牌）
    const last = extra.length === 1 && sketch.needed.slice(sketch.step).filter((n) => n).length === 1;
    for (const t of extra) {
      const riichi = last ? legal.find((a) => a.type === 'discard' && a.riichi && a.tile === t) : undefined;
      const plain = legal.find((a) => a.type === 'discard' && !a.riichi && a.tile === t);
      if (riichi || plain) return riichi ?? plain!;
    }
  }

  // 姬子钥匙的那一局：照着那副牌打，凑齐就自摸，先打不要的牌，不立直
  const twin = style.twin ? himekoPlan(g, seat) : null;
  if (twin) {
    const tsumo = find('tsumo');
    if (tsumo) return tsumo;
    // 不要的牌里先打最安全的
    const visible = visibleCounts(g, seat);
    const risk = (t: TileId) => Math.max(0, ...threats(g, seat).map((o) => danger(g, seat, o, kindOf(t), visible)));
    const extra = himekoExtra(g, seat, twin).sort((a, b) => risk(a) - risk(b));
    const out = extra.map((t) => legal.find((a) => a.type === 'discard' && !a.riichi && a.tile === t)).find((a) => a);
    if (out) return out;
  }

  // 佳织的新手运：役满听牌的局只摸切，能和就和
  if (style.beginner && kaoriYakuman(g, seat)) {
    const tsumo = find('tsumo');
    if (tsumo) return tsumo;
    const out = p.drawn === null ? undefined : legal.find((a) => a.type === 'discard' && !a.riichi && a.tile === p.drawn);
    if (out) return out;
  }

  // 淡的星符汇聚：往大七星做，先打用不上的牌（数牌、字牌第三张），不立直
  if (style.cornerKan && awaiStarPlan(g, seat)) {
    const win = find('tsumo');
    if (win) return win;
    const visible = visibleCounts(g, seat);
    const risk = (t: TileId) => Math.max(0, ...threats(g, seat).map((o) => danger(g, seat, o, kindOf(t), visible)));
    const extra = awaiStarsExtra(g, seat).sort((a, b) => risk(a) - risk(b));
    const out = extra.map((t) => legal.find((a) => a.type === 'discard' && !a.riichi && a.tile === t)).find((a) => a);
    if (out) return out;
  }

  const tsumo = find('tsumo');
  if (tsumo && !(style.streak && teruWaits(g, seat, true)) && !(style.waves && nellyHolds(g, seat, true)) && !growHolds(g, seat, style, true) && !seraHolds(g, seat, style, true) && !allLastHold(g, seat, true)) return tsumo;

  // 白望的迷途之家：这一次发动了就照算出来的打（不立直，反正会自摸）
  if (style.mayoiga) {
    const t = shiromiRipple(g, seat);
    const out = t === null ? undefined : legal.find((a) => a.type === 'discard' && !a.riichi && a.tile === t);
    if (out) return out;
  }

  const kyuushu = find('kyuushu');
  if (kyuushu && kokushiShanten(toCounts(p.hand)) > 2) return kyuushu;

  const counts = toCounts(p.hand);
  const cur = shanten(counts, p.melds.length);
  for (const a of legal) {
    // 透华治水：自己也不杠
    if ((a.type === 'ankan' || a.type === 'kakan') && tokaChisui(g, seat)) continue;
    if (a.type === 'ankan') {
      // 初美：风牌能杠就杠（配牌的暗刻摸到第四张、鸣出东北以后）
      if (style.rinshan) {
        const after = counts.slice();
        after[a.kind] = 0;
        if (sakiKanOk(g, seat, after, p.melds.length + 1)) return a;
        continue;
      }
      if (p.riichi || style.kanEager || (style.winds && isWind(a.kind))) return a;
      const after = counts.slice();
      after[a.kind] = 0;
      if (shanten(after, p.melds.length + 1) <= cur && threats(g, seat).length === 0) return a;
    }
    // 咲也不在立直的人可能荣和这张时加杠（抢杠）
    const chankan = (k: Kind) => threats(g, seat).some((t) => g.seesRiichi(t, seat) && danger(g, seat, t, k, visibleCounts(g, seat)) >= 6);
    if (a.type === 'kakan' && style.rinshan) {
      const after = counts.slice();
      after[kindOf(a.tile)]--;
      if (!chankan(kindOf(a.tile)) && sakiKanOk(g, seat, after, p.melds.length)) return a;
      continue;
    }
    if (a.type === 'kakan' && ((style.kanEager && !chankan(kindOf(a.tile))) || threats(g, seat).length === 0)) {
      const after = counts.slice();
      after[kindOf(a.tile)]--;
      if (shanten(after, p.melds.length) <= cur) return a;
    }
  }

  const discards = legal.filter((a): a is Extract<Action, { type: 'discard' }> => a.type === 'discard');
  // 花田煌：手里的牌打出去全会击飞自己时只剩自摸（或杠）
  if (discards.length === 0) return tsumo ?? legal[0];
  if (p.riichi) return discards[0];

  const visible = visibleCounts(g, seat);
  type Cand = {
    a: Extract<Action, { type: 'discard' }>;
    sh: number;
    sh2: number;
    uke: number;
    val: number;
    risk: number;
    hit: number; // 洋榎：读出来别人和得了这张
    aim: number; // 堇：打这张以后听的是目标多余的牌
    fit: number; // 照：打这张以后听的牌和了正好接得上天梯
    trap: number; // 洋榎：听牌时听的是自己打过的牌的筋（引っ掛け）
    bad: number; // 久：打这张听的是烂听牌（只等一种牌，还有剩的）
    bowl: number; // 灼：打这张以后听成保龄球型（2 是希腊教堂）
    feed: number; // 浩子：这张是同桌能力者要的牌（漫爆发的六到九、灼的饼子、初美的西南风……）
  };
  // 被爽的蛇神威封印时读不了牌
  const sealed = g.isSealed(seat);
  // 读得出别人听什么：洋榎、照魔镜看过以后的照、睁开右眼的电脑美穗子（玩家操作的美穗子只看得到花色）
  const eyeReads = style.eye && mihokoEyeOpen(g, seat) && !g.manual[seat];
  // 真子只读得出没有能力的人
  // 天使和只读得出 8000 点以上的铳牌
  const angel = style.angel && nodokaAngel(g, seat);
  // 龙华的无极天：读得出别人听什么
  const mugoku = style.mugoku && ryuukaMugoku(g, seat);
  const reader = !sealed && (style.reads || style.memory || eyeReads || (style.mirror && teruMirrored(g, seat)) || angel || mugoku);
  // 照魔镜只读得出立直的人听什么
  const mirrorOnly = style.mirror && !(style.reads || style.memory || eyeReads || angel || mugoku);
  const readDanger = !reader
    ? null
    : style.memory
      ? makoDanger(g, seat)
      : angel
        ? angelDanger(g, seat)
        : mirrorOnly
          ? teruDanger(g, seat)
          : dangerKinds(g, seat);
  // 被堇瞄准时，读得出牌的人（洋榎、真子、睁眼的美穗子）和照察觉得到她听什么，不给她点
  const aimed = !sealed && (style.reads || style.memory || eyeReads || style.mirror || style.scout) ? sumireAimedAt(g, seat) : null;
  // 堇：听牌时挑听目标多余牌的打法
  const marks = style.sniper ? sumireMarks(g, seat) : null;
  // 天使和专注对局，不失误
  const mistakeRate = angel ? 0 : style.mistakeRate;
  // 美穗子睁眼：立直的人手里没有的花色是安全牌
  // 张数是 3 的倍数的花色多半没有他的听牌（门清的七对子例外），危险度压到 1
  const eyeSafe = style.eye && !sealed ? new Map(threats(g, seat).map((t) => [t, mihokoSafeKinds(g, seat, t)])) : null;
  const eyeLikely = style.eye && !sealed ? new Map(threats(g, seat).map((t) => [t, mihokoLikelySafe(g, seat, t)])) : null;
  // 浩子：知道能力者要的牌，那些牌更危险（现物照样安全）
  const scoutRisk = (t: number, k: Kind) => (style.scout && !sealed ? hirokoBias(g, seat, t, k) : 0);
  const eyeRisk = (t: number, k: Kind) =>
    eyeSafe?.get(t)?.has(k)
      ? 0
      : eyeLikely?.get(t)?.has(k)
        ? Math.min(1, danger(g, seat, t, k, visible))
        : danger(g, seat, t, k, visible) && danger(g, seat, t, k, visible) + scoutRisk(t, k);
  const myDiscards = new Set(p.discards.map((d) => kindOf(d.tile)));
  const sakiFeed = style.rinshan ? sakiAwaiFeed(g, seat) : null;
  // 照要和 1 番起胡：七对子一和就是 2 番，不往七对子做
  const shOf = style.streak && teruMirrored(g, seat) && teruLadder(g, seat).next === 1 ? standardShanten : shanten;
  const cands: Cand[] = [];
  const seen = new Set<string>();
  for (const a of discards) {
    if (a.riichi) continue;
    const key = `${kindOf(a.tile)}-${isDoraTile(g, a.tile)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = counts.slice();
    c[kindOf(a.tile)]--;
    const sh = shOf(c, p.melds.length);
    let val = tileValue(g, seat, kindOf(a.tile), counts);
    if (style.keepDora && isDoraTile(g, a.tile)) val += 20;
    // 咲：留着还没开的杠（第四张）和淡要送来的岭上牌的对子、刻子
    if (style.rinshan && !sealed) {
      const k = kindOf(a.tile);
      if (counts[k] === 4) val += 25;
      if (counts[k] >= 2 && k === sakiFeed) val += 20;
    }
    // 夕：留着宝牌和成对的役牌
    if (style.firepower && (isDoraTile(g, a.tile) || (seraYakuhai(g, seat, kindOf(a.tile)) && counts[kindOf(a.tile)] >= 2))) val += 15;
    const ts = threats(g, seat);
    const risk = ts.length ? Math.max(...ts.map((t) => eyeRisk(t, kindOf(a.tile)))) : 0;
    const sh2 = sh;
    const hit = readDanger?.has(kindOf(a.tile)) || aimed?.has(kindOf(a.tile)) ? 1 : 0;
    const aim = marks?.size && sh === 0 && waitingKinds(c, p.melds.length).some((w) => marks.has(w)) ? 1 : 0;
    const fit = style.streak && sh === 0 && teruMirrored(g, seat) && teruHandFits(g, seat, p.hand.filter((t) => t !== a.tile)) ? 1 : 0;
    let trap = 0;
    if (style.trapWait && sh === 0) {
      const out = new Set([...myDiscards, kindOf(a.tile)]);
      const suji = (w: Kind) => w < 27 && [-3, 3].some((d) => w % 9 + d >= 0 && w % 9 + d <= 8 && out.has(w + d));
      trap = waitingKinds(c, p.melds.length).some(suji) ? 1 : 0;
    }
    let bad = 0;
    if (style.badWait && !sealed && sh === 0) {
      const w = waitingKinds(c, p.melds.length);
      bad = w.length === 1 && 4 - visible[w[0]] - c[w[0]] + (kindOf(a.tile) === w[0] ? 1 : 0) > 0 && !myDiscards.has(w[0]) && kindOf(a.tile) !== w[0] ? 1 : 0;
    }
    const shape = style.bowling && !sealed && sh === 0 ? bowlingOf(c, p.melds.length) : null;
    const bowl = shape === 'church' ? 2 : shape ? 1 : 0;
    const feed = style.scout && !sealed ? Math.max(0, ...[0, 1, 2, 3].map((o) => hirokoBias(g, seat, o, kindOf(a.tile)))) : 0;
    cands.push({ a, sh, sh2, uke: sh <= cur ? ukeire(c, p.melds.length, visible) : 0, val, risk, hit, aim, fit, trap, bad, bowl, feed });
  }

  // 霞：请神后同样向听时，先打别的花色，留下绝掉的那门和字牌；涅莉的宣言局也一样，留下做的那门花色
  // 真子：留下染手的那门花色和字牌
  const suit = style.suitFocus ? kasumiSuit(g, seat) : style.waves ? nellySuit(g, seat) : style.memory && !sealed ? makoSuit(g, seat) : null;
  // 宥：同样向听时留暖色牌
  // 灼：同样向听时留筒子
  // 尧深：收获的局留着种下的牌
  const seeds = style.harvest && !sealed && takamiHarvest(g, seat) ? new Set(takamiSeeds(g, seat)) : null;
  // 爽：留住云、神威送来的牌
  const focus = style.clouds ? sawayaFocus(g, seat) : null;
  // 涅莉押 3 点做染手：别的牌先打，宁可退向听（进张都是那几种牌）
  const flush = style.waves && !sealed ? nellyFlush(g, seat) : null;
  const inFlush = (k: Kind) => (flush ? (k >= 27 ? flush.honors : Math.floor(k / 9) === flush.suit) : false);
  const keep = (c: Cand) =>
    (flush ? inFlush(kindOf(c.a.tile)) : suit !== null && (kindOf(c.a.tile) >= 27 || Math.floor(kindOf(c.a.tile) / 9) === suit)) ||
    (style.warm && warmKind(kindOf(c.a.tile))) ||
    (style.bowling && !sealed && isPin(kindOf(c.a.tile))) ||
    (style.pin1 && !sealed && kindOf(c.a.tile) === 9) ||
    (style.winds && !sealed && isWind(kindOf(c.a.tile))) ||
    seeds?.has(kindOf(c.a.tile)) ||
    focus?.keep(kindOf(c.a.tile))
      ? 1
      : 0;
  // 洋榎听牌时：两种听法都有牌可和，挑引っ掛け的
  const trapOrder = (x: Cand, y: Cand) => (x.sh === 0 && y.sh === 0 && x.uke > 0 && y.uke > 0 ? y.trap - x.trap : 0);
  // 堇听牌时：两种听法都有牌可和，挑听目标多余牌的
  const aimOrder = (x: Cand, y: Cand) => (x.sh === 0 && y.sh === 0 && x.uke > 0 && y.uke > 0 ? y.aim - x.aim || y.fit - x.fit : 0);
  // 灼听牌时：两种听法都有牌可和，挑保龄球型（希腊教堂最好），比留筒子还要紧
  const bowlOrder = (x: Cand, y: Cand) => (x.sh === 0 && y.sh === 0 && x.uke > 0 && y.uke > 0 ? y.bowl - x.bowl : 0);
  const attackOrder = (x: Cand, y: Cand) =>
    x.hit - y.hit || (flush ? keep(x) - keep(y) : 0) || x.sh - y.sh || bowlOrder(x, y) || keep(x) - keep(y) || x.feed - y.feed || trapOrder(x, y) || aimOrder(x, y) || y.bad - x.bad || x.sh2 - y.sh2 || y.uke - x.uke || x.val - y.val;
  cands.sort(attackOrder);
  // 怜：假设打掉现在最想打的那张，演算自己下一次摸到什么，按它重排。
  // 失误先掷（随机数用掉的时刻和别人一样），再演算：演算拿到的随机数和之后真的牌局一致
  let slip: boolean | null = null;
  if (style.useForesight && !sealed && foresees(g, seat)) {
    slip = cands.length > 1 && g.rng.chance(mistakeRate);
    const t = forecastNextDraw(g, seat, { discard: cands[0].a.tile });
    if (t !== null) {
      for (const x of cands) {
        const c = counts.slice();
        c[kindOf(x.a.tile)]--;
        c[kindOf(t)]++;
        x.sh2 = shanten(c, p.melds.length);
      }
      cands.sort(attackOrder);
    }
  }
  // 玄：只要还有别的牌可打，就不打宝牌
  if (style.keepDora) {
    const keep = cands.filter((x) => !isDoraTile(g, x.a.tile));
    if (keep.length) cands.splice(0, cands.length, ...keep, ...cands.filter((x) => !keep.includes(x)));
  }
  // 淡：等转角暗杠，暗刻不拆
  const kanKind = style.cornerKan ? awaiWaitingForCorner(g, seat) : null;
  if (kanKind !== null) {
    const keep = cands.filter((x) => kindOf(x.a.tile) !== kanKind);
    if (keep.length) cands.splice(0, cands.length, ...keep);
  }
  let best = cands[0];

  // 能力发动中的局（爽开了云、神威，涅莉的宣言局）：听牌了就在不退听的打法里挑牌最大的，等改良
  const growing = growBig(g, seat, style);
  if (growing && best.sh === 0) {
    const live = cands.filter((x) => x.sh === 0 && x.uke > 0 && x.hit <= best.hit);
    const value = new Map(live.map((x) => [x, ronValue(g, seat, p.hand.filter((t) => t !== x.a.tile), true)]));
    if (live.length > 1) best = live.sort((x, y) => value.get(y)! - value.get(x)! || cands.indexOf(x) - cands.indexOf(y))[0];
  }
  // 涅莉押 3 点：能听牌就挑最接近三倍满的打法
  if (style.waves && !sealed && nellyTier(g, seat) >= 3) {
    const d = nellyBigDiscard(g, seat);
    const pick = d === null ? undefined : cands.find((x) => kindOf(x.a.tile) === kindOf(d));
    if (pick) best = pick;
  }

  // 尧深：第一巡打一张孤张字牌种下（先挑种过、还没满三张的三元牌，再挑别的三元牌、别的字牌），不退向听才打
  if (style.harvest && !sealed && p.discards.length === 0 && p.melds.length === 0) {
    const planted = takamiSeeds(g, seat);
    const n = (k: Kind) => planted.filter((x) => x === k).length;
    const rank = (k: Kind) => (isDragon(k) && n(k) > 0 && n(k) < 3 ? 0 : isDragon(k) && n(k) === 0 ? 1 : 2);
    const seed = cands
      .filter((x) => x.sh === best.sh && isHonor(kindOf(x.a.tile)) && counts[kindOf(x.a.tile)] === 1 && !seeds?.has(kindOf(x.a.tile)))
      .sort((x, y) => rank(kindOf(x.a.tile)) - rank(kindOf(y.a.tile)) || n(kindOf(y.a.tile)) - n(kindOf(x.a.tile)))[0];
    if (seed) best = seed;
  }

  // 洋榎、美穗子：别人听着大牌、自己和不了时，故意放一个便宜的铳给第三家（照从来不放）
  if (reader && (style.reads || style.eye)) {
    const feed = sashikomi(g, seat, best.sh, cands.map((x) => x.a.tile));
    if (feed !== null) return cands.find((x) => x.a.tile === feed)!.a;
  }

  // 别人立直而自己离听牌还远：弃和。团体赛里少失点就是帮队伍：一向听就弃，听牌了手里这张也危险也弃
  const careful = teamCareful(g, seat) || leadCareful(g, seat);
  // 不弃和：涅莉的宣言局；诚子鸣满三次听牌了（两巡内必和）；尧深收获的局离听牌不远
  const declared =
    g.canWin(seat) &&
    ((style.waves && nellyTier(g, seat) > 0) ||
      (style.fish && !sealed && seikoFish(g, seat) >= SEIKO_SURE && best.sh === 0) ||
      (style.harvest && !sealed && takamiHarvest(g, seat) && best.sh <= 1) ||
      // 夕从不弃和
      style.firepower ||
      // 丰音的先负发动了：追上去，不弃和
      (style.rokuyou && toyoneMode(g, seat) === 'senbu' && best.sh <= 1));
  let folded: Cand[] | null = null;
  // 听牌了但听得很窄（能和的牌没几张）、要打的又是很危险的牌，对立直也不硬拼
  const riichiOn = threats(g, seat).some((t) => g.seesRiichi(t, seat));
  // 久听烂听牌是她的能力，不因为听得窄就收
  const thinTenpai = best.sh === 0 && riichiOn && best.risk >= 8 && best.uke <= 4 && !(style.badWait && !sealed && best.bad);
  if (!declared && threats(g, seat).length && (best.sh >= 1 || !g.canWin(seat) || (careful && best.risk >= 6) || thinTenpai)) {
    // 玄弃和也不打宝牌（还有别的牌可打时）
    const dora = (x: Cand) => (style.keepDora && isDoraTile(g, x.a.tile) ? 1 : 0);
    const safest = [...cands].sort((x, y) => dora(x) - dora(y) || x.hit - y.hit || x.risk - y.risk || attackOrder(x, y));
    // 这一局和不了（被七姐妹封住、照魔镜那一局）不拼
    // 优希：东风之神在的局一向听也拼，南场以防守为主
    const yuukiPush = style.eastWind && yuukiActive(g, seat) && best.sh <= 1 && g.canWin(seat);
    const yuukiFold = style.eastWind && !yuukiActive(g, seat);
    // 有人立直时一向听只打很安全的牌（现物、壁、见了三张的字牌），否则弃和
    const push = best.sh >= 1 ? best.risk < (riichiOn ? 3 : 6) : !thinTenpai;
    // 霞请神以后就不再以防守为主
    const defensive = style.defensive && !(style.suitFocus && kasumiSuit(g, seat) !== null);
    if (!yuukiPush && (best.sh >= 2 || !push || defensive || yuukiFold || !g.canWin(seat) || careful)) {
      best = safest[0];
      folded = safest;
    }
  }

  const slipped = slip ?? (cands.length > 1 && g.rng.chance(mistakeRate));
  // 读得出别人听什么时，失误也不会失误到放铳的牌上
  // 玄失误也不会失误到宝牌上
  const doraSlip = style.keepDora && isDoraTile(g, cands[1]?.a.tile ?? -1) && !isDoraTile(g, best.a.tile);
  // 弃和时失误也只会在一样安全的牌里挑错
  if (folded) {
    if (slipped && folded.length > 1 && folded[1].risk <= best.risk && folded[1].hit <= best.hit && !doraSlip) best = folded[1];
  } else if (slipped && cands[1].sh === best.sh && cands[1].hit <= best.hit && !doraSlip) best = cands[1];

  // 能立直就立直
  const riichi = discards.find((a) => a.riichi && kindOf(a.tile) === kindOf(best.a.tile));
  // 这一局和不了时立直白扔 1000 点
  if (riichi && best.sh === 0 && g.canWin(seat)) {
    const c = counts.slice();
    c[kindOf(best.a.tile)]--;
    // 桃子：还没隐身先默听，打这张就隐身了（别人看不见她立直）才立直
    if (style.stealth && !sealed && !momoStealthNext(g, seat)) return best.a;
    // 丰音：先负发动了就追立；这一局还没有六曜起作用（先负还能发动）就默听
    if (style.rokuyou && !sealed) {
      const mode = toyoneMode(g, seat);
      if (mode === 'senbu') return riichi;
      if (mode === null) return best.a;
    }
    // 胡桃：从不立直，默听才有能力
    if (style.dama && !sealed) return best.a;
    // 春：别人立直以后不立直，小牌快和
    if (style.kuromame && !sealed && haruRush(g, seat)) return best.a;
    // 夕从不默听
    if (style.firepower) return ukeire(c, p.melds.length, visible) > 0 ? riichi : best.a;
    // 堇：有役就默听，只等目标打
    if (style.sniper && sumireTarget(g, seat) !== null && damaRon(g, seat, p.hand.filter((t) => t !== best.a.tile)) > 0) return best.a;
    if (style.foresightRiichi && !sealed) {
      // 怜：先见到立直以后下一次摸的牌正好和牌才立直（一发自摸），否则默听
      const nextDraw = forecastNextDraw(g, seat, { discard: riichi.tile, riichi: true });
      if (nextDraw === null) return best.a;
      c[kindOf(nextDraw)]++;
      return shanten(c, p.melds.length) === -1 ? riichi : best.a;
    }
    if (style.keepDora && !kuroMustRiichi(g, seat, p.hand.filter((t) => t !== best.a.tile))) return best.a;
    // 涅莉押了运势的局：离该和的那一巡还早就默听，手牌留着往大里做；该和的前一巡再立直（下一巡一发自摸；押 2、3 点立直以后里宝牌往她手里变）。
    // 听的牌牌山里不到两张也先默听换听
    if (style.waves && nellyTier(g, seat) > 0 && !g.isSealed(seat) && g.wall.remaining > NELLY.late) {
      if (nellyTurn(g, seat) < nellyDue(g, seat) - 1) return best.a;
      // 押 3 点：立直下去下一巡一发自摸就是三倍满才立直
      if (nellyTier(g, seat) >= 3) return nellyBigReady(g, seat, p.hand.filter((t) => t !== best.a.tile)) ? riichi : best.a;
      if ( nellyLiveWaits(g, p.hand.filter((t) => t !== best.a.tile), p.melds.length) < 2) return best.a;
      return riichi;
    }
    // 衣：海底被错开以后能力会自己挪回来，所以照常立直
    // 优希：东场坐庄听的是只等一种牌的烂听牌（边张、坎张、单骑），牌山还多就先默听等改良
    if (style.eastWind && seat === g.dealer && yuukiActive(g, seat) && g.wall.remaining > YUUKI_AI.waitLate && waitingKinds(c, p.melds.length).length === 1) return best.a;
    // 照：天梯要正好和出下一层。默听接得上就默听；立直才接得上就立直；都接不上时，默听比下一层小才立直往上抬
    if (style.streak && !sealed) {
      const hand = p.hand.filter((t) => t !== best.a.tile);
      const dama = ronTiers(g, seat, hand, false);
      if ([...dama].some((t) => teruFits(g, seat, t))) return best.a;
      const withRiichi = ronTiers(g, seat, hand, true);
      if (![...withRiichi].some((t) => teruFits(g, seat, t)) && [...dama].some((t) => t >= teruLadder(g, seat).next)) return best.a;
    }
    // 洋榎：有役、默听也够大就默听，别人看不出她听牌了
    if (style.damaMin && damaRon(g, seat, p.hand.filter((t) => t !== best.a.tile)) >= style.damaMin) return best.a;
    // 能力发动中的局：牌还小、牌山还多，先默听等改良，牌够大了再立直
    if (growing && g.wall.remaining > BIG.late && ronValue(g, seat, p.hand.filter((t) => t !== best.a.tile), true) < bigEnough(g, seat, BIG.riichi)) return best.a;
    // 同桌的丰音还没用别的技能（先负等着）：不轻易立直。有役就默听；没役的也默听等自摸，只有听得很宽才立直
    if (!style.rokuyou && toyoneLurks(g, seat)) {
      if (damaRon(g, seat, p.hand.filter((t) => t !== best.a.tile)) > 0) return best.a;
      if (ukeire(c, p.melds.length, visible) < TOYONE_WIDE) return best.a;
    }
    if (ukeire(c, p.melds.length, visible) > 0) return riichi;
  }
  return best.a;
}

// 丰音的先负等着时，没役的听牌听到这么多张（自己看不到的）才立直
const TOYONE_WIDE = 8;

// ---------- 差し込み ----------

// 原作里洋榎放给摇杏 3900，躲开竹井久 18000 的自摸。读得出牌的人才做得到：
// 有人听着大牌（SASHI.big 以上），自己离和牌还远（或者这一局和不了），
// 就挑一张只有第三家和得了、他和得不贵（SASHI.cheap 以内）的牌打出去，把这一局结束掉。
// 放之前比一比：放铳以后的局面和大牌自摸以后的局面，哪个对自己（团体赛就是自己队）的名次、和第一的差距更好
export const SASHI = {
  big: 12000, // 多大算大牌
  cheap: 3900, // 最多放多少
  live: 2, // 大牌的和了牌还剩几张（自己看不到的）才值得躲
};

// 局面好坏：名次靠前、离第一近
function standing(scores: number[], seat: number): number {
  const me = scores[seat];
  const rank = scores.filter((v, s) => s !== seat && v > me).length;
  const top = Math.max(...scores.filter((_, s) => s !== seat));
  return -8000 * rank + Math.min(0, me - top) + (me < 0 ? -30000 : 0);
}

// 返回要打的那张（tiles 里的），不放就是 null
function sashikomi(g: Game, seat: number, sh: number, tiles: TileId[]): TileId | null {
  if (sh <= 0 && g.canWin(seat)) return null;
  const reads = readOthers(g, seat);
  const visible = visibleCounts(g, seat);
  const threat = reads
    .filter((r) => r.value >= SASHI.big && waitsLeft(g, r.seat, visible) >= SASHI.live)
    .sort((a, b) => b.value - a.value)[0];
  if (!threat) return null;
  const scores = g.players.map((p) => p.score);
  // 大牌自摸以后
  const dealer = g.dealer;
  const after = scores.slice();
  for (let s = 0; s < 4; s++) {
    if (s === threat.seat) continue;
    const share = threat.seat === dealer ? threat.value / 3 : s === dealer ? threat.value / 2 : threat.value / 4;
    after[s] -= share;
    after[threat.seat] += share;
  }
  const keep = standing(after, seat);
  const honba = g.honba * 300;
  let pick: { tile: TileId; score: number } | null = null;
  for (const r of reads) {
    // 瞄着自己的堇也不喂
    if (r.seat === threat.seat || sumireTarget(g, r.seat) === seat) continue;
    r.ron.forEach((k, i) => {
      const pay = r.pay[i] + honba;
      if (r.pay[i] > SASHI.cheap) return;
      // 别人（包括大牌）也和得了这张就不行：一炮多响
      if (reads.some((o) => o.seat !== r.seat && o.ron.includes(k))) return;
      const tile = tiles.find((t) => kindOf(t) === k);
      if (tile === undefined) return;
      const fed = scores.slice();
      fed[seat] -= pay;
      fed[r.seat] += pay + g.riichiSticks * 1000;
      const score = standing(fed, seat);
      if (score > keep && (!pick || score > pick.score)) pick = { tile, score };
    });
  }
  return pick === null ? null : (pick as { tile: TileId }).tile;
}

// 他的和了牌还剩几张（seat 看不到的）
function waitsLeft(g: Game, target: number, visible: number[]): number {
  const p = g.players[target];
  const hand = (p.hand.length + 3 * p.melds.length) % 3 === 2 && p.drawn !== null ? p.hand.filter((t) => t !== p.drawn) : p.hand;
  const own = toCounts(hand);
  return waitingKinds(own, p.melds.length).reduce((n, k) => n + Math.max(0, 4 - visible[k] - own[k]), 0);
}

// 玄：立直以后只能摸切，宝牌聚集送来的宝牌全得打掉，能力当场失效。所以听牌了默听为主，非进攻不可时才立直：
// 能力已经没了（打出过宝牌）；默听荣和不到 3900 点（没役只能自摸，或者太便宜，靠立直加番）；最后一局不是第一、默听和了也追不上。
// hand 是打掉这张以后的 13 张
const KURO_DAMA_MIN = 3900;
// 手里宝牌到这么多张就不再等改良，有什么和什么（再来宝牌就拿不住了）
const KURO_RUSH = 6;
function kuroMustRiichi(g: Game, seat: number, hand: TileId[]): boolean {
  if (kuroLost(g, seat)) return true;
  const p = g.players[seat];
  const best = damaRon(g, seat, hand);
  if (best < KURO_DAMA_MIN) return true;
  if (g.isLastRounds(1)) {
    const top = Math.max(...g.players.filter((q) => q.seat !== seat).map((q) => q.score));
    const gain = best + g.honba * 300 + g.riichiSticks * 1000;
    if (p.score <= top && p.score + gain <= top) return true;
  }
  return false;
}

// 默听荣和最多能拿多少点（振听、没役是 0）。hand 是打掉一张以后的 13 张
function damaRon(g: Game, seat: number, hand: TileId[]): number {
  return ronValue(g, seat, hand, false);
}

// 荣和最多能拿多少点（riichi：算上立直一番；振听、没役是 0）。hand 是打掉一张以后的 13 张
function ronValue(g: Game, seat: number, hand: TileId[], riichi: boolean): number {
  const p = g.players[seat];
  const waits = waitingKinds(toCounts(hand), p.melds.length);
  const discarded = new Set([...p.discards.map((d) => kindOf(d.tile)), ...g.players[seat].hand.filter((t) => !hand.includes(t)).map(kindOf)]);
  const furiten = waits.some((k) => discarded.has(k));
  const dora = g.wall.visibleDoraIndicators().map(kindOf);
  let best = 0;
  if (!furiten) {
    for (const k of waits) {
      const tile = k * 4 + 3;
      const r = g.minHanOk(evaluateWin({
        closed: [...hand, tile],
        melds: p.melds,
        kuitan: g.rules.kuitan,
        winTile: tile,
        tsumo: false,
        seatWind: g.seatWind(seat),
        roundWind: EAST + g.roundWind,
        isDealer: seat === g.dealer,
        riichi: riichi && p.melds.every((m) => m.type === 'ankan'),
        doubleRiichi: false,
        ippatsu: false,
        doraIndicators: dora,
      }));
      if (r) best = Math.max(best, r.ron);
    }
  }
  return best;
}

// 能力发动中的局把牌做大：牌山剩 late 张以上时，立直要牌值到 riichi（算上立直）、和牌要到 win，不到就先等。
// 庄家按 1.5 倍算
const BIG = { riichi: 3900, win: 2600, late: 24 };
const bigEnough = (g: Game, seat: number, v: number) => (seat === g.dealer ? v * 1.5 : v);

// 能力是不是正在发动、该往大里做：爽开了云或攻击的神威；涅莉的宣言局；霞请神以后；尧深收获的局；
// 玄的宝牌还在。讲速度的（优希、憧、诚子、久）不等
function growBig(g: Game, seat: number, style: AiStyle): boolean {
  if (g.isSealed(seat)) return false;
  if (style.clouds && sawayaActive(g, seat)) return true;
  if (style.waves && nellyTier(g, seat) > 0) return true;
  if (style.suitFocus && kasumiSuit(g, seat) !== null) return true;
  if (style.harvest && takamiHarvest(g, seat)) return true;
  // 玄：不着急，一手就够大；但有人开过杠（宝牌变多、手里拿不住）或者手里宝牌已经很多，就有什么和什么
  if (style.keepDora && !kuroLost(g, seat)) {
    const p = g.players[seat];
    const dora = [...p.hand, ...p.melds.flatMap((m) => m.tiles)].filter((t) => isDoraTile(g, t)).length;
    return g.wall.visibleDoraIndicators().length === 1 && dora < KURO_RUSH;
  }
  return false;
}

// 能力发动中的局，牌山还多、这手和了太小，就先不和
function growHolds(g: Game, seat: number, style: AiStyle, tsumo: boolean): boolean {
  if (!growBig(g, seat, style) || g.wall.remaining <= BIG.late) return false;
  const p = g.players[seat];
  const tile = tsumo ? p.drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
  const r = g.winResult(seat, tile, tsumo);
  return !!r && teruWinValue(r, tsumo, seat === g.dealer) < bigEnough(g, seat, BIG.win);
}

// 夕：不到满贯（庄家 1.5 倍）先不和，牌山快摸完了才有什么和什么
function seraHolds(g: Game, seat: number, style: AiStyle, tsumo: boolean): boolean {
  if (!style.firepower || g.wall.remaining <= SERA.holdLate) return false;
  const p = g.players[seat];
  const tile = tsumo ? p.drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
  const r = g.winResult(seat, tile, tsumo);
  return !!r && teruWinValue(r, tsumo, seat === g.dealer) < bigEnough(g, seat, SERA.mangan);
}

// 堇：只和瞄准的那家打的牌（牌山快摸完了才谁打的都和）
function sumireSkips(g: Game, seat: number, style: AiStyle): boolean {
  if (!style.sniper || g.wall.remaining <= SUMIRE.anyRon) return false;
  const target = sumireTarget(g, seat);
  if (target === null) return false;
  const from = g.callKind === 'chankan' ? g.kakanInfo!.seat : g.lastDiscard!.seat;
  return from !== target;
}

// 先见这一局开着没有（龙华只在借膝枕的局看得见）
const foresees = (g: Game, seat: number) => g.abilities[seat]?.foresightOn?.(g, seat) ?? true;

// 照：这一手和了接不上连和（比上一次小），牌山还多，就先不和、等更大的
// 涅莉押了运势的局：装装样子，该和的那一巡（押 3 点第 8 巡、2 点第 12 巡、1 点第 15 巡）之前不和（荣和可以早一巡）；
// 到了那一巡牌还不够大（不到押的那一档），再等几巡接着做大。牌山快摸完了、有人逼近了就有什么和什么
function nellyHolds(g: Game, seat: number, tsumo: boolean): boolean {
  if (nellyTier(g, seat) <= 0 || g.isSealed(seat) || g.wall.remaining <= NELLY.late) return false;
  const p = g.players[seat];
  const turn = p.discards.length + 1;
  const due = nellyDue(g, seat);
  if (turn < due - 1) return true;
  const tile = tsumo ? p.drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
  const r = g.winResult(seat, tile, tsumo);
  // 押 3 点：不到三倍满不和
  if (nellyTier(g, seat) >= 3) return !(p.riichi && turn >= due + NELLY.grace) && !!r && teruWinValue(r, tsumo, seat === g.dealer) < nellyTarget(g, seat);
  // 立直了摸到和了牌不和就只能打掉（振听），到了那一巡就和
  if (p.riichi || turn >= due + NELLY.grace || threats(g, seat).length) return false;
  return !!r && teruWinValue(r, tsumo, seat === g.dealer) < nellyTarget(g, seat);
}

// 照：这一手比天梯的下一层小，牌山还多，就先不和、等它长到下一层（正好是下一层、役满、比下一层大都和）
function teruWaits(g: Game, seat: number, tsumo: boolean): boolean {
  if (g.wall.remaining <= TERU.aiForceWin || g.isSealed(seat)) return false;
  const p = g.players[seat];
  const tile = tsumo ? p.drawn! : g.callKind === 'chankan' ? g.kakanInfo!.tile : g.lastDiscard!.tile;
  const r = g.winResult(seat, tile, tsumo);
  return !!r && teruTier(r) < teruLadder(g, seat).next;
}

// 13 张的手荣和各听牌是天梯的第几层（振听、没役的不算；riichi：算上立直一番）
function ronTiers(g: Game, seat: number, hand: TileId[], riichi: boolean): Set<number> {
  const p = g.players[seat];
  const waits = waitingKinds(toCounts(hand), p.melds.length);
  const out = new Set<number>();
  if (waits.some((k) => p.discards.some((d) => kindOf(d.tile) === k))) return out;
  const dora = g.wall.visibleDoraIndicators().map(kindOf);
  for (const k of waits) {
    const tile = k * 4 + 3;
    const r = evaluateWin({
      closed: [...hand, tile],
      melds: p.melds,
      kuitan: g.rules.kuitan,
      winTile: tile,
      tsumo: false,
      seatWind: g.seatWind(seat),
      roundWind: EAST + g.roundWind,
      isDealer: seat === g.dealer,
      riichi: riichi && p.melds.every((m) => m.type === 'ankan'),
      doubleRiichi: false,
      ippatsu: false,
      doraIndicators: dora,
    });
    if (r) out.add(teruTier(r));
  }
  return out;
}

// 13 张的手（默听或者立直）和了接不接得上天梯
function teruHandFits(g: Game, seat: number, hand: TileId[]): boolean {
  return [...ronTiers(g, seat, hand, false), ...ronTiers(g, seat, hand, true)].some((t) => teruFits(g, seat, t));
}

// ---------- 别人打牌后 ----------

function hasYakuhaiMeld(g: Game, seat: number): boolean {
  return g.players[seat].melds.some((m) => {
    const k = kindOf(m.tiles[0]);
    return m.type !== 'chi' && (isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind);
  });
}

function chooseCall(g: Game, seat: number, legal: Action[], style: AiStyle): Action {
  const pass = legal.find((a) => a.type === 'pass')!;
  // 姬子钥匙的那一局：门清自摸才是那副牌的番数，不鸣牌也不荣和
  if (style.twin && himekoPlan(g, seat)) return pass;
  // 佳织的新手运：役满听牌的局不鸣牌，能荣和就和
  if (style.beginner && kaoriYakuman(g, seat)) return legal.find((a) => a.type === 'ron') ?? pass;
  // 爱丽丝画着手绘板：不鸣牌（一鸣就碎），能荣和照样和
  if (aislinnPlan(g, seat)) return legal.find((a) => a.type === 'ron') ?? pass;
  // 淡的星符汇聚：门清做大七星，不鸣牌
  if (style.cornerKan && awaiStarPlan(g, seat)) return legal.find((a) => a.type === 'ron') ?? pass;
  const ron = legal.find((a) => a.type === 'ron');
  // 淡：等转角暗杠自摸，不荣和
  if (ron && !(style.cornerKan && awaiWaitingForCorner(g, seat) !== null) && !(style.streak && teruWaits(g, seat, false)) && !(style.waves && nellyHolds(g, seat, false)) && !growHolds(g, seat, style, false) && !seraHolds(g, seat, style, false) && !sumireSkips(g, seat, style) && !allLastHold(g, seat, false)) return ron;
  // 涅莉押了运势的局不鸣牌，门清做大
  if (style.waves && nellyTier(g, seat) > 0) return pass;
  // 透华治水：牌局平静如水，自己也不鸣
  if (tokaChisui(g, seat)) return pass;

  const p = g.players[seat];
  const tile = g.lastDiscard!.tile;
  const k = kindOf(tile);
  const counts = toCounts(p.hand);
  const cur = shanten(counts, p.melds.length);

  // 衣听牌、海底归她：鸣一手不退向听的牌，把海底错开
  const koromo = !p.riichi && !style.haitei ? koromoHaiteiSeat(g, seat, !!style.scout && !g.isSealed(seat)) : null;
  if (koromo !== null) {
    for (const a of legal) {
      if ((a.type !== 'pon' && a.type !== 'chi') || (seat + g.wall.live.length) % 4 === koromo) continue;
      const c = counts.slice();
      for (const t of a.tiles) c[kindOf(t)]--;
      if (shanten(c, p.melds.length + 1) <= cur) return a;
    }
  }

  const kan = legal.find((a) => a.type === 'daiminkan');
  if (kan && style.rinshan) {
    const after = counts.slice();
    after[k] = 0;
    if (sakiKanOk(g, seat, after, p.melds.length + 1)) return kan;
  } else if (kan && style.kanEager) return kan;
  // 初美：风牌能碰就碰、能杠就杠
  const windy = style.winds && !g.isSealed(seat);
  if (windy && isWind(k)) return kan ?? legal.find((a) => a.type === 'pon') ?? pass;

  // 怜：先见到自己下一张有用的话，就不鸣牌打乱顺序
  if (style.useForesight && !g.isSealed(seat) && foresees(g, seat)) {
    const mine = forecastNextDraw(g, seat);
    if (mine !== null) {
      const c = counts.slice();
      c[kindOf(mine)]++;
      if (shanten(c, p.melds.length) < cur) return pass;
    }
  }

  const yakuhai = isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind;
  const tanyaoOk =
    isSimple(k) &&
    p.melds.every((m) => m.tiles.every((t) => isSimple(kindOf(t)))) &&
    p.hand.filter((t) => isYaochu(kindOf(t))).length <= 1;
  // 初美东北都鸣出来以后奔小四喜（役满），什么都能鸣
  const kimon = !!style.winds && !g.isSealed(seat) && hatsumiOpen(g, seat);
  const yakuSecured = hasYakuhaiMeld(g, seat) || kimon;
  // 真子：手里别的花色只剩两张以内，染手那门和字牌能鸣（混一色）；爽开了红云、白云、黑云、海神威，霞请神后，宥也一样
  // 霞请神后做绝掉的那门，宥做万子
  const sealedMe = g.isSealed(seat);
  const dye =
    style.memory && !sealedMe
      ? makoSuit(g, seat)
      : style.clouds
        ? sawayaFocus(g, seat)?.suit ?? null
        : style.suitFocus
          ? kasumiSuit(g, seat)
          : style.warm && !sealedMe
            ? 0
            : null;
  const inDye = (t: TileId) => dye !== null && (kindOf(t) >= 27 || Math.floor(kindOf(t) / 9) === dye);
  const honitsuOk =
    dye !== null && inDye(tile) && p.melds.every((m) => m.tiles.every(inDye)) && p.hand.filter((t) => !inDye(t)).length <= 2;

  // 衣：听牌了、海底不是自己的，找一手吃碰把海底挪到自己（海底捞月本身就是役）；
  // 海底已经是自己的，就不吃不碰，免得把它挪走
  // 还差一步听牌时，能一手吃碰同时听牌、拿到海底的也鸣
  if (style.haitei && !p.riichi && cur <= 1) {
    const last = g.wall.live.length - 1;
    if (cur === 0 && (g.lastDiscard!.seat + 1 + last) % 4 === seat) return pass;
    if (last >= 4 && (seat + 1 + last) % 4 === seat) {
      for (const a of legal) {
        if (a.type !== 'pon' && a.type !== 'chi') continue;
        const c = counts.slice();
        for (const t of a.tiles) c[kindOf(t)]--;
        if (shanten(c, p.melds.length + 1) === 0) return a;
      }
    }
  }

  // 恭子：桌上有能力起作用的人，就鸣牌打乱流向（不退向听就鸣；有能力的人立直了，没役也鸣）
  // 浩子：看得见手绘板、一发巡的先见、立直的能力者，不退向听就鸣打断（手绘板和一发巡没役也鸣）
  const scout = style.scout && !g.isSealed(seat) ? hirokoDisrupt(g, seat) : null;
  const disrupt = (style.disrupt && !g.isSealed(seat) && g.wall.remaining >= KYOUKO.aiMinWall && kyoukoTargets(g, seat).length > 0) || !!scout?.any;
  const disruptAny = (style.disrupt && disrupt && kyoukoTargets(g, seat).some((s) => g.seesRiichi(s, seat))) || !!scout?.urgent;
  // 纯：别人立直了、牌山还多时，有役不退向听就鸣，错开流向（别人一巡不进张，立直的人摸不到和了牌）
  const jam = !!style.jam && !sealedMe && g.wall.remaining >= JUN.aiMinWall && [0, 1, 2, 3].some((s) => s !== seat && g.seesRiichi(s, seat));

  // 优希不坐庄的东场以和牌为先；照要和 1 番、2 番的时候小牌快和：向听多也吃
  const speedy =
    style.speed ||
    kimon ||
    (style.kuromame && !g.isSealed(seat) && haruRush(g, seat)) ||
    (style.eastWind && seat !== g.dealer && yuukiActive(g, seat)) ||
    (style.streak && teruMirrored(g, seat) && teruLadder(g, seat).next <= 2);

  // 诚子：对子多、还没吃过，就奔对对和，能碰就碰（碰了不退向听也碰，多钓一条鱼）
  const pairs = counts.filter((n) => n >= 2).length;
  const toitoi = style.fish && p.melds.every((m) => m.type !== 'chi') && pairs + p.melds.length >= 4;
  // 丰音：副露两次以上、有役，这一局还没有六曜起作用时奔友引（四副露单骑），不退向听就鸣
  const tomobiki = style.rokuyou && !sealedMe && yakuSecured && p.melds.length >= 2 && toyoneMode(g, seat) === null;
  let best: Action = pass;
  let bestSh = cur;
  for (const a of legal) {
    if (a.type !== 'pon' && a.type !== 'chi') continue;
    if (a.type === 'pon' && !(yakuhai || tanyaoOk || yakuSecured || toitoi || disruptAny || honitsuOk)) continue;
    if (a.type === 'chi' && !(tanyaoOk || yakuSecured || disruptAny || honitsuOk)) continue;
    if (a.type === 'chi' && toitoi) continue;
    // 夕：门清做大，不吃，只碰役牌
    if (style.firepower && (a.type === 'chi' || !yakuhai)) continue;
    // 憧：速攻，向听多也吃
    if (a.type === 'chi' && !yakuSecured && cur > 2 && !speedy && !disrupt && !jam) continue;
    const c = counts.slice();
    for (const t of a.tiles) c[kindOf(t)]--;
    const sh = shanten(c, p.melds.length + 1);
    if (sh < bestSh || ((style.fish && a.type === 'pon') || disrupt || jam || tomobiki) && sh <= cur && best === pass) {
      best = a;
      bestSh = sh;
    }
  }
  return best;
}

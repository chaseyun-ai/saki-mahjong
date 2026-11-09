import type { Game, WinInfo } from '../engine/game';
import { evaluateWin, type WinResult } from '../engine/score';
import { shanten, standardShanten, waitingKinds } from '../engine/shanten';
import { EAST, Kind, TileId, isRed, kindOf, toCounts } from '../engine/tiles';
import { readOthers } from './hiroe';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 宫永照（白糸台）：
// - 照魔镜：第一局只看不和（这一局她和不了牌），看过以后整场都看得穿别人：
//   玩家操作她时，别人的头像旁边多一面镜子，点开能看到这家能力现在的状态（Ability.insight）；
//   读得出立直的人听什么（teruDanger）：电脑的照不打给他们，玩家操作她时手里的这种铳牌标红
// - 别人的能力动不了她（Ability.immune）：不被封印，别人对她的配牌、摸牌定的规矩不算；只有玄的宝牌她也得守
// - 天梯（连续和了）：八层，1 番、2 番、3 番、4 番、满贯、跳满、倍满、三倍满，塔尖是役满。只算役的番数，宝牌、赤宝牌、里宝牌加的番不算。
//   起胡必须是 1 番，之后每次和了必须正好是下一层，大了小了都断；别人和了、流局也断，从塔底重来。
//   役满不管在哪一层都直接登顶；登顶以后下一次从 1 番重新爬。
//   站得越高，配牌和摸牌帮得越多（TERU.boost、dealMax；4 番以上配牌偏混一色，跳满以上偏清一色）。
//   压制：别人要摸的进张有 TERU.press 的概率被换走，刚起步压得最狠，越往上越轻。
//   摸牌的帮助只送朝下一层走的牌：快听牌时只给正好够得上下一层的和了牌；听牌时自摸会和错层，就挡掉那张，等荣和接上
// - 叽叽叽：一场里自摸满 TERU.kiki 次，下一局配牌直接是九莲宝灯的听牌，第九次自摸必定是纯正九莲宝灯
export const TERU = {
  // 站在第几层（0 是还没起胡、9 是登顶）时，摸牌换成进张的概率
  boost: [0.55, 0.7, 0.75, 0.8, 0.85, 0.85, 0.85, 0.85, 0.9, 0.55],
  // 站在第几层时，配牌最多几向听（多了就换几张）
  dealMax: [3, 2, 2, 2, 2, 2, 2, 2, 2, 3],
  dealSwaps: 2, // 配牌最多换几张来降向听
  tiltSwaps: 4, // 配牌往混一色、清一色偏最多换几张
  aiForceWin: 12, // 电脑的照：牌山剩这么多张以内，不是下一层也和（免得白白流局）
  kiki: 8, // 自摸几次以后下一局九莲宝灯
  // 压制：站在第几层时，别人要摸的进张被换走的概率。刚起步压得最狠，越往上越轻（大牌要跟别人抢时间）
  press: [0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.5],
};

// 八层加塔尖的名字（第 1 层是 TERU_TIERS[0]）
export const TERU_TIERS = ['1番', '2番', '3番', '4番', '满贯', '跳满', '倍满', '三倍满', '役满'];
export const TERU_TOP = 9;

interface TeruGameState {
  rounds?: number; // 开过几局
  seen?: number; // g.events 里看到哪了（上一局的结算从这里往后找）
  dealer?: boolean; // 这一局她是不是庄家
  level?: number; // 站在第几层（0 是塔底）
  broke?: string; // 上一次天梯断掉的原因（给界面看）
  kiki?: number; // 这一场自摸了几次（九莲宝灯以后清零）
}
interface TeruState {
  boosted?: boolean; // 这一局已经提示过“连续和了”
  chuuren?: number; // 这一局叽叽叽：九莲宝灯做在哪一门（0 万、1 筒、2 索）
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as TeruGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as TeruState;

// 她这次和了拿到多少（不算本场、立直棒）
export function teruWinValue(r: WinResult, tsumo: boolean, dealer: boolean): number {
  if (!tsumo) return r.ron;
  return dealer ? r.tsumoOtherPays * 3 : r.tsumoDealerPays + r.tsumoOtherPays * 2;
}

// 这手和了在第几层，只按役的番数算（宝牌、赤宝牌、里宝牌加的番不算）：
// 1–4 番是第 1–4 层，5 番满贯、6–7 番跳满、8–10 番倍满、11–12 番三倍满，役满（13 番以上也算）是塔尖
export function teruTier(r: WinResult): number {
  if (r.yakuman > 0) return TERU_TOP;
  const han = r.han - r.dora - r.aka - r.ura;
  return han >= 13 ? TERU_TOP : han >= 11 ? 8 : han >= 8 ? 7 : han >= 6 ? 6 : han >= 5 ? 5 : Math.max(1, han);
}

// 照魔镜看过了没有（第一局结束以后）
export function teruMirrored(g: Game, seat: number): boolean {
  return (gameStateOf(g, seat).rounds ?? 0) > 1;
}

// 照魔镜读得出的铳牌：看得见立直的人听的牌（小莳的天照照不进去）；第一局只看不和，不算
export function teruDanger(g: Game, seat: number): Set<Kind> {
  if (!teruMirrored(g, seat)) return new Set();
  return new Set(readOthers(g, seat).filter((r) => g.seesRiichi(r.seat, seat) && !g.active(r.seat)?.mirrorProof?.(g, r.seat)).flatMap((r) => r.ron));
}

// 天梯：站在第几层、下一次要和第几层、上一次断掉的原因、叽叽叽的次数
export function teruLadder(g: Game, seat: number): { level: number; next: number; broke: string | null; kiki: number } {
  const gs = gameStateOf(g, seat);
  const level = gs.level ?? 0;
  return { level, next: level >= TERU_TOP ? 1 : level + 1, broke: gs.broke ?? null, kiki: gs.kiki ?? 0 };
}

// 这一手（tier 层）接不接得上天梯：正好是下一层，或者役满
export function teruFits(g: Game, seat: number, tier: number): boolean {
  return tier === TERU_TOP || tier === teruLadder(g, seat).next;
}

// 上一局的结算算进天梯和叽叽叽
function settle(g: Game, seat: number): void {
  const gs = gameStateOf(g, seat);
  const from = gs.seen ?? 0;
  gs.seen = g.events.length;
  let end: Extract<(typeof g.events)[number], { type: 'roundEnd' }> | undefined;
  for (let i = g.events.length - 1; i >= from; i--) {
    const e = g.events[i];
    if (e.type === 'roundEnd') {
      end = e;
      break;
    }
  }
  if (!end) return;
  const r = end.result;
  if (r.kind === 'abortive') return;
  const level = gs.level ?? 0;
  const mine: WinInfo | undefined = r.wins.find((w) => w.seat === seat);
  if (!mine) {
    if (level > 0 && level < TERU_TOP) gs.broke = r.kind === 'win' ? '别人和了' : '流局';
    gs.level = 0;
    return;
  }
  if (mine.from === null) gs.kiki = (gs.kiki ?? 0) + 1;
  const tier = teruTier(mine.result);
  // 九莲宝灯（叽叽叽）以后从头数
  if (mine.result.yaku.some((y) => y.name.includes('九莲宝灯'))) gs.kiki = 0;
  const next = level >= TERU_TOP ? 1 : level + 1;
  if (tier === TERU_TOP || tier === next) {
    gs.level = tier === TERU_TOP ? TERU_TOP : next;
    gs.broke = undefined;
  } else {
    if (level > 0 && level < TERU_TOP) gs.broke = `和了${TERU_TIERS[tier - 1]}，不是${TERU_TIERS[next - 1]}`;
    else if (level === 0) gs.broke = `起胡要 1 番，和了${TERU_TIERS[tier - 1]}不算`;
    gs.level = 0;
  }
}

const SUIT = (k: number) => (k < 27 ? Math.floor(k / 9) : 3);

// 叽叽叽：把她的配牌换成某一门的 1112345678999（九面听）。挑一门换得出来的（不碰宝牌，玄的规矩也不违反）
function dealChuuren(g: Game, seat: number): number | null {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  const ok = (t: TileId) => !isDoraTile(g, t) && !w.locked.has(t);
  for (const suit of g.rng.shuffle([0, 1, 2])) {
    const need = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8].map((n) => suit * 9 + n);
    // 先看换不换得出来：每种牌在她配牌里和配牌以外的牌山里（没锁住、不是宝牌）够不够
    const pool = [...mine.map((i) => w.live[i]), ...w.live.slice(52)].filter(ok);
    if (need.some((k) => pool.filter((t) => kindOf(t) === k).length < need.filter((x) => x === k).length)) continue;
    // 她配牌里已经有的、要用的牌先留着，剩下的位置一张张换
    const left = need.slice();
    const free: number[] = [];
    for (const i of mine) {
      const j = left.indexOf(kindOf(w.live[i]));
      if (j >= 0 && ok(w.live[i])) left.splice(j, 1);
      else free.push(i);
    }
    let done = true;
    for (const i of free) {
      const k = left.shift()!;
      if (!w.bringToLive(i, (t) => kindOf(t) === k && ok(t), g.rng, (j) => j >= 52)) {
        done = false;
        break;
      }
    }
    if (done) return suit;
  }
  return null;
}

// 配牌往一门花色偏：inSet 里的牌（这一门，混一色再加字牌）不到 want 张，就把别的牌换成 inSet 里的，向听不变差
// 配牌的向听都只看一般形（见 beforeDeal）
function tiltDeal(g: Game, seat: number, honors: boolean, want: number): void {
  const w = g.wall;
  const mine = g.dealIndices(seat);
  const per = [0, 0, 0];
  for (const i of mine) if (kindOf(w.live[i]) < 27) per[SUIT(kindOf(w.live[i]))]++;
  const suit = per.indexOf(Math.max(...per));
  const inSet = (t: TileId) => SUIT(kindOf(t)) === suit || (honors && kindOf(t) >= 27);
  for (let n = 0; n < TERU.tiltSwaps; n++) {
    const tiles = mine.map((i) => w.live[i]);
    if (tiles.filter(inSet).length >= want) return;
    const counts = toCounts(tiles);
    const cur = standardShanten(counts, 0);
    let done = false;
    for (const i of g.rng.shuffle(mine.filter((i) => !inSet(w.live[i])))) {
      const k = kindOf(w.live[i]);
      counts[k]--;
      const fine = (t: TileId) => {
        if (!inSet(t)) return false;
        counts[kindOf(t)]++;
        const sh = standardShanten(counts, 0);
        counts[kindOf(t)]--;
        return sh <= cur;
      };
      done = w.bringToLive(i, fine, g.rng, (j) => j >= 52);
      counts[k]++;
      if (done) break;
    }
    if (!done) return;
  }
}

// 4 番以上配牌偏混一色，跳满以上偏清一色：要几张、带不带字牌（按要和的下一层算）
function tiltOf(level: number): { honors: boolean; want: number } | null {
  if (level >= 5 && level < TERU_TOP) return { honors: false, want: level >= 6 ? 11 : 10 };
  if (level >= 3 && level < TERU_TOP) return { honors: true, want: level >= 4 ? 10 : 9 };
  return null;
}

export const teruAbility: Ability = {
  id: 'teru',
  name: '照魔镜·连续和了',
  immune: true,
  // 平行宇宙：天梯回到塔底，叽叽叽从头数
  resetMarks(g, seat) {
    const gs = gameStateOf(g, seat);
    gs.level = 0;
    gs.kiki = 0;
    gs.broke = '平行宇宙';
  },
  description:
    '别人的能力动不了她（只有玄的宝牌她也得守）。第一局用照魔镜只看不和，之后看得穿每家的能力（玩家能点开别人头像旁的镜子看），也读得出立直的人听什么（手里打出去会放铳的牌标红）。天梯（只算役的番数，宝牌、赤宝牌、里宝牌不算）：起胡 1 番，之后每次必须正好和出下一层（2 番、3 番、4 番、满贯、跳满、倍满、三倍满），大了小了、别人和了、流局都从头来；役满直接登顶。站得越高，配牌和摸牌帮得越多。压制：别人的进张常被换走，刚起步压得最狠，越往上越轻。叽叽叽：一场自摸满八次，第九次必定九莲宝灯。',

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    settle(g, seat);
    gs.rounds = (gs.rounds ?? 0) + 1;
    gs.dealer = seat === g.dealer;
  },

  // 照魔镜看过以后：叽叽叽满了就做九莲宝灯；不然配牌超过这一层的向听上限就换几张，高层再往一门花色偏
  // 只看一般形的向听：七对子的向听也算的话，凑对子的牌也算“降向听”，配牌会偏成七对子
  beforeDeal(g, seat) {
    if (!teruMirrored(g, seat)) return;
    const gs = gameStateOf(g, seat);
    if ((gs.kiki ?? 0) >= TERU.kiki) {
      const suit = dealChuuren(g, seat);
      if (suit !== null) {
        stateOf(g, seat).chuuren = suit;
        return;
      }
    }
    const level = gs.level ?? 0;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    for (let n = 0; n < TERU.dealSwaps; n++) {
      const counts = toCounts(mine.map((i) => w.live[i]));
      const cur = standardShanten(counts, 0);
      if (cur <= TERU.dealMax[level]) break;
      let done = false;
      for (const i of g.rng.shuffle([...mine])) {
        const k = kindOf(w.live[i]);
        counts[k]--;
        const better = (t: number) => {
          counts[kindOf(t)]++;
          const sh = standardShanten(counts, 0);
          counts[kindOf(t)]--;
          return sh < cur;
        };
        done = w.bringToLive(i, better, g.rng, (j) => j >= 52);
        counts[k]++;
        if (done) break;
      }
      if (!done) break;
    }
    const tilt = tiltOf(level);
    if (tilt) tiltDeal(g, seat, tilt.honors, tilt.want);
  },

  onRoundStart(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.rounds === 1) g.emit({ type: 'ability', seat, ability: 'teru', text: '照魔镜' });
    if (stateOf(g, seat).chuuren !== undefined) g.emit({ type: 'ability', seat, ability: 'teru', text: '叽叽叽' });
  },

  // 叽叽叽的九莲宝灯听牌：坐庄时第一张不给天和
  noTenhou(g, seat) {
    return stateOf(g, seat).chuuren !== undefined;
  },

  canWin(g, seat) {
    return teruMirrored(g, seat);
  },

  // 压制：照魔镜看过以后，别人要摸的进张有时被换走（悄悄换，结算时能力痕迹里讲）
  beforeAnyDraw(g, seat, drawer, rinshan) {
    if (drawer === seat || rinshan || !teruMirrored(g, seat)) return;
    if (!g.rng.chance(TERU.press[teruLadder(g, seat).level])) return;
    const p = g.players[drawer];
    const base = toCounts(p.hand);
    const melds = p.melds.length;
    const sh = shanten(base, melds);
    return {
      seat,
      ability: 'teru',
      text: '压制',
      deny: (t: TileId) => {
        base[kindOf(t)]++;
        const after = shanten(base, melds);
        base[kindOf(t)]--;
        return after < sh;
      },
    };
  },

  // 摸牌换成进张：概率按站在第几层；快听牌时只给正好够得上下一层的和了牌
  beforeDraw(g, seat, rinshan) {
    if (rinshan || !teruMirrored(g, seat)) return;
    const st = stateOf(g, seat);
    const p = g.players[seat];
    const counts = toCounts(p.hand);
    // 叽叽叽：九莲宝灯听牌，这一门哪张都和
    if (st.chuuren !== undefined) {
      const suit = st.chuuren;
      if (shanten(counts, p.melds.length) === 0 && p.melds.length === 0) g.wall.bringToLive(0, (t) => SUIT(kindOf(t)) === suit, g.rng);
      return;
    }
    const { level } = teruLadder(g, seat);
    const sh = shanten(counts, p.melds.length);
    if (sh < 0) return;
    const tilt = tiltOf(level);
    // 摸了 t 和了的话是第几层（和不了是 0）
    const tierOf = (t: number, tsumo: boolean) => {
      counts[kindOf(t)]++;
      const done = shanten(counts, p.melds.length) < 0;
      counts[kindOf(t)]--;
      if (!done) return 0;
      const r = evaluateWin({
        closed: [...p.hand, t],
        melds: p.melds,
        winTile: t,
        tsumo,
        seatWind: g.seatWind(seat),
        roundWind: EAST + g.roundWind,
        isDealer: seat === g.dealer,
        riichi: p.riichi,
        doubleRiichi: p.doubleRiichi,
        ippatsu: p.ippatsu,
        doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
      });
      return r ? teruTier(r) : 0;
    };
    const useful = (t: number) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, p.melds.length);
      counts[kindOf(t)]--;
      if (after >= sh) return false;
      return after >= 0 || teruFits(g, seat, tierOf(t, true));
    };
    // 高层：先挑混一色、清一色那一门的
    const per = [0, 0, 0];
    for (const t of p.hand) if (kindOf(t) < 27) per[SUIT(kindOf(t))]++;
    const suit = per.indexOf(Math.max(...per));
    const onSuit = (t: number) => !tilt || SUIT(kindOf(t)) === suit || (tilt.honors && kindOf(t) >= 27);
    const before = g.wall.live[0];
    if (g.rng.chance(TERU.boost[level]) && !(useful(before) && onSuit(before))) {
      if (!g.wall.bringToLive(0, (t) => useful(t) && onSuit(t), g.rng) && !useful(before)) g.wall.bringToLive(0, useful, g.rng);
    }
    // 听牌了、荣和接得上天梯：摸到会自摸错层的牌就换成和不了的，留着等荣和（牌山快摸完了不挡）
    if (sh === 0 && g.wall.remaining > TERU.aiForceWin) {
      const top = tierOf(g.wall.live[0], true);
      const ronFits = () => {
        const waits = waitingKinds(counts, p.melds.length);
        if (p.furitenRiichi || waits.some((k) => p.discards.some((d) => kindOf(d.tile) === k))) return false;
        return waits.some((k) => {
          const t = [0, 1, 2, 3].map((i) => k * 4 + i).find((x) => !p.hand.includes(x) && !isRed(x)) ?? k * 4 + 1;
          return teruFits(g, seat, tierOf(t, false));
        });
      };
      if (top && !teruFits(g, seat, top) && ronFits()) g.wall.bringToLive(0, (t) => !tierOf(t, true), g.rng);
    }
    if (g.wall.live[0] === before) return;
    if (!st.boosted && level > 0) g.emit({ type: 'ability', seat, ability: 'teru', text: '连续和了' });
    st.boosted = true;
  },

  badge(g, seat) {
    if (!teruMirrored(g, seat)) return '照魔镜';
    const { level } = teruLadder(g, seat);
    return level ? `天梯·${TERU_TIERS[level - 1]}` : null;
  },

  skill(g, seat) {
    if (!teruMirrored(g, seat)) return { label: '照魔镜', note: '这一局只看不和；看过以后，点别人头像旁的镜子看他的能力', enabled: false };
    const { level, next, broke, kiki } = teruLadder(g, seat);
    const head = level ? `站在${TERU_TIERS[level - 1]}，下一次要正好和${TERU_TIERS[next - 1]}` : broke ? `天梯断了（${broke}），从 1 番起胡` : '先和一个 1 番起胡';
    return { label: '连续和了', note: `${head}；叽叽叽 ${kiki}/${TERU.kiki}`, enabled: false, active: level > 0 };
  },

  insight(g, seat) {
    if (!teruMirrored(g, seat)) return ['照魔镜：这一局只看不和'];
    const { level, next, kiki } = teruLadder(g, seat);
    return [level ? `天梯站在${TERU_TIERS[level - 1]}，下一次要正好和${TERU_TIERS[next - 1]}` : '还没起胡（要先和 1 番）', `叽叽叽：自摸 ${kiki}/${TERU.kiki}`];
  },
};

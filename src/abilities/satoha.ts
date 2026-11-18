import type { Game, RoundResult } from '../engine/game';
import { waitingKinds } from '../engine/shanten';
import { TileId, isRed, kindOf, toCounts } from '../engine/tiles';
import { akoDistance } from './ako';
import { luckyDeal, luckyDraw } from './luck';
import type { Ability } from './types';

// 辻垣内智叶（临海女子）：居合。全是被动，没有超能力，只有读得准、藏得住、出手快。
// 四条规则用同一个量串起来：间合，就是桌上最快的那一家离听牌还差几步。
// - 间合（读）：全程看得出每家离听牌还差几步，听牌的人牌有多大（不知道听什么）。隐身的桃子看不见
// - 后发先至（快）：她没听牌时，每次摸牌有一定概率换成有效进张，最快的那家离听牌越近概率越高；配牌也略顺
// - 鞘（藏）：没立直的听牌（门清默听、副露听牌都算），别人的感知类能力察觉不到（Ability.hidesTenpai）
// - 拔刀：鞘里听着牌、又有人踏进间合（听牌了），每次摸牌有 SATOHA.strike 的概率是和了牌；没人听牌时只有 SATOHA.sheath
// - 立直就是刀已出鞘：藏不住，也没有后发先至、拔刀
// - 斩连庄：别人连庄的局，庄家少算一步（一向听就当听牌）。她和牌结束别人的连庄时出「斬」
// - 看破：第 SATOHA.scoutRound 局起对能力者的打法有数（电脑照浩子的资料本打，玩家看得到“资”）
// - 亲番：她坐庄的局，配牌顺、后发先至、拔刀的概率全换成 SATOHA.dealer 那一组（大得多）
// 封印、高维领域、深山管得到的只有动牌山的两条（后发先至、拔刀）；间合、鞘、看破是技术，照旧
export const SATOHA = {
  // 平时（4 费时是 0.08、0.1、0.15、0.35、0.05、0.25，平均顺位 2.21）
  deal: 0.12, // 配牌顺
  fast: 0.15, // 没听牌时的进张：最快的一家两向听以上
  near1: 0.22, // 最快的一家一向听
  near0: 0.45, // 有人听牌
  sheath: 0.1, // 鞘里听牌、没人在间合内：摸到和了牌
  strike: 0.35, // 鞘里听牌、有人在间合内
  // 坐庄的局（亲番）：上面六项换成这一组。对随机对手 400 场平均顺位 1.80
  dealer: { deal: 0.3, fast: 0.3, near1: 0.45, near0: 0.65, sheath: 0.25, strike: 0.55 } as Record<SatohaRate, number>,
  renchanReach: 1, // 别人连庄的局，庄家少算这么多步
  scoutRound: 3, // 第几局起看破
};

type SatohaRate = 'deal' | 'fast' | 'near1' | 'near0' | 'sheath' | 'strike';
// 这一局用的概率：她坐庄时换成 SATOHA.dealer 那一组
export function satohaRate(g: Game, seat: number, k: SatohaRate): number {
  return g.dealer === seat ? SATOHA.dealer[k] : SATOHA[k];
}

interface SatohaGameState {
  // 上一局打完时谁坐庄（下一局还是他坐庄就是连庄）
  last?: { round: number; dealer: number };
}
interface SatohaState {
  // 这一局她和牌结束了谁的连庄
  cut?: number;
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as SatohaGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as SatohaState;

// 这一局是别人连庄的局：返回连庄的庄家，不是就 null
export function satohaRenchanDealer(g: Game, seat: number): number | null {
  const last = gameStateOf(g, seat).last;
  return last && last.round < g.round && last.dealer === g.dealer && g.dealer !== seat ? g.dealer : null;
}

// 这一局她和牌结束了谁的连庄（结算时出「斬」），没有就 null
export function satohaCut(g: Game, seat: number): number | null {
  return g.abilities[seat]?.id === 'satoha' ? stateOf(g, seat).cut ?? null : null;
}

// 间合：target 离听牌还差几步（0 是听牌了）。别的智叶藏着的听牌她也看不出
export function satohaDistance(g: Game, seat: number, target: number): number {
  return akoDistance(g, target, seat);
}

// 桌上最快的那一家离听牌还差几步（连庄的庄家少算一步）。隐身的桃子不算
export function satohaGap(g: Game, seat: number): number {
  const dealer = satohaRenchanDealer(g, seat);
  let best = 9;
  for (let s = 0; s < 4; s++) {
    if (s === seat || g.stealthed(s, seat)) continue;
    best = Math.min(best, satohaDistance(g, seat, s) - (s === dealer ? SATOHA.renchanReach : 0));
  }
  return best;
}

// 摸牌前的 13 张（刚摸牌、还没打的那一刻按摸牌前的算）
const before = (g: Game, seat: number): TileId[] => {
  const p = g.players[seat];
  return (p.hand.length + 3 * p.melds.length) % 3 === 2 && p.drawn !== null ? p.hand.filter((t) => t !== p.drawn) : p.hand;
};

// 刀在鞘里听着牌：听牌而且没立直（门清默听、副露听牌都算）
export function satohaSheathed(g: Game, seat: number): boolean {
  const p = g.players[seat];
  if (p.riichi || p.riichiPending) return false;
  return waitingKinds(toCounts(before(g, seat)), p.melds.length).length > 0;
}

// 拔得了刀：鞘里听着的牌里有自摸和得了的（副露没役的听牌不算）
export function satohaCanStrike(g: Game, seat: number): boolean {
  if (!satohaSheathed(g, seat) || !g.canWin(seat)) return false;
  const p = g.players[seat];
  const hand = before(g, seat);
  const full = p.hand;
  try {
    for (const k of waitingKinds(toCounts(hand), p.melds.length)) {
      // 用一张不在她手里的普通牌当和了牌
      const tile = [0, 1, 2, 3].map((i) => k * 4 + i).find((t) => !hand.includes(t) && !isRed(t)) ?? k * 4 + 1;
      p.hand = [...hand, tile];
      if (g.winResult(seat, tile, true, false)) return true;
    }
    return false;
  } finally {
    p.hand = full;
  }
}

// 动牌山的两条现在起不起作用（被封印、被高维领域压住时不起作用）
const wallOn = (g: Game, seat: number) => g.active(seat)?.id === 'satoha' && !g.quelled(seat);

// 刀的样子（只给操作她的玩家看）：
// stage 0 收在鞘里、1 出鞘三分（有人一向听）、2 出鞘七分（有人听牌）、3 立直了，刀已出鞘
// ready：鞘里听着牌、拔得了刀。chance：现在每次摸牌的加成（没听牌是进张，听牌是和了牌）。off：动牌山的两条被封住了
export interface SatohaBlade {
  stage: 0 | 1 | 2 | 3;
  ready: boolean;
  chance: number;
  gap: number;
  off: boolean;
}
export function satohaBlade(g: Game, seat: number): SatohaBlade {
  const p = g.players[seat];
  const gap = satohaGap(g, seat);
  const off = !wallOn(g, seat);
  if (p.riichi || p.riichiPending) return { stage: 3, ready: false, chance: 0, gap, off };
  const stage = gap <= 0 ? 2 : gap === 1 ? 1 : 0;
  const tenpai = satohaSheathed(g, seat);
  const ready = tenpai && satohaCanStrike(g, seat);
  const r = (k: SatohaRate) => satohaRate(g, seat, k);
  const chance = off ? 0 : tenpai ? (ready ? (gap <= 0 ? r('strike') : r('sheath')) : 0) : gap <= 0 ? r('near0') : gap === 1 ? r('near1') : r('fast');
  return { stage, ready, chance, gap, off };
}

// 看破：第几局起对能力者的打法有数（是技术，被封印也照旧）
export function satohaScouts(g: Game, seat: number): boolean {
  return g.abilities[seat]?.id === 'satoha' && g.round >= SATOHA.scoutRound;
}

// 电脑：别人连庄的局，鸣了这张能跳过庄家摸牌（庄家坐在打牌的人和她之间）
export function satohaCutsDealer(g: Game, seat: number, from: number): boolean {
  const dealer = satohaRenchanDealer(g, seat);
  if (dealer === null || dealer === from) return false;
  return (dealer - from + 4) % 4 < (seat - from + 4) % 4;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const GAP_TEXT = ['有人听牌', '有人一向听', '还没人逼近'];

export const satohaAbility: Ability = {
  id: 'satoha',
  name: '居合',
  description: `被动。间合：看得出每家离听牌还差几步，听牌的人牌有多大。后发先至：没听牌时进张更顺，别人离听牌越近越顺（平时 ${pct(SATOHA.fast)}，有人一向听 ${pct(SATOHA.near1)}，有人听牌 ${pct(SATOHA.near0)}）。鞘：没立直的听牌，感知类的能力察觉不到。拔刀：没立直听着牌、又有人听牌时，每次摸牌有 ${pct(SATOHA.strike)} 的概率摸到和了牌（没人听牌时 ${pct(SATOHA.sheath)}，和了要成立）。别人连庄的局，庄家少算一步。立直以后刀已出鞘，这些都没有了。第 ${SATOHA.scoutRound} 局起看得到对手的资料。坐庄的局（亲番）全面加强：配牌顺 ${pct(SATOHA.dealer.deal)}，进张 ${pct(SATOHA.dealer.fast)}、${pct(SATOHA.dealer.near1)}、${pct(SATOHA.dealer.near0)}，拔刀 ${pct(SATOHA.dealer.strike)}（没人听牌时 ${pct(SATOHA.dealer.sheath)}）。`,

  beforeDeal(g, seat) {
    luckyDeal(g, seat, satohaRate(g, seat, 'deal'));
  },

  beforeDraw(g, seat, rinshan) {
    const p = g.players[seat];
    if (p.riichi) return;
    const gap = satohaGap(g, seat);
    const waits = waitingKinds(toCounts(p.hand), p.melds.length);
    // 没听牌：后发先至
    if (!waits.length) {
      luckyDraw(g, seat, rinshan, satohaRate(g, seat, gap <= 0 ? 'near0' : gap === 1 ? 'near1' : 'fast'));
      return;
    }
    // 鞘里听着牌：拔刀
    if (!g.canWin(seat)) return;
    // 有役的和了牌：先放进手里试一下
    const wins = (t: TileId) => {
      if (!waits.includes(kindOf(t))) return false;
      p.hand.push(t);
      const ok = !!g.winResult(seat, t, true);
      p.hand.pop();
      return ok;
    };
    const w = g.wall;
    const next = rinshan ? w.rinshan[0] : w.live[0];
    // 本来就摸得到，或者这次没轮到
    if (next === undefined || wins(next) || !g.rng.chance(satohaRate(g, seat, gap <= 0 ? 'strike' : 'sheath'))) return;
    const ok = rinshan ? w.bringToRinshan(wins, g.rng) : w.bringToLive(0, wins, g.rng);
    // 悄悄换：画面上不出字（见 src/ui/app.ts），结算时能力痕迹里再讲
    if (ok) g.emit({ type: 'ability', seat, ability: 'satoha', text: '拔刀' });
  },

  // 打过两局，对桌上能力者的打法有数了（电脑照浩子的资料本打，玩家看得到对手头像上的“资”）
  onRoundStart(g, seat) {
    if (g.round === SATOHA.scoutRound) g.emit({ type: 'ability', seat, ability: 'satoha', text: '看破' });
  },

  // 被封印也照样调用：记下谁坐庄（下一局看是不是连庄），她和牌结束了别人的连庄就出「斬」
  onRoundEnd(g, seat, result: RoundResult) {
    const dealer = satohaRenchanDealer(g, seat);
    gameStateOf(g, seat).last = { round: g.round, dealer: g.dealer };
    if (dealer === null || result.kind !== 'win') return;
    if (!result.wins.some((w) => w.seat === seat) || result.wins.some((w) => w.seat === dealer)) return;
    stateOf(g, seat).cut = dealer;
    g.emit({ type: 'ability', seat, ability: 'satoha', text: '斬' });
  },

  hidesTenpai(g, seat) {
    return satohaSheathed(g, seat);
  },

  // 头像换成能力发动头像：鞘里听着牌、有人在间合内。只给操作她的玩家看（见 src/ui/app.ts），别人看到的始终是平常头像
  powered(g, seat) {
    const b = satohaBlade(g, seat);
    return b.ready && b.stage === 2 && !b.off;
  },

  skill(g, seat) {
    const b = satohaBlade(g, seat);
    const near = GAP_TEXT[Math.max(0, Math.min(2, b.gap))];
    const dealer = satohaRenchanDealer(g, seat);
    const cut = dealer !== null ? '。庄家在连庄：少算一步' : '';
    let note: string;
    if (b.stage === 3) note = '立直了：刀已出鞘，没有加成';
    else if (b.off) note = `间合：${near}${cut}。被封住了：进张、拔刀不起作用`;
    else if (satohaSheathed(g, seat)) note = b.ready ? `鞘里听牌，${near}：每次摸牌 ${pct(b.chance)} 是和了牌${cut}` : `鞘里听牌，但没有役：拔不了刀${cut}`;
    else note = `间合：${near}，进张 +${pct(b.chance)}${cut}`;
    if (g.dealer === seat && b.stage !== 3) note = `亲番　${note}`;
    return { label: '', note, enabled: false, active: b.ready && b.stage === 2 && !b.off };
  },

  // 照魔镜照得穿她：看得出刀在不在鞘里
  insight(g, seat) {
    const b = satohaBlade(g, seat);
    if (b.stage === 3) return ['立直了：刀已出鞘，没有加成'];
    const near = GAP_TEXT[Math.max(0, Math.min(2, b.gap))];
    return [
      satohaSheathed(g, seat) ? (b.ready ? `鞘里听着牌：${b.stage === 2 ? '有人听牌，随时拔刀' : '还没人踏进间合'}` : '鞘里听着牌，但没有役') : `还没听牌。间合：${near}，别人越近她进张越顺`,
      '没立直的听牌，感知类的能力察觉不到',
    ];
  },
};

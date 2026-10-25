import type { Game, WinInfo } from '../engine/game';
import { evaluateWin, type WinResult } from '../engine/score';
import { shanten } from '../engine/shanten';
import { EAST, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 宫永照（白糸台）：
// - 照魔镜：第一局只看不和（这一局她和不了牌），看过以后整场都看得穿别人：
//   玩家操作她时，别人的头像旁边多一面镜子，点开能看到这家能力现在的状态（Ability.insight）；
//   电脑的照读得出别人听什么，不打别人和得了的牌
// - 别人的能力动不了她（Ability.immune）：不被封印，别人对她的配牌、摸牌定的规矩不算；只有玄的宝牌她也得守
// - 连续和了：照魔镜看过以后摸牌就比别人顺；和了以后进入连和，摸牌更容易摸到进张，连得越多越快；
//   下一次和了必须不小于上一次（按她拿到的点数算，不算本场和立直棒），和小了、别人和牌、流局，连和就断
export const TERU = {
  idleBoost: 0.15, // 照魔镜看过、还没连和时，摸牌换成进张的概率（全书最强，平时也压人）
  boostBase: 0.5, // 连和第一次时
  boostStep: 0.15, // 每多连一次加多少
  boostMax: 0.9,
  aiForceWin: 12, // 电脑的照：牌山剩这么多张以内，不够大也和（免得白白流局）
};

interface TeruGameState {
  rounds?: number; // 开过几局
  seen?: number; // g.events 里看到哪了（上一局的结算从这里往后找）
  dealer?: boolean; // 这一局她是不是庄家（下一局开局时算上一局和了多少用）
  streak?: number; // 连和了几次
  last?: number; // 上一次和了拿到的点数（下一次至少这么多）
  broke?: string; // 上一次连和断掉的原因（给界面看）
}
interface TeruState {
  boosted?: boolean; // 这一局已经提示过“连续和了”
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as TeruGameState;

// 她这次和了拿到多少（不算本场、立直棒）
export function teruWinValue(r: WinResult, tsumo: boolean, dealer: boolean): number {
  if (!tsumo) return r.ron;
  return dealer ? r.tsumoOtherPays * 3 : r.tsumoDealerPays + r.tsumoOtherPays * 2;
}

// 照魔镜看过了没有（第一局结束以后）
export function teruMirrored(g: Game, seat: number): boolean {
  return (gameStateOf(g, seat).rounds ?? 0) > 1;
}

export function teruStreak(g: Game, seat: number): { count: number; min: number; broke: string | null } {
  const gs = gameStateOf(g, seat);
  return { count: gs.streak ?? 0, min: gs.streak ? gs.last ?? 0 : 0, broke: gs.broke ?? null };
}

// 和了这一手（value 点）能不能接上连和
export function teruKeeps(g: Game, seat: number, value: number): boolean {
  const { count, min } = teruStreak(g, seat);
  return count === 0 || value >= min;
}

// 上一局的结算算进连和
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
  const mine: WinInfo | undefined = r.wins.find((w) => w.seat === seat);
  if (!mine) {
    if (gs.streak) gs.broke = r.kind === 'win' ? '别人和了' : '流局';
    gs.streak = 0;
    return;
  }
  const value = teruWinValue(mine.result, mine.from === null, !!gs.dealer);
  if (teruKeeps(g, seat, value)) {
    gs.streak = (gs.streak ?? 0) + 1;
    gs.last = value;
    gs.broke = undefined;
  } else {
    gs.broke = `和了 ${value} 点，比上一次的 ${gs.last} 点小`;
    gs.streak = 0;
  }
}

export const teruAbility: Ability = {
  id: 'teru',
  name: '照魔镜·连续和了',
  immune: true,
  description:
    '别人的能力动不了她（只有玄的宝牌她也得守）。第一局用照魔镜只看不和，之后看得穿每家的能力（玩家能点开别人头像旁的镜子看），摸牌也比别人顺。和了以后进入连和：摸牌更容易摸到进张，连得越多越快；但下一次和了必须不小于上一次，和小了、别人和牌或流局，连和就断。',

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    settle(g, seat);
    gs.rounds = (gs.rounds ?? 0) + 1;
    gs.dealer = seat === g.dealer;
  },

  onRoundStart(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.rounds === 1) g.emit({ type: 'ability', seat, ability: 'teru', text: '照魔镜' });
  },

  canWin(g, seat) {
    return teruMirrored(g, seat);
  },

  // 连和中：摸牌换成进张
  beforeDraw(g, seat, rinshan) {
    const { count } = teruStreak(g, seat);
    if (rinshan || !teruMirrored(g, seat)) return;
    const chance = count === 0 ? TERU.idleBoost : Math.min(TERU.boostBase + TERU.boostStep * (count - 1), TERU.boostMax);
    if (!g.rng.chance(chance)) return;
    const p = g.players[seat];
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    if (sh < 0) return;
    const { min } = teruStreak(g, seat);
    const useful = (t: number) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, p.melds.length);
      counts[kindOf(t)]--;
      if (after >= sh) return false;
      // 听牌时：只给够大的和了牌（接得上连和的）
      if (after < 0) {
        const r = evaluateWin({
          closed: [...p.hand, t],
          melds: p.melds,
          winTile: t,
          tsumo: true,
          seatWind: g.seatWind(seat),
          roundWind: EAST + g.roundWind,
          isDealer: seat === g.dealer,
          riichi: p.riichi,
          doubleRiichi: p.doubleRiichi,
          ippatsu: p.ippatsu,
          doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
        });
        return !!r && teruWinValue(r, true, seat === g.dealer) >= min;
      }
      return true;
    };
    // 连和要越和越大：有用的牌里先挑宝牌
    const dora = (t: number) => isDoraTile(g, t);
    const before = g.wall.live[0];
    if (!g.wall.bringToLive(0, (t) => useful(t) && dora(t), g.rng) && !useful(before)) g.wall.bringToLive(0, useful, g.rng);
    if (g.wall.live[0] === before) return;
    const st = g.abilityState[seat] as TeruState;
    if (!st.boosted && count > 0) g.emit({ type: 'ability', seat, ability: 'teru', text: '连续和了' });
    st.boosted = true;
  },

  badge(g, seat) {
    if (!teruMirrored(g, seat)) return '照魔镜';
    const { count } = teruStreak(g, seat);
    return count ? `连和×${count}` : null;
  },

  skill(g, seat) {
    if (!teruMirrored(g, seat)) return { label: '照魔镜', note: '这一局只看不和；看过以后，点别人头像旁的镜子看他的能力', enabled: false };
    const { count, min, broke } = teruStreak(g, seat);
    const note = count ? `已连和 ${count} 次，下一次至少 ${min} 点` : broke ? `连和断了（${broke}），从头再来` : '和了一次就进入连和';
    return { label: '连续和了', note, enabled: false, active: count > 0 };
  },

  insight(g, seat) {
    const { count, min } = teruStreak(g, seat);
    if (!teruMirrored(g, seat)) return ['照魔镜：这一局只看不和'];
    return [count ? `连和 ${count} 次，下一次至少 ${min} 点` : '还没开始连和'];
  },
};

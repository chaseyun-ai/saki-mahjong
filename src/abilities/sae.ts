import type { Game } from '../engine/game';
import { kindOf, type TileId } from '../engine/tiles';
import type { Ability, DrawRule } from './types';

// 臼泽塞（宫守）：镜片。一场比赛三枚镜片，用了不回来。
// 局中任意时刻（配完牌以后、这一局结束之前）拿一枚镜片盯住一个人：这一局那个人摸不到和了牌。
// 跟花田煌一样换牌：该发给他的和了牌换成别的牌（海底只剩一张时从王牌里换）。
// 别人打出来的照样能荣和，和牌键不拿走。
// 一局只能盯一个人。别人的能力管不到的人（宫永照这样 immune 的）盯不住，镜片不会白白用掉。
// 换牌走控场能力的摸牌规矩（beforeAnyDraw 返回 DrawRule），所以丰音的佛灭、淡的高维领域、稳乃的深山、
// 天使和挡掉一半，都跟别的控场能力一样算。
// 玩家：把技能框里的镜片拖到别人头像上；电脑：有人立直时看情况用。
export const SAE = {
  lenses: 3,
};

// 换掉和了牌时发的能力事件（用镜片时是「镜片」：界面只在用镜片时放狙击镜，换牌只出提示）
export const SAE_BLOCK = '塞住';

interface SaeGameState {
  used?: number;
}
interface SaeState {
  target?: number;
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as SaeGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as SaeState;

export const saeLensesLeft = (g: Game, seat: number): number => SAE.lenses - (gameStateOf(g, seat).used ?? 0);

// 这一局被她盯上的人（能力不起作用时是 null）
export function saeTarget(g: Game, seat: number): number | null {
  if (g.active(seat)?.id !== 'sae') return null;
  return stateOf(g, seat).target ?? null;
}

// 这一局被哪位臼泽塞的镜片盯上了（界面：头像上的准星）
export function snipedBy(g: Game, target: number): number | null {
  for (let s = 0; s < 4; s++) if (s !== target && saeTarget(g, s) === target && g.binds(s, target)) return s;
  return null;
}

const inRound = (g: Game) => g.phase === 'turn' || g.phase === 'calls';

// 现在能把镜片用在 target 身上吗
export function saeCanAim(g: Game, seat: number, target: number): boolean {
  if (target === seat || target < 0 || target > 3 || !inRound(g)) return false;
  if (g.active(seat)?.id !== 'sae' || saeLensesLeft(g, seat) <= 0) return false;
  if (stateOf(g, seat).target !== undefined) return false;
  return g.binds(seat, target);
}

// 用一枚镜片盯住 target。成功返回 true
export function saeAim(g: Game, seat: number, target: number): boolean {
  if (!saeCanAim(g, seat, target)) return false;
  stateOf(g, seat).target = target;
  const gs = gameStateOf(g, seat);
  gs.used = (gs.used ?? 0) + 1;
  g.emit({ type: 'ability', seat, ability: 'sae', text: '镜片' });
  return true;
}

// 还剩几局（照计划；南入、连庄以后按 1 算）
function handsLeft(g: Game): number {
  const last = g.format === 'one' ? 0 : g.fullHanchan ? 7 : 3;
  return Math.max(1, last - (g.roundWind * 4 + g.roundNumber) + 1);
}

// 电脑的塞：有人立直了就看要不要盯。镜片够把剩下的局都用上就用；不然盯庄家、领先的人，或者到了最后两局
function aiAim(g: Game, seat: number): void {
  if (g.manual[seat] || !inRound(g) || stateOf(g, seat).target !== undefined) return;
  const left = saeLensesLeft(g, seat);
  if (left <= 0) return;
  const riichi = [0, 1, 2, 3].filter((o) => o !== seat && g.players[o].riichi && saeCanAim(g, seat, o));
  if (!riichi.length) return;
  const top = Math.max(...g.players.map((p) => p.score));
  const worth = (o: number) => left >= handsLeft(g) || o === g.dealer || g.players[o].score === top || g.isLastRounds(2);
  const pick = riichi.filter(worth).sort((a, b) => Number(b === g.dealer) - Number(a === g.dealer) || g.players[b].score - g.players[a].score)[0];
  if (pick !== undefined) saeAim(g, seat, pick);
}

// 被盯上的人这一次摸牌的规矩：听的牌都摸不到
function blockRule(g: Game, seat: number, drawer: number, rinshan: boolean): DrawRule | null {
  if (stateOf(g, seat).target !== drawer || !g.binds(seat, drawer)) return null;
  const waits = g.waits(drawer);
  if (!waits.length) return null;
  const deny = (t: TileId) => waits.includes(kindOf(t));
  const w = g.wall;
  // 海底只剩一张、那张又是和了牌：牌山里换不出来，从还没翻开的王牌里换（先动的人定的规矩照样守）。
  // 天使和照常有一半挡得住
  if (!rinshan && w.live.length === 1 && deny(w.live[0])) {
    const resist = g.active(drawer)?.resist?.(g, drawer, seat) ?? 0;
    const earlier = w.deny;
    if (!(resist > 0 && g.rng.chance(resist)) && w.bringFromDead(false, (t) => !deny(t) && !earlier?.(t), g.rng)) {
      g.emit({ type: 'ability', seat, ability: 'sae', text: SAE_BLOCK, target: drawer });
    }
  }
  return { seat, ability: 'sae', text: SAE_BLOCK, deny };
}

export const saeAbility: Ability = {
  id: 'sae',
  name: '镜片',
  description: `一场比赛有 ${SAE.lenses} 枚镜片，用了不回来。局中任意时刻可以用一枚盯住一个人：这一局那个人摸不到和了牌，别人打出来的照样能荣和。一局只能盯一个人。`,

  beforeAnyDraw(g, seat, drawer, rinshan) {
    aiAim(g, seat);
    return blockRule(g, seat, drawer, rinshan);
  },

  // 这一局用镜片盯上了人：头像换成能力发动头像
  powered(g, seat) {
    return stateOf(g, seat).target !== undefined;
  },

  skill(g, seat) {
    const left = saeLensesLeft(g, seat);
    const target = stateOf(g, seat).target ?? null;
    const targets = [0, 1, 2, 3].filter((o) => saeCanAim(g, seat, o));
    const note =
      target !== null
        ? `这一局盯上了${g.players[target].name}：摸不到和了牌（还剩 ${left} 枚）`
        : left <= 0
          ? '镜片用完了'
          : inRound(g)
            ? `还剩 ${left} 枚：把镜片拖到别人头像上，这一局那个人摸不到和了牌`
            : `还剩 ${left} 枚，配完牌以后随时能用`;
    return { label: '', note, enabled: targets.length > 0, active: target !== null, lenses: { max: SAE.lenses, left, target, targets } };
  },

  pressSkill(g, seat, choice) {
    if (choice !== undefined) saeAim(g, seat, Number(choice));
  },

  insight(g, seat) {
    const t = stateOf(g, seat).target;
    return [`镜片还剩 ${saeLensesLeft(g, seat)} 枚`, t !== undefined ? `这一局盯上了${g.players[t].name}，那家摸不到和了牌` : '这一局还没盯人'];
  },
};

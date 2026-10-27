import type { Game } from '../engine/game';
import { type Kind, type TileId, kindOf } from '../engine/tiles';
import type { Ability } from './types';

// 福路美穗子（风越）：平时闭着右眼稳稳地打。牌局中任何时候都可以花体力睁开右眼，一直睁到这一局结束：
// 看不到别人的牌，但看得出每个人的理牌习惯：别人手牌的牌背按花色上色（万红、筒蓝、索绿、字牌白），
// 每家手里各种花色有几张一目了然（不动牌山）。睁眼时画面罩一层蓝色。
// - 电脑的美穗子：落后、坐庄或者有人立直时睁眼。睁眼后，立直的人手里没有的花色是现物一样安全的牌
export const MIHOKO = {
  energyMax: 100,
  eyeCost: 25,
  regen: 10, // 每局开始回多少
};

interface MihokoGameState {
  energy?: number;
  refilledAt?: number; // 回体力回到第几局了（已经结束的局数）
}
interface MihokoState {
  open?: boolean;
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as MihokoState;

// 每局开始回一次体力（只回一次）
function gameStateOf(g: Game, seat: number): MihokoGameState {
  const gs = g.abilityGameState[seat] as MihokoGameState;
  gs.energy ??= MIHOKO.energyMax;
  const ended = g.events.reduce((n, e) => n + (e.type === 'roundEnd' ? 1 : 0), 0);
  if (gs.refilledAt === undefined) gs.refilledAt = ended;
  if (ended > gs.refilledAt) {
    gs.energy = Math.min(MIHOKO.energyMax, gs.energy + MIHOKO.regen * (ended - gs.refilledAt));
    gs.refilledAt = ended;
  }
  return gs;
}

export function mihokoEnergy(g: Game, seat: number): number {
  return gameStateOf(g, seat).energy!;
}

// 这一局右眼睁开了没有
export function mihokoEyeOpen(g: Game, seat: number): boolean {
  return !!stateOf(g, seat).open;
}

// 牌背的花色：0 万、1 筒、2 索、3 字牌
export const suitClass = (t: TileId): number => Math.min(3, Math.floor(kindOf(t) / 9));

// 睁眼看到的：某一家手里（不算副露）各花色有几张
export function mihokoSuitCounts(g: Game, target: number): number[] {
  const out = [0, 0, 0, 0];
  for (const t of g.players[target].hand) out[suitClass(t)]++;
  return out;
}

// 睁眼时对 target 安全的牌种：他手里一张都没有的花色（数牌的听牌要手里有同花色的牌，字牌要有字牌）；
// 鸣过牌的人（做不了七对子）再加上张数是 3 的倍数的花色（见 mihokoLikelySafe）
export function mihokoSafeKinds(g: Game, seat: number, target: number): Set<Kind> {
  const out = new Set<Kind>();
  if (!mihokoEyeOpen(g, seat)) return out;
  const counts = mihokoSuitCounts(g, target);
  const melded = g.players[target].melds.length > 0;
  for (let k = 0; k < 34; k++) {
    const n = counts[Math.min(3, Math.floor(k / 9))];
    if (n === 0 || (melded && n % 3 === 0)) out.add(k);
  }
  return out;
}

// 睁眼时对 target 多半安全的牌种：张数是 3 的倍数的花色。听牌的手是「几组面子 + 雀头」少一张：
// 单骑、或者雀头和搭子在同一门时，那门余 1；雀头和搭子分在两门时（两面、坎张、双碰），这两门都余 2；
// 余 0 的那门全是整组面子，里面没有他的听牌。比如看到字 2、索 3、筒 3、万 5：听的一定是字牌（双碰）或者万子。
// 只有门清的七对子例外，所以门清的人这只是「多半」
export function mihokoLikelySafe(g: Game, seat: number, target: number): Set<Kind> {
  const out = new Set<Kind>();
  if (!mihokoEyeOpen(g, seat)) return out;
  const counts = mihokoSuitCounts(g, target);
  for (let k = 0; k < 34; k++) if (counts[Math.min(3, Math.floor(k / 9))] % 3 === 0) out.add(k);
  return out;
}

const canOpen = (g: Game, seat: number) => !mihokoEyeOpen(g, seat) && mihokoEnergy(g, seat) >= MIHOKO.eyeCost && (g.phase === 'turn' || g.phase === 'calls');

function open(g: Game, seat: number): void {
  gameStateOf(g, seat).energy! -= MIHOKO.eyeCost;
  stateOf(g, seat).open = true;
  g.emit({ type: 'ability', seat, ability: 'mihoko', text: '睁开右眼' });
}

const isBehind = (g: Game, seat: number) => g.players.some((p) => p.seat !== seat && p.score > g.players[seat].score);

export const mihokoAbility: Ability = {
  id: 'mihoko',
  name: '右眼',
  description: `平时闭着右眼稳稳地打。牌局中任何时候都可以花 ${MIHOKO.eyeCost} 体力睁开右眼，一直到这一局结束：看不到别人的牌，但看得出理牌习惯，别人手牌的牌背按花色上色（万红、筒蓝、索绿、字牌白）。体力上限 ${MIHOKO.energyMax}，每局回 ${MIHOKO.regen}。`,

  // 电脑的美穗子：开局时落后或坐庄就睁眼；没睁的话，有人立直时再睁
  beforeAnyDraw(g, seat) {
    if (g.manual[seat] || !canOpen(g, seat)) return;
    const riichi = g.players.some((p) => p.seat !== seat && p.riichi);
    const start = g.players[seat].discards.length === 0 && (isBehind(g, seat) || seat === g.dealer);
    if (riichi || start) open(g, seat);
  },

  skill(g, seat) {
    const eye = mihokoEyeOpen(g, seat);
    const energy = mihokoEnergy(g, seat);
    const note = eye
      ? '右眼睁开：别人的牌背按花色上色，到这一局结束'
      : energy >= MIHOKO.eyeCost
        ? `花 ${MIHOKO.eyeCost} 体力，这一局看出每家各花色有几张`
        : '体力不够';
    return { label: eye ? '右眼睁开中' : '睁开右眼', note, enabled: canOpen(g, seat), meter: { value: energy, max: MIHOKO.energyMax }, active: eye };
  },

  pressSkill(g, seat) {
    if (canOpen(g, seat)) open(g, seat);
  },

  badge(g, seat) {
    return mihokoEyeOpen(g, seat) ? '右眼' : null;
  },

  insight(g, seat) {
    return [`体力 ${mihokoEnergy(g, seat)}/${MIHOKO.energyMax}`, mihokoEyeOpen(g, seat) ? '这一局右眼睁开，看得出每家各花色有几张' : '这一局闭着右眼'];
  },
};

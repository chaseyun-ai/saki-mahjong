import type { Game } from '../engine/game';
import type { Kind } from '../engine/tiles';
import { readOthers } from './hiroe';
import type { Ability } from './types';

// 福路美穗子（风越）：平时闭着右眼，没有能力，稳稳地打。发牌前可以花体力睁开右眼：
// 这一局另外三家的手牌她都看得见（不动牌山）。
// - 玩家操作她时：界面上列出三家的手牌和听牌，指着会放铳的牌时提醒
// - 电脑的美穗子：照看到的听牌防守；庄家连庄、领先时，故意打一张便宜的和了牌给闲家，把庄家拉下来
export const MIHOKO = {
  energyMax: 100,
  eyeCost: 25,
  regen: 10, // 每局开始回多少
  feedMax: 2600, // 送牌只送这么小的和了
};

interface MihokoGameState {
  energy?: number;
  refilledAt?: number; // 回体力回到第几局了（已经结束的局数）
  want?: boolean; // 玩家选了睁眼（也当下一局的默认）
}
interface MihokoState {
  open?: boolean;
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as MihokoState;

// 每局开始回一次体力（发牌前界面和配牌都会来问，只回一次）
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

const isBehind = (g: Game, seat: number) => g.players.some((p) => p.seat !== seat && p.score > g.players[seat].score);

// 电脑的美穗子：该送牌时，送哪几种牌（打给闲家的便宜和了，结束庄家的连庄）。不该送是空的
export function mihokoFeedKinds(g: Game, seat: number): Set<Kind> {
  const out = new Set<Kind>();
  const d = g.dealer;
  if (!mihokoEyeOpen(g, seat) || d === seat) return out;
  const top = Math.max(...g.players.map((p) => p.score));
  if (g.honba === 0 && g.players[d].score < top) return out;
  const reads = readOthers(g, seat);
  const dealerRon = new Set(reads.find((r) => r.seat === d)?.ron ?? []);
  for (const r of reads) {
    // 立直的人可能有里宝，送不准
    if (r.seat === d || r.value > MIHOKO.feedMax || g.players[r.seat].riichi) continue;
    for (const k of r.ron) if (!dealerRon.has(k)) out.add(k);
  }
  return out;
}

export const mihokoAbility: Ability = {
  id: 'mihoko',
  name: '右眼',
  description: `平时闭着右眼稳稳地打。发牌前可以花 ${MIHOKO.eyeCost} 体力睁开右眼：这一局看得见另外三家的手牌（不动牌山）。体力上限 ${MIHOKO.energyMax}，每局回 ${MIHOKO.regen}。`,

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const can = gs.energy! >= MIHOKO.eyeCost;
    const open = can && (g.manual[seat] ? !!gs.want : isBehind(g, seat) || seat === g.dealer);
    if (!open) return;
    gs.energy! -= MIHOKO.eyeCost;
    stateOf(g, seat).open = true;
  },

  onRoundStart(g, seat) {
    if (mihokoEyeOpen(g, seat)) g.emit({ type: 'ability', seat, ability: 'mihoko', text: '睁开右眼' });
  },

  preDeal(g, seat) {
    const gs = gameStateOf(g, seat);
    const ok = gs.energy! >= MIHOKO.eyeCost;
    return [{ id: 'eye', name: '睁开右眼', desc: '这一局看得见另外三家的手牌和听牌', cost: MIHOKO.eyeCost, enabled: ok, picked: ok && !!gs.want, note: ok ? undefined : '体力不够' }];
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).want = picked.includes('eye');
  },

  skill(g, seat) {
    const open = mihokoEyeOpen(g, seat);
    return { label: '', note: open ? '这一局右眼睁开：看得见三家的手牌' : '这一局闭着右眼', enabled: false, meter: { value: mihokoEnergy(g, seat), max: MIHOKO.energyMax }, active: open };
  },

  badge(g, seat) {
    return mihokoEyeOpen(g, seat) ? '右眼' : null;
  },

  insight(g, seat) {
    return [`体力 ${mihokoEnergy(g, seat)}/${MIHOKO.energyMax}`, mihokoEyeOpen(g, seat) ? '这一局右眼睁开，看得见所有人的手牌' : '这一局闭着右眼'];
  },
};

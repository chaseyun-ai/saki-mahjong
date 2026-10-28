import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { Kind, RED_FIVES, TileId, isRed, kindOf, toCounts } from '../engine/tiles';
import { seatCost } from './costs';
import { PRIORITY, type Ability, type PreDealOption } from './types';

// 姊带丰音（宫守）：六曜。六种技能，每一局只有一种起作用，不叠加（先起作用的那种占住这一局）。
// - 先负（被动）：平时默听。场上有人立直、她还没立直时发动：手牌进展加快；她追立以后，比她先立直的人摸到的都是她的铳牌
// - 先胜（主动）：前 10 巡摸牌更容易是进张；第 11 巡起摸牌变慢，还容易摸到别人的铳牌
// - 赤口（主动）：看得见三张赤宝牌在哪；她手里有赤宝牌时进张 +30%，别人手里有赤宝牌时那家进张 -30%
// - 友引（被动）：四副露听单骑，下一次摸牌必定自摸（和了要有役）
// - 大安（主动，一场一次）：这一局别人的能力影响不到她的摸牌
// - 佛灭（主动，一场一次）：这一局所有控场的能力（别人的配牌、摸牌规矩，封印，不许和牌，整理牌山）全部无效。玄的宝牌是作者钦定的，照样算
// 主动的四种在发牌前选，也可以在这一局里随时按（这一局还没有别的技能起作用时）。
// 电脑的丰音：大安、佛灭留到落后或者最后两局、桌上有强的控场能力时用；坐庄时一半的概率开先胜；手里有赤宝牌时开赤口
export const TOYONE = {
  senbuDraw: 0.5, // 先负发动后摸牌换成进张的概率
  senshoTurns: 10, // 先胜加速的巡数
  senshoDraw: 0.5, // 先胜前 10 巡换成进张的概率
  senshoDeal: 0.4, // 先胜第 11 巡起摸到别人铳牌的概率
  senshoSlow: 0.3, // 先胜第 11 巡起进张被换走的概率
  shakku: 0.3, // 赤口：进张加减的幅度
  behind: 8000, // 电脑：落后第一这么多就用大安、佛灭
  dealerSensho: 0.5, // 电脑：坐庄时开先胜的概率
};

export type RokuyouId = 'senbu' | 'sensho' | 'shakku' | 'tomobiki' | 'taian' | 'butsumetsu';

export const ROKUYOU: { id: RokuyouId; name: string; active: boolean; once: boolean; desc: string }[] = [
  { id: 'senbu', name: '先负', active: false, once: false, desc: '保持默听；有人立直后手牌进展加快，追立以后先立直的人摸到她的铳牌' },
  { id: 'sensho', name: '先胜', active: true, once: false, desc: `前 ${TOYONE.senshoTurns} 巡进张更快；第 ${TOYONE.senshoTurns + 1} 巡起进张变慢，容易摸到别人的铳牌` },
  { id: 'shakku', name: '赤口', active: true, once: false, desc: `看得见赤宝牌在哪；手里有赤宝牌进张 +${TOYONE.shakku * 100}%，别人手里有赤宝牌那家进张 -${TOYONE.shakku * 100}%` },
  { id: 'tomobiki', name: '友引', active: false, once: false, desc: '四副露听单骑，下一次摸牌必定自摸' },
  { id: 'taian', name: '大安', active: true, once: true, desc: '这一局别人的能力影响不到她的摸牌（一场一次）' },
  { id: 'butsumetsu', name: '佛灭', active: true, once: true, desc: '这一局所有控场的能力无效（一场一次）' },
];

const nameOf = (id: RokuyouId) => ROKUYOU.find((r) => r.id === id)!.name;

interface ToyoneGameState {
  used?: RokuyouId[]; // 用过的一场一次的技能
  want?: RokuyouId | null; // 玩家发牌前选的
}
interface ToyoneState {
  mode?: RokuyouId; // 这一局起作用的那一种
  chase?: number[]; // 先负：她追立时已经立直的人
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as ToyoneGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as ToyoneState;

// 这一局起作用的六曜（没有、被封印是 null）
export function toyoneMode(g: Game, seat: number): RokuyouId | null {
  if (g.abilities[seat]?.id !== 'toyone') return null;
  const mode = stateOf(g, seat).mode ?? null;
  // 佛灭连封印也破了，不看封印
  if (mode === 'butsumetsu') return mode;
  return g.active(seat) ? mode : null;
}

// 这一局还能不能开 id（没有别的技能起作用、一场一次的没用过）
export function toyoneCanUse(g: Game, seat: number, id: RokuyouId): boolean {
  const r = ROKUYOU.find((x) => x.id === id)!;
  if (!r.active || stateOf(g, seat).mode) return false;
  return !(r.once && (gameStateOf(g, seat).used ?? []).includes(id));
}

// announce：发动时出字（友引等到真把和了牌送到手里才出字）
function start(g: Game, seat: number, id: RokuyouId, announce = true): void {
  stateOf(g, seat).mode = id;
  if (ROKUYOU.find((x) => x.id === id)!.once) {
    const gs = gameStateOf(g, seat);
    gs.used = [...(gs.used ?? []), id];
  }
  if (announce) g.emit({ type: 'ability', seat, ability: 'toyone', text: nameOf(id) });
}

// 赤口：三张赤宝牌各在哪
export function toyoneRedSpots(g: Game, seat: number): { tile: TileId; where: string }[] {
  return RED_FIVES.map((tile) => {
    for (const p of g.players) {
      if (p.hand.includes(tile)) return { tile, where: p.seat === seat ? '自己手里' : `${p.name}手里` };
      if (p.melds.some((m) => m.tiles.includes(tile))) return { tile, where: `${p.name}的副露` };
      if (p.discards.some((d) => d.tile === tile)) return { tile, where: `${p.name}的牌河` };
    }
    const w = g.wall;
    const live = w.live.indexOf(tile);
    if (live >= 0) return { tile, where: `牌山（还有 ${live} 张摸到）` };
    if (w.doraIndicators.slice(0, w.visibleDoraIndicators().length).includes(tile)) return { tile, where: '宝牌指示牌' };
    return { tile, where: '王牌里' };
  });
}

// 赤口：这些没公开的赤宝牌（别人手里的、牌山里的）在牌桌上点亮
export function toyoneRedHidden(g: Game, seat: number): Set<TileId> {
  if (toyoneMode(g, seat) !== 'shakku') return new Set();
  const open = new Set<TileId>([...g.players[seat].hand, ...g.players.flatMap((p) => [...p.discards.map((d) => d.tile), ...p.melds.flatMap((m) => m.tiles)])]);
  return new Set(RED_FIVES.filter((t) => !open.has(t)));
}

// seat 摸到 t 会不会进张
const useful = (g: Game, seat: number) => {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const sh = shanten(counts, p.melds.length);
  return (t: TileId) => {
    counts[kindOf(t)]++;
    const after = shanten(counts, p.melds.length);
    counts[kindOf(t)]--;
    return after < sh;
  };
};

// 下一张换成进张
function speedUp(g: Game, seat: number, rinshan: boolean): void {
  const good = useful(g, seat);
  const w = g.wall;
  if (rinshan) {
    if (!good(w.rinshan[0])) w.bringToRinshan(good, g.rng);
  } else if (!good(w.live[0])) w.bringToLive(0, good, g.rng);
}

// 别人听牌、打出去会被荣和的牌种
function othersRon(g: Game, seat: number): Set<Kind> {
  const out = new Set<Kind>();
  for (let o = 0; o < 4; o++) {
    if (o === seat || !g.canWin(o) || g.isFuriten(o)) continue;
    for (const k of g.waits(o)) out.add(k);
  }
  return out;
}

// 桌上有强的控场能力（3 费以上、会动别人的牌或者封住别人）
function strongControl(g: Game, seat: number): boolean {
  return [0, 1, 2, 3].some((o) => {
    const a = g.active(o);
    return o !== seat && !!a && seatCost(g, o) >= 3 && !!(a.beforeAnyDraw || a.dealRules || a.forbidsWin || a.seals);
  });
}

function behind(g: Game, seat: number): number {
  const top = Math.max(...g.players.filter((p) => p.seat !== seat).map((p) => p.score));
  return top - g.players[seat].score;
}

// 电脑发牌前选哪一种（不选是 null）
function aiPreDeal(g: Game, seat: number): RokuyouId | null {
  const pinch = g.isLastRounds(2) || behind(g, seat) >= TOYONE.behind;
  if (pinch && strongControl(g, seat)) {
    if (toyoneCanUse(g, seat, 'butsumetsu')) return 'butsumetsu';
    if (toyoneCanUse(g, seat, 'taian')) return 'taian';
  }
  if (seat === g.dealer && g.rng.chance(TOYONE.dealerSensho)) return 'sensho';
  return null;
}

// 友引：四副露听单骑
const tomobikiReady = (g: Game, seat: number) => g.players[seat].melds.length === 4 && g.waits(seat).length > 0;

export const toyoneAbility: Ability = {
  id: 'toyone',
  name: '六曜',
  description:
    '六种技能，每一局只有一种起作用。先负（被动）：保持默听，有人立直后加速，追立后先立直的人摸到她的铳牌。先胜：前 10 巡进张快，之后变慢、容易摸到别人的铳牌。赤口：看得见赤宝牌，有赤宝牌的进张 ±30%。友引（被动）：四副露单骑，下一巡必定自摸。大安（一场一次）：别人的能力影响不到她的摸牌。佛灭（一场一次）：这一局控场的能力全部无效。',
  priority: PRIORITY.toyone,

  // 这一局开哪一种：玩家在发牌前选好了，电脑在这里自己决定（不定配牌的规矩）
  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const want = g.manual[seat] ? (gs.want ?? null) : aiPreDeal(g, seat);
    gs.want = null;
    if (want && toyoneCanUse(g, seat, want)) start(g, seat, want);
  },

  // 先负追立以后：比她先立直的人摸到的都是她的铳牌（定成规矩，后动的人也不能换走）
  beforeAnyDraw(g, seat, drawer) {
    const st = stateOf(g, seat);
    if (drawer === seat) return;
    if (st.mode === 'senbu' && st.chase?.includes(drawer) && g.players[seat].riichi && g.canWin(seat) && !g.isFuriten(seat)) {
      const mine = g.waits(seat);
      // 尽量别是那家自己的和了牌
      const theirs = g.waits(drawer);
      const pick = mine.filter((k) => !theirs.includes(k));
      const ok = new Set(pick.length ? pick : mine);
      if (ok.size) return { seat, ability: 'toyone', text: '先负', deny: (t: TileId) => !ok.has(kindOf(t)) };
    }
    // 赤口：别人手里有赤宝牌，那家进张变慢
    if (st.mode === 'shakku' && g.players[drawer].hand.some(isRed) && g.rng.chance(TOYONE.shakku)) {
      const good = useful(g, drawer);
      return { seat, ability: 'toyone', text: '赤口', deny: good };
    }
  },

  beforeDraw(g, seat, rinshan) {
    const st = stateOf(g, seat);
    const p = g.players[seat];
    // 被动的两种：这一局还没有别的技能起作用时自己发动
    if (!st.mode && !p.riichi && g.players.some((q) => q.seat !== seat && q.riichi && g.seesRiichi(q.seat, seat))) start(g, seat, 'senbu');
    if (!st.mode && tomobikiReady(g, seat)) start(g, seat, 'tomobiki', false);
    // 电脑：手里有赤宝牌就开赤口
    if (!st.mode && !g.manual[seat] && p.hand.some(isRed)) start(g, seat, 'shakku');

    const w = g.wall;
    switch (st.mode) {
      case 'senbu':
        if (!p.riichi && g.rng.chance(TOYONE.senbuDraw)) speedUp(g, seat, rinshan);
        break;
      case 'sensho': {
        const turn = p.discards.length + 1;
        if (turn <= TOYONE.senshoTurns) {
          if (g.rng.chance(TOYONE.senshoDraw)) speedUp(g, seat, rinshan);
          break;
        }
        if (rinshan) break;
        const deal = othersRon(g, seat);
        if (deal.size && g.rng.chance(TOYONE.senshoDeal)) {
          if (!deal.has(kindOf(w.live[0]))) w.bringToLive(0, (t) => deal.has(kindOf(t)), g.rng);
        } else if (g.rng.chance(TOYONE.senshoSlow)) {
          const good = useful(g, seat);
          if (good(w.live[0])) w.bringToLive(0, (t) => !good(t), g.rng);
        }
        break;
      }
      case 'shakku':
        if (p.hand.some(isRed) && g.rng.chance(TOYONE.shakku)) speedUp(g, seat, rinshan);
        break;
      case 'tomobiki': {
        if (!tomobikiReady(g, seat) || !g.canWin(seat)) break;
        const waits = g.waits(seat);
        // 有役的和了牌：先放进手里试一下
        const wins = (t: TileId) => {
          if (!waits.includes(kindOf(t))) return false;
          p.hand.push(t);
          const ok = !!g.winResult(seat, t, true);
          p.hand.pop();
          return ok;
        };
        const ok = rinshan ? wins(w.rinshan[0]) || w.bringToRinshan(wins, g.rng) : wins(w.live[0]) || w.bringToLive(0, wins, g.rng);
        if (ok) g.emit({ type: 'ability', seat, ability: 'toyone', text: '友引' });
        break;
      }
    }
  },

  // 先负：追立的时候记下已经立直的人
  afterDiscard(g, seat) {
    const st = stateOf(g, seat);
    if (st.mode !== 'senbu' || !g.players[seat].riichiPending || st.chase) return;
    st.chase = g.players.filter((q) => q.seat !== seat && q.riichi && g.seesRiichi(q.seat, seat)).map((q) => q.seat);
    g.emit({ type: 'ability', seat, ability: 'toyone', text: '追立' });
  },

  // 大安：别人的影响全挡掉（玄的宝牌照样算）
  resist(g, seat) {
    return stateOf(g, seat).mode === 'taian' ? 1 : 0;
  },

  nullifies(g, seat) {
    return g.phase !== 'predeal' && stateOf(g, seat).mode === 'butsumetsu';
  },

  preDeal(g, seat) {
    const used = gameStateOf(g, seat).used ?? [];
    return ROKUYOU.filter((r) => r.active).map(
      (r): PreDealOption => ({
        id: r.id,
        name: r.name,
        desc: r.desc,
        enabled: !(r.once && used.includes(r.id)),
        picked: false,
        group: 'rokuyou',
        note: r.once ? (used.includes(r.id) ? '用过了' : '一场一次') : '这一局里也可以按',
      }),
    );
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).want = (picked[0] as RokuyouId | undefined) ?? null;
  },

  skill(g, seat) {
    const mode = stateOf(g, seat).mode;
    const used = gameStateOf(g, seat).used ?? [];
    const left = (['taian', 'butsumetsu'] as RokuyouId[]).filter((id) => !used.includes(id)).map(nameOf);
    const tail = left.length ? `（${left.join('、')}还能用）` : '（大安、佛灭用过了）';
    if (mode) {
      const spots = mode === 'shakku' ? '。赤宝牌：' + toyoneRedSpots(g, seat).map((s) => s.where).join('、') : '';
      const chase = mode === 'senbu' ? (stateOf(g, seat).chase ? '：追立了，先立直的人会摸到你的铳牌' : '：手牌加速中，听牌后立直追上去') : '';
      return { label: '', note: `这一局：${nameOf(mode)}${chase}${spots}${tail}`, enabled: false, active: true };
    }
    const playing = g.phase === 'turn' || g.phase === 'calls';
    const choices = ROKUYOU.filter((r) => r.active).map((r) => ({ id: r.id, label: r.name, enabled: playing && toyoneCanUse(g, seat, r.id) }));
    return { label: '六曜', note: `这一局还没有技能起作用：有人立直会发动先负，四副露单骑会发动友引${tail}`, enabled: playing, choices };
  },

  pressSkill(g, seat, choice) {
    const id = choice as RokuyouId;
    if (!ROKUYOU.some((r) => r.id === id) || !toyoneCanUse(g, seat, id)) return;
    if (g.phase !== 'turn' && g.phase !== 'calls') return;
    start(g, seat, id);
  },

  badge(g, seat) {
    const mode = stateOf(g, seat).mode;
    return mode ? nameOf(mode) : null;
  },

  insight(g, seat) {
    const mode = stateOf(g, seat).mode;
    const used = gameStateOf(g, seat).used ?? [];
    return [mode ? `这一局：${nameOf(mode)}` : '这一局还没有六曜起作用', used.length ? `用过：${used.map(nameOf).join('、')}` : '大安、佛灭都还在'];
  },
};

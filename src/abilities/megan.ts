import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { kindOf, toCounts, type TileId } from '../engine/tiles';
import { luckyDraw } from './luck';
import { PRIORITY, type Ability, type DrawRule } from './types';

// 梅根·达文（临海女子，副将）：决斗。
// 感知（被动）：只在她自己听牌时起作用，看得出另外三家谁听牌了（不知道听什么）。隐身的桃子、默听的智叶感知不到。
// 决斗：她听牌、感知到的听牌对手正好一家时可以向那一家决斗（一局一次）。这时立直就是决斗（原作她决斗时立直抬高点数）；
//   立直不了（鸣过牌）、已经立直了的也能决斗：玩家按技能栏的「决斗」，电脑打完牌自己拔枪。决斗持续对方的三次摸牌：
//   · 对方摸不到自己的和了牌；
//   · 对方这三次摸牌分别有 30% / 50% / 90% 换成她的和了牌（对方立直了只能打出去；没立直的可以扣住、拆听）；
//   · 她自己这几巡摸不到对方的和了牌（原作：决斗里她几乎不会放给对手）；
//   · 对方拆了听牌，决斗就结束；她自己拆了听牌也结束。三步走完没人和，决斗结束，立直了的照常是立直状态。
//   别人的能力管不到的人（照、押 3 点的涅莉）不能当决斗对象。她只盯着一个人：第三家悄悄听牌照样能和她。
// 伏牌（一场两次，她这一局第一次出牌之前按）：把牌伏下、低头摸牌。没听牌时进张更顺，听牌后更容易自摸；
//   做出确定的役（不靠立直、不靠自摸，听的每一张都成立）之前不能荣和、不能鸣牌；做出来就抬牌，加成也结束。
//   伏牌的局不决斗；伏着立直加成立刻结束。
// 决斗换牌走控场能力的摸牌规矩（beforeAnyDraw 返回 DrawRule），所以佛灭、高维领域、深山、天使和照样挡得住。
export const MEGAN = {
  // 决斗持续对方几次摸牌
  duelSteps: 3,
  // 对方第 1、2、3 次摸牌换成她和了牌的概率
  duel: [0.3, 0.5, 0.9],
  // 一场比赛能伏牌几次
  blinds: 2,
  // 伏牌：没听牌时每次摸牌换成有效进张的概率
  blindDraw: 0.55,
  // 伏牌：听牌后每次摸牌换成和了牌的概率
  blindWin: 0.25,
};

// 摸牌规矩发的能力事件：子弹是把对方的摸牌换成她的和了牌，对峙是换走对方自己的和了牌（界面上都不出字）
export const MEGAN_BULLET = '子弹';
export const MEGAN_STAND = '对峙';

interface MeganGameState {
  blindUsed?: number;
}
interface MeganState {
  // 正在决斗：对谁、对方还要摸几次
  duel?: { target: number; left: number };
  // 这一局决斗过了（结果：hit 打中、escape 对方拆听逃了、over 三步走完）
  duelEnd?: 'hit' | 'escape' | 'over';
  duelTarget?: number;
  blind?: boolean;
  lifted?: boolean;
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as MeganGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as MeganState;
const isMegan = (g: Game, seat: number) => g.abilities[seat]?.id === 'megan';

const tenpai = (g: Game, seat: number) => {
  const p = g.players[seat];
  return shanten(toCounts(p.hand), p.melds.length) <= 0;
};

// 她听着牌时感知到的听牌对手（能力不起作用、她没听牌时是空的）
export function meganSenses(g: Game, seat: number): number[] {
  if (g.active(seat)?.id !== 'megan' || !tenpai(g, seat)) return [];
  return [0, 1, 2, 3].filter((o) => o !== seat && !g.stealthed(o, seat) && !g.tenpaiHidden(o, seat) && tenpai(g, o));
}

export const meganBlindsLeft = (g: Game, seat: number): number => MEGAN.blinds - (gameStateOf(g, seat).blindUsed ?? 0);

// 这一局伏着牌（还没抬）
export function meganBlind(g: Game, seat: number): boolean {
  if (!isMegan(g, seat)) return false;
  const st = stateOf(g, seat);
  return !!st.blind && !st.lifted;
}

// 这一局伏过牌（抬了也算）：这一局不决斗
export const meganBlindRound = (g: Game, seat: number): boolean => isMegan(g, seat) && !!stateOf(g, seat).blind;

// 正在进行的决斗
export function meganDuel(g: Game, seat: number): { target: number; left: number } | null {
  if (g.active(seat)?.id !== 'megan') return null;
  return stateOf(g, seat).duel ?? null;
}

// 这一局决斗的结果（界面：打中时的枪响）
export function meganDuelEnd(g: Game, seat: number): { target: number; end: 'hit' | 'escape' | 'over' } | null {
  if (!isMegan(g, seat)) return null;
  const st = stateOf(g, seat);
  return st.duelEnd && st.duelTarget !== undefined ? { target: st.duelTarget, end: st.duelEnd } : null;
}

// 正在跟哪位梅根决斗（界面：头像上的准星）
export function duelledBy(g: Game, target: number): number | null {
  for (let s = 0; s < 4; s++) if (s !== target && meganDuel(g, s)?.target === target) return s;
  return null;
}

// 现在立直的话向谁决斗：感知到的听牌对手正好一家、管得到他、这一局没伏牌也没决斗过。没有是 null
export function meganDuelTarget(g: Game, seat: number): number | null {
  if (g.active(seat)?.id !== 'megan') return null;
  const st = stateOf(g, seat);
  if (st.blind || st.duel || st.duelEnd) return null;
  const sensed = meganSenses(g, seat);
  return sensed.length === 1 && g.binds(seat, sensed[0]) ? sensed[0] : null;
}

// 向感知到的那一家决斗。成功返回 true
export function meganStartDuel(g: Game, seat: number): boolean {
  const target = meganDuelTarget(g, seat);
  if (target === null) return false;
  stateOf(g, seat).duel = { target, left: MEGAN.duelSteps };
  g.emit({ type: 'ability', seat, ability: 'megan', text: '决斗', target });
  return true;
}

// 确定的役：听着牌、没立直，听的每一张荣和都成立（不靠立直、不靠自摸；振听不算）
export function meganCertainYaku(g: Game, seat: number): boolean {
  const p = g.players[seat];
  if (p.riichi || p.riichiPending) return false;
  const waits = g.waits(seat);
  return waits.length > 0 && waits.every((k) => !!g.winResult(seat, ((k << 2) + 3) as TileId, false, false));
}

// 现在能不能伏牌：还有次数、这一局还没出过牌也没鸣过、没被封印
export function meganCanBlind(g: Game, seat: number): boolean {
  if (g.active(seat)?.id !== 'megan' || (g.phase !== 'turn' && g.phase !== 'calls')) return false;
  const p = g.players[seat];
  const st = stateOf(g, seat);
  return !st.blind && meganBlindsLeft(g, seat) > 0 && p.discards.length === 0 && p.melds.length === 0 && !p.riichi && !p.riichiPending;
}

function startBlind(g: Game, seat: number): boolean {
  if (!meganCanBlind(g, seat)) return false;
  const gs = gameStateOf(g, seat);
  gs.blindUsed = (gs.blindUsed ?? 0) + 1;
  stateOf(g, seat).blind = true;
  g.emit({ type: 'ability', seat, ability: 'megan', text: '伏牌' });
  lift(g, seat);
  return true;
}

// 做出确定的役（或者立直了）：抬牌，之后照常打，加成结束
function lift(g: Game, seat: number): void {
  const st = stateOf(g, seat);
  if (!st.blind || st.lifted) return;
  const p = g.players[seat];
  const riichi = p.riichi || p.riichiPending;
  if (!riichi && !meganCertainYaku(g, seat)) return;
  st.lifted = true;
  g.emit({ type: 'ability', seat, ability: 'megan', text: '抬牌' });
}

function endDuel(g: Game, seat: number, end: 'hit' | 'escape' | 'over'): void {
  const st = stateOf(g, seat);
  if (!st.duel) return;
  st.duelTarget = st.duel.target;
  st.duel = undefined;
  st.duelEnd = end;
  if (end === 'escape') g.emit({ type: 'ability', seat, ability: 'megan', text: '逃脱', target: st.duelTarget });
  if (end === 'over') g.emit({ type: 'ability', seat, ability: 'megan', text: '决斗结束', target: st.duelTarget });
}

// 电脑：自己坐庄的局，或者落后时的最后两局伏牌
function aiBlinds(g: Game, seat: number): boolean {
  if (seat === g.dealer) return true;
  const top = Math.max(...g.players.map((p) => p.score));
  return g.isLastRounds(2) && g.players[seat].score < top;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const meganAbility: Ability = {
  id: 'megan',
  name: '决斗',
  description: `感知：自己听牌时看得出谁听牌了。决斗（一局一次）：只有一家听牌时可以向那一家决斗（这时立直就是决斗），持续对方 ${MEGAN.duelSteps} 次摸牌：对方摸不到自己的和了牌，有 ${MEGAN.duel.map(pct).join('、')} 摸到她的；拆听能逃。伏牌（一场 ${MEGAN.blinds} 次，第一次出牌前）：进张 +${pct(MEGAN.blindDraw)}，听牌后自摸 +${pct(MEGAN.blindWin)}；有确定的役之前不能荣和、鸣牌，这一局不决斗。`,
  priority: PRIORITY.megan,

  // 电脑：配完牌决定这一局伏不伏
  afterDeal(g, seat) {
    if (!g.manual[seat] && meganBlindsLeft(g, seat) > 0 && aiBlinds(g, seat)) {
      const gs = gameStateOf(g, seat);
      gs.blindUsed = (gs.blindUsed ?? 0) + 1;
      stateOf(g, seat).blind = true;
      g.emit({ type: 'ability', seat, ability: 'megan', text: '伏牌' });
      lift(g, seat);
    }
  },

  beforeAnyDraw(g, seat, drawer, rinshan): DrawRule | void {
    const st = stateOf(g, seat);
    const duel = st.duel;
    if (!duel) return;
    // 对方三次摸牌都打完了，没人和：决斗结束
    if (duel.left <= 0) {
      endDuel(g, seat, 'over');
      return;
    }
    // 对方拆了听牌：逃掉了
    const theirs = g.waits(duel.target);
    if (!tenpai(g, duel.target)) {
      endDuel(g, seat, 'escape');
      return;
    }
    // 她自己拆了听牌：决斗不成立了
    if (!tenpai(g, seat)) {
      endDuel(g, seat, 'over');
      return;
    }
    if (drawer === seat) {
      // 她自己这几巡摸不到对方的和了牌（自己也听的那张照摸）
      const mine = g.waits(seat);
      return { seat, ability: 'megan', text: MEGAN_STAND, deny: (t) => theirs.includes(kindOf(t)) && !mine.includes(kindOf(t)) };
    }
    if (drawer !== duel.target) return;
    const stand: DrawRule = { seat, ability: 'megan', text: MEGAN_STAND, deny: (t) => theirs.includes(kindOf(t)) };
    if (rinshan) return stand;
    const step = MEGAN.duelSteps - duel.left;
    duel.left--;
    const w = g.wall;
    // 子弹：她的和了牌里对方和不了的那些。这一次中不中先掷好；牌山里拿得出来才换（先动的人定的规矩照样守）
    const mine = g.waits(seat);
    const bullet = (t: TileId) => mine.includes(kindOf(t)) && !theirs.includes(kindOf(t));
    const fire = g.rng.chance(MEGAN.duel[Math.min(step, MEGAN.duel.length - 1)]);
    const earlier = w.deny;
    if (!fire || w.locked.has(w.live[0])) return stand;
    const inLive = w.live.some((t, i) => bullet(t) && !earlier?.(t) && (i === 0 || !w.locked.has(t)));
    // 牌山里已经没有她的和了牌：从还没翻开的王牌里拿一张上膛
    const loaded = inLive || w.bringDeadToLive(0, bullet, g.rng);
    return loaded ? { seat, ability: 'megan', text: MEGAN_BULLET, deny: (t) => !bullet(t) } : stand;
  },

  beforeDraw(g, seat, rinshan) {
    if (!meganBlind(g, seat)) return;
    luckyDraw(g, seat, rinshan, tenpai(g, seat) ? MEGAN.blindWin : MEGAN.blindDraw);
  },

  afterDiscard(g, seat, tile) {
    void tile;
    const p = g.players[seat];
    lift(g, seat);
    // 立直宣言的这一张：感知到的听牌对手正好一家，就是向他决斗。
    // 电脑：没立直（鸣过牌、立直不了）、早就立直了的，打完这一张看到正好一家听牌也拔枪
    if (p.riichiPending || !g.manual[seat]) meganStartDuel(g, seat);
  },

  // 她自己暗杠以后也看一下能不能抬牌
  onCall(g, seat) {
    lift(g, seat);
  },

  onRoundEnd(g, seat, result) {
    const st = stateOf(g, seat);
    if (!st.duel) return;
    const target = st.duel.target;
    const hit = result.kind === 'win' && result.wins.some((w) => w.seat === seat && w.from === target);
    if (hit) endDuel(g, seat, 'hit');
  },

  // 伏着牌：不能荣和（自摸照常）
  canWin(g, seat, win) {
    return !(win && !win.tsumo && meganBlind(g, seat));
  },

  // 伏着牌：自己鸣不了牌
  freezesCalls(g, seat, caller) {
    return caller === seat && meganBlind(g, seat);
  },

  powered(g, seat) {
    return meganBlind(g, seat) || !!stateOf(g, seat).duel;
  },

  badge(g, seat) {
    const st = stateOf(g, seat);
    if (st.duel) return '决斗';
    if (st.blind && !st.lifted) return '伏牌';
    return null;
  },

  skill(g, seat) {
    const st = stateOf(g, seat);
    const left = meganBlindsLeft(g, seat);
    const meter = { value: left, max: MEGAN.blinds, label: '伏牌' };
    if (st.duel) {
      return { label: '决斗中', note: `和${g.players[st.duel.target].name}决斗：对方还要摸 ${st.duel.left} 次牌`, enabled: false, active: true, meter };
    }
    if (st.blind && !st.lifted) {
      return { label: '伏牌中', note: '伏着牌：进张更顺。做出确定的役之前不能荣和、鸣牌，做出来自动抬牌', enabled: false, active: true, meter };
    }
    if (st.blind) return { label: '已抬牌', note: '役做出来了，照常打（这一局不决斗）', enabled: false, meter };
    const can = meganCanBlind(g, seat);
    const sensed = meganSenses(g, seat);
    const target = meganDuelTarget(g, seat);
    const note =
      target !== null
        ? `${g.players[target].name}听牌了：可以向她决斗（现在立直也是决斗）`
        : st.duelEnd
          ? '这一局决斗过了'
          : sensed.length > 1
            ? `${sensed.length} 家听牌：决斗不了（只能一对一）`
            : can
              ? `还能伏 ${left} 次：这一局第一次出牌之前按`
              : left > 0
                ? `还能伏 ${left} 次（每局第一次出牌之前才能按）`
                : '伏牌用完了';
    const choices = [
      { id: 'duel', label: target !== null ? `决斗 → ${g.players[target].name}` : '决斗', enabled: target !== null },
      { id: 'blind', label: '伏牌', enabled: can },
    ];
    return { label: '', note, enabled: can || target !== null, meter, choices };
  },

  pressSkill(g, seat, choice) {
    if (choice === 'duel') meganStartDuel(g, seat);
    else if (choice === 'blind') startBlind(g, seat);
  },

  insight(g, seat) {
    const st = stateOf(g, seat);
    const out = [`伏牌还剩 ${meganBlindsLeft(g, seat)} 次`];
    if (st.duel) out.push(`正在和${g.players[st.duel.target].name}决斗，对方还要摸 ${st.duel.left} 次牌`);
    else if (st.blind && !st.lifted) out.push('这一局伏着牌：没做出确定的役之前不能荣和、鸣牌');
    else out.push('她听牌时看得出谁听牌；正好一家听牌时立直就是决斗');
    return out;
  },
};

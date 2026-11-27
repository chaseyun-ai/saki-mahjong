import type { Game } from '../engine/game';
import { type Kind, type TileId, kindOf } from '../engine/tiles';
import type { Ability } from './types';

// 福路美穗子（风越）：平时闭着右眼稳稳地打。一个半庄只能睁一次右眼，牌局中任何时候都可以睁，睁开以后维持三局（连庄不算）：
// 看不到别人的牌，但看得出每个人的理牌习惯：别人手牌的牌背按花色上色（万红、筒蓝、索绿、字牌白），
// 每家手里各种花色有几张一目了然（不动牌山）。睁眼时画面罩一层蓝色，头像框换成能力发动头像（和天使和一样，form）。
// - 三局按「东 1 局、东 2 局……」数：睁眼的那一局算第一局，连庄（本场）、流局重打的那几把不算，到第三局打完才闭上
// - 电脑的美穗子：留到最后三局一开局就睁；之前有人立直、她又落后时提前睁。睁眼后，立直的人手里没有的花色是现物一样安全的牌
export const MIHOKO = {
  hands: 3, // 睁开以后维持几局（连庄不算）
  times: 1, // 一个半庄能睁几次
};

interface MihokoGameState {
  used?: number; // 这一场睁过几次
  openAt?: number; // 最近一次睁眼的那一局是第几局（slotOf：东 1 局是 0，连庄不加）
}

// 第几局：东 1 局 0、东 2 局 1……南 1 局 4。连庄、流局重打的本场不加（发牌前已经是要开的那一局）
const slotOf = (g: Game) => g.roundWind * 4 + g.roundNumber;

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as MihokoGameState;

// 这一场还能睁几次
export function mihokoTimesLeft(g: Game, seat: number): number {
  return Math.max(0, MIHOKO.times - (gameStateOf(g, seat).used ?? 0));
}

// 右眼还睁着的话，算上这一局还剩几局（连庄不算）；闭着是 0
export function mihokoEyeLeft(g: Game, seat: number): number {
  const at = gameStateOf(g, seat).openAt;
  if (at === undefined) return 0;
  return Math.max(0, MIHOKO.hands - (slotOf(g) - at));
}

// 右眼睁着没有
export function mihokoEyeOpen(g: Game, seat: number): boolean {
  return mihokoEyeLeft(g, seat) > 0;
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

const canOpen = (g: Game, seat: number) => !mihokoEyeOpen(g, seat) && mihokoTimesLeft(g, seat) > 0 && (g.phase === 'turn' || g.phase === 'calls');

function open(g: Game, seat: number): void {
  const gs = gameStateOf(g, seat);
  gs.used = (gs.used ?? 0) + 1;
  gs.openAt = slotOf(g);
  g.emit({ type: 'ability', seat, ability: 'mihoko', text: '睁开右眼' });
}

const isBehind = (g: Game, seat: number) => g.players.some((p) => p.seat !== seat && p.score > g.players[seat].score);

// 睁眼的那几局：素材页的「睁开右眼」动画 id。头像框换成能力发动头像，和牌放 eye-win 的动画（Ability.form）
export const MIHOKO_FORM = 'eye';

// 还剩几局的说法：算上这一局还剩 n 局，最后一局另说
const leftText = (n: number) => (n === 1 ? '这是最后一局' : `算上这一局还剩 ${n} 局`);

export const mihokoAbility: Ability = {
  id: 'mihoko',
  name: '右眼',
  description: `平时闭着右眼稳稳地打。一个半庄只能睁一次右眼，牌局中任何时候都可以睁，睁开以后维持 ${MIHOKO.hands} 局（睁眼的那一局算第一局，连庄不算）：看不到别人的牌，但看得出理牌习惯，别人手牌的牌背按花色上色（万红、筒蓝、索绿、字牌白）。`,

  // 电脑的美穗子：留到最后三局，一开局就睁；之前有人立直、她又落后的话提前睁
  beforeAnyDraw(g, seat) {
    if (g.manual[seat] || !canOpen(g, seat)) return;
    const riichi = g.players.some((p) => p.seat !== seat && g.seesRiichi(p.seat, seat));
    const start = g.players[seat].discards.length === 0 && g.isLastRounds(MIHOKO.hands);
    if (start || (riichi && isBehind(g, seat))) open(g, seat);
  },

  form(g, seat) {
    return mihokoEyeOpen(g, seat) ? MIHOKO_FORM : null;
  },

  skill(g, seat) {
    const left = mihokoEyeLeft(g, seat);
    const note = left
      ? `右眼睁开：别人的牌背按花色上色，${leftText(left)}（连庄不算）`
      : mihokoTimesLeft(g, seat) > 0
        ? `一场只能睁一次：睁开以后维持 ${MIHOKO.hands} 局（连庄不算），看出每家各花色有几张`
        : '这一场已经睁过了';
    return { label: left ? `右眼睁开中 · ${left}` : '睁开右眼', note, enabled: canOpen(g, seat), active: left > 0 };
  },

  pressSkill(g, seat) {
    if (canOpen(g, seat)) open(g, seat);
  },

  badge(g, seat) {
    const left = mihokoEyeLeft(g, seat);
    return left ? `右眼${left}` : null;
  },

  insight(g, seat) {
    const left = mihokoEyeLeft(g, seat);
    if (left) return [`右眼睁开，看得出每家各花色有几张；${leftText(left)}（连庄不算）`];
    return [mihokoTimesLeft(g, seat) > 0 ? '右眼闭着，这一场还能睁一次' : '右眼闭着，这一场已经睁过了'];
  },
};

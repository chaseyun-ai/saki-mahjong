import type { Game } from '../engine/game';
import { isDragon, kindOf, suitOf, toCounts } from '../engine/tiles';
import { shanten } from '../engine/shanten';
import { isDoraTile } from './kuro';
import type { Ability, BindKey } from './types';

// 白水哩（新道寺）：
// - 被动：别人对她配牌、摸牌的影响减半（Ability.resist，和天使和一样；absolute 的玄照样管得到她）
// - 番缚：每一局她第一次出牌的时候，可以给自己缚上 1–7 番。这一局和出的番数（宝牌、赤宝牌、里宝牌都算）不少于番缚数，
//   得到一把钥匙（多出来的一发、里宝牌不会把钥匙弄丢）；没和成（别人和了、流局），得到一把破碎的钥匙；和了但番数不够，什么也没有。
//   钥匙记着是哪一局（东/南场几局几本场）。鹤田姬子在钥匙记的那一局能和出两倍番缚的牌（见 himeko.ts）。
//   缚没缚只有她自己知道：不出字、不放切入，头像框上也不显示；只有宫永照的照魔镜看得穿（Ability.insight）
// aiBindShanten：电脑的哩只在第一次出牌前手牌不差于几向听时才番缚（烂牌缚了也和不了，只会给姬子一把破碎的钥匙）
export const RII = { resist: 0.5, maxBind: 7, aiBindShanten: 2 };

interface RiiState {
  bind?: number; // 这一局缚了几番
}
interface RiiGameState {
  keys?: BindKey[];
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as RiiState;
const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as RiiGameState;

// 这一场拿到的钥匙（包括破碎的），按局的先后
export function riiKeys(g: Game, seat: number): BindKey[] {
  return gameStateOf(g, seat).keys ?? [];
}

// 这一局缚了几番，没缚是 null
export function riiBind(g: Game, seat: number): number | null {
  return stateOf(g, seat).bind ?? null;
}

// 现在能不能番缚：这一局还没缚、轮到她第一次出牌
export function riiCanBind(g: Game, seat: number): boolean {
  return !!g.active(seat) && stateOf(g, seat).bind === undefined && g.phase === 'turn' && g.turn === seat && g.players[seat].discards.length === 0;
}

// 电脑的哩缚几番：按手里看得到的番估一个（立直算一番，宝牌、成对的役牌、偏一门花色往上加）
export function riiGuess(g: Game, seat: number): number {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  let han = 1;
  han += p.hand.filter((t) => isDoraTile(g, t)).length;
  for (let k = 27; k < 34; k++) if (counts[k] >= 2 && (isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind)) han++;
  const per = [0, 0, 0];
  for (const t of p.hand) if (kindOf(t) < 27) per[suitOf(kindOf(t))]++;
  const honors = counts.slice(27).reduce((a, b) => a + b, 0);
  if (Math.max(...per) + honors >= 11) han += 2;
  return Math.max(1, Math.min(RII.maxBind, han));
}

export const riiAbility: Ability = {
  id: 'rii',
  name: '番缚',
  description: `被动：别人对她配牌、摸牌的影响减半。番缚：每一局第一次出牌时可以给自己缚上 1–${RII.maxBind} 番，和出的番数不少于番缚数就得到一把钥匙，没和成得到一把破碎的钥匙，番数不够什么也没有。钥匙记着是哪一局，鹤田姬子在那一局能和出两倍番缚的牌。缚没缚只有宫永照看得穿。`,

  resist() {
    return RII.resist;
  },

  // 电脑的哩：第一次出牌前手牌够好才缚上估出来的番数。烂牌也缚的话大多数局和不了，
  // 每一局都会拿到破碎的钥匙，同桌的姬子就几乎一直是破碎的钥匙
  afterDraw(g, seat) {
    if (g.manual[seat] || !riiCanBind(g, seat)) return;
    const p = g.players[seat];
    if (shanten(toCounts(p.hand), p.melds.length) > RII.aiBindShanten) return;
    stateOf(g, seat).bind = riiGuess(g, seat);
  },

  onRoundEnd(g, seat, result) {
    const bind = stateOf(g, seat).bind;
    if (bind === undefined) return;
    const win = result.wins.find((w) => w.seat === seat);
    if (win && win.result.han < bind) return;
    const gs = gameStateOf(g, seat);
    gs.keys = [...(gs.keys ?? []), { label: g.roundLabel(), round: g.round, bind, broken: !win }];
    g.emit({ type: 'ability', seat, ability: 'rii', text: win ? '钥匙' : '破碎的钥匙' });
  },

  // 头像框上只显示钥匙（结算以后大家都看得到），不显示这一局缚没缚
  badge(g, seat) {
    const keys = riiKeys(g, seat);
    const whole = keys.filter((k) => !k.broken).length;
    const broken = keys.length - whole;
    if (!keys.length) return null;
    return [whole ? `钥匙×${whole}` : '', broken ? `碎×${broken}` : ''].filter(Boolean).join(' ');
  },

  skill(g, seat) {
    const bind = riiBind(g, seat);
    const keys = riiKeys(g, seat);
    const list = keys.length ? `钥匙：${keys.map((k) => `${k.label}${k.broken ? '（碎）' : ''}缚${k.bind}`).join('、')}` : '还没有钥匙';
    if (bind !== null) return { label: '番缚', note: `这一局缚了 ${bind} 番，和出 ${bind} 番以上得到钥匙。${list}`, enabled: false, active: true };
    const ready = riiCanBind(g, seat);
    const choices = Array.from({ length: RII.maxBind }, (_, i) => ({ id: String(i + 1), label: `${i + 1}番`, enabled: ready }));
    const waiting = !ready && g.players[seat].discards.length === 0;
    const note = ready ? `第一次出牌前可以缚上几番（只有照看得穿）。${list}` : waiting ? `轮到自己第一次出牌时可以缚上几番。${list}` : `这一局没缚，第一次出牌前才能缚。${list}`;
    return { label: '番缚', note, enabled: ready, choices };
  },

  pressSkill(g, seat, choice) {
    const n = Number(choice);
    if (!riiCanBind(g, seat) || !Number.isInteger(n) || n < 1 || n > RII.maxBind) return;
    stateOf(g, seat).bind = n;
  },

  // 只有照魔镜看得到这一局缚没缚
  insight(g, seat) {
    const bind = riiBind(g, seat);
    const keys = riiKeys(g, seat);
    return [bind !== null ? `这一局番缚 ${bind} 番` : '这一局没有番缚', `钥匙 ${keys.filter((k) => !k.broken).length} 把，破碎的 ${keys.filter((k) => k.broken).length} 把`];
  },
};

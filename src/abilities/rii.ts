import type { Game } from '../engine/game';
import { EAST, isDragon, kindOf, suitOf, toCounts, type TileId } from '../engine/tiles';
import { evaluateWin } from '../engine/score';
import { shanten } from '../engine/shanten';
import { isDoraTile } from './kuro';
import type { Ability, BindKey } from './types';

// 白水哩（新道寺）：
// - 被动：别人对她配牌、摸牌的影响减半（Ability.resist，和天使和一样；absolute 的玄照样管得到她）
// - 番缚：每一局她第一次出牌的时候，可以给自己缚上 1–7 番。这一局和出的番数（宝牌、赤宝牌、里宝牌都算）不少于番缚数，
//   得到一把钥匙（多出来的一发、里宝牌不会把钥匙弄丢）；没和成（别人和了、流局），得到一把破碎的钥匙；和了但番数不够，什么也没有。
//   钥匙记着是哪一局（东/南场几局几本场）。鹤田姬子在钥匙记的那一局能和出两倍番缚的牌（见 himeko.ts）。
//   缚没缚只有她自己知道：不出字、不放切入，头像框上也不显示；只有宫永照的照魔镜看得穿（Ability.insight）
// - 缚上以后牌往缚的番数上靠（原作里她缚了大多做得成）：没听牌时，下一张不进张就有 help 的概率换成进张；
//   听牌以后，有同样的概率换成自摸就够番缚数的和了牌（不算里宝牌）。缚得越多越难，help 按番缚数取
// aiBindShanten：电脑的哩只在第一次出牌前手牌不差于几向听时才番缚（烂牌缚了也和不了，只会给姬子一把破碎的钥匙）
// aiMinBind：电脑最少缚几番（原作的钥匙是满贯、跳满、倍满、役满，没有缚 1 番换姬子 2 番小牌的）。玩家自己可以缚 1 番
// holdUntil：电脑的哩缚上以后，番数不够的和了先不和，牌山剩这么多张以下才和（总比破碎的钥匙好）
export const RII = {
  resist: 0.5,
  maxBind: 7,
  aiBindShanten: 2,
  aiMinBind: 2,
  help: [0, 0.5, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25],
  holdUntil: 12,
};

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

const YAOCHU = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

// 电脑的哩缚几番：按手里看得到的番估一个。缚上以后门清做，听牌会立直（1 番）、牌往缚的番数上靠多半自摸（1 番）；
// 宝牌、赤宝牌、成对的役牌、断幺九的样子（幺九牌最多一张）、偏一门花色往上加；还差两向听以上少估一番留余量
export function riiGuess(g: Game, seat: number): number {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  let han = 2;
  han += p.hand.filter((t) => isDoraTile(g, t)).length;
  for (let k = 27; k < 34; k++) if (counts[k] >= 2 && (isDragon(k) || k === g.seatWind(seat) || k === 27 + g.roundWind)) han++;
  if (YAOCHU.reduce((a, k) => a + counts[k], 0) <= 1) han++;
  const per = [0, 0, 0];
  for (const t of p.hand) if (kindOf(t) < 27) per[suitOf(kindOf(t))]++;
  const honors = counts.slice(27).reduce((a, b) => a + b, 0);
  if (Math.max(...per) + honors >= 11) han += 2;
  if (shanten(counts, p.melds.length) >= 2) han--;
  return Math.max(RII.aiMinBind, Math.min(RII.maxBind, han));
}

// 缚 bind 番时摸牌往番数上靠的概率
export function riiHelp(bind: number): number {
  return RII.help[Math.min(bind, RII.help.length - 1)] ?? 0;
}

// 手牌加上自摸 t 能不能和、够不够 bind 番（立直、一发照现在的算，不算里宝牌）
function enoughTsumo(g: Game, seat: number, t: TileId, bind: number): boolean {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  counts[kindOf(t)]++;
  if (shanten(counts, p.melds.length) !== -1) return false;
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
  return !!r && (r.yakuman > 0 || r.han >= bind);
}

// 电脑的哩缚上以后，这一手和了番数不够、牌山还多：先不和
export function riiHoldsShort(g: Game, seat: number, han: number, yakuman: number): boolean {
  const bind = riiBind(g, seat);
  if (bind === null || yakuman > 0 || han >= bind) return false;
  return g.wall.remaining > RII.holdUntil;
}

export const riiAbility: Ability = {
  id: 'rii',
  name: '番缚',
  description: `被动：别人对她配牌、摸牌的影响减半。番缚：每一局第一次出牌时可以给自己缚上 1–${RII.maxBind} 番，缚上以后牌会往缚的番数上靠（缚得越多越难）。和出的番数不少于番缚数就得到一把钥匙，没和成得到一把破碎的钥匙，番数不够什么也没有。钥匙记着是哪一局，鹤田姬子在那一局能和出两倍番缚的牌。缚没缚只有宫永照看得穿。`,

  resist() {
    return RII.resist;
  },

  // 电脑的哩：第一次出牌前手牌够好才缚上估出来的番数。烂牌也缚的话大多数局和不了，
  // 每一局都会拿到破碎的钥匙，同桌的姬子就几乎一直是破碎的钥匙。已经鸣过牌（立直、门清自摸没了）不缚
  afterDraw(g, seat) {
    if (g.manual[seat] || !riiCanBind(g, seat)) return;
    const p = g.players[seat];
    if (p.melds.length || shanten(toCounts(p.hand), 0) > RII.aiBindShanten) return;
    stateOf(g, seat).bind = riiGuess(g, seat);
  },

  // 缚上以后牌往缚的番数上靠：没听牌时换成进张，听牌了换成自摸就够番的和了牌（岭上牌不动）
  beforeDraw(g, seat, rinshan) {
    const bind = stateOf(g, seat).bind;
    if (bind === undefined || rinshan || !g.rng.chance(riiHelp(bind))) return;
    const p = g.players[seat];
    const counts = toCounts(p.hand);
    const m = p.melds.length;
    const sh = shanten(counts, m);
    if (sh === 0) {
      g.wall.bringToLive(0, (t) => enoughTsumo(g, seat, t, bind), g.rng);
      return;
    }
    const better = (t: TileId) => {
      counts[kindOf(t)]++;
      const ok = shanten(counts, m) < sh;
      counts[kindOf(t)]--;
      return ok;
    };
    g.wall.bringToLive(0, better, g.rng);
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
    if (bind !== null) return { label: '番缚', note: `这一局缚了 ${bind} 番，和出 ${bind} 番以上得到钥匙；摸牌有 ${Math.round(riiHelp(bind) * 100)}% 的机会往这个番数上靠。${list}`, enabled: false, active: true };
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

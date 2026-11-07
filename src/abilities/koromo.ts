import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { TileId, doraFromIndicator, kindName, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile, kuroLost } from './kuro';
import { SHIZUNO, shizunoMistOver } from './shizuno';
import { PRIORITY, type Ability, type DrawRule } from './types';

// 天江衣（龙门渊）：整局围绕“海底”走。原作里她是前一年全国大赛的得点王，和的几乎都是满贯以上、带好几张宝牌，
// 这里按“打点王”来做：海底路线上立直一发自摸海底，再加宝牌，就是跳满、倍满
// - 海底捞月：配完牌时算一下，没人鸣牌的话牌山最后一张归她摸，就把那张定成她不求人和得了的牌、只给她看，
//   这一局进入“海底”路线。最后两巡还没人鸣牌，她立直，下一巡海底自摸（立直以后谁打的牌都鸣不了）
//   · 月下的配牌：这种局（海底归她）她的配牌里最多 2 张孤张换成宝牌
// - 海底挪移：海底不归她时，她一向听以内，鸣一手牌就能听牌、而且之后最后一张轮到她摸，就鸣；
//   鸣完以后海底换成她的和了牌、只给她看，这一局进入“海底”路线（海底本身是役，所以可以无役鸣牌）
// - 海底路线上：别家没听牌的进入一向听地狱（一向听、两向听摸不到进张），听了牌的不能自摸；
//   她听了牌以后，别家鸣不了牌（看得穿海底的咲、久、真子、美穗子除外）。
//   有人鸣牌、开杠把海底错开，路线就停下来，等她再挪回来（原作里咲就是这样破的）
// - 海底牌能定成宝牌（或赤牌）就定成宝牌
// - 满潮：海底路线上，她还没听牌时摸牌有 50% 换成进张；听了牌以后有 50% 换成换进手里还听牌的宝牌
// - 潮起潮落：不在海底路线上时，她自己的进张效率上升 15%
// - 满潮、潮起潮落换进张时，牌山里有进张宝牌就先给宝牌。松实玄的宝牌还在她手里时，宝牌只归玄，这几条都不给宝牌
// - 感知：看得出别家听没听牌、牌有多大（和洋榎一样亮灯，但不知道听哪几张；见 src/ui/app.ts 的 bulbHtml）
// - 月相：每个半庄随机一个月相，越接近满月，别人的能力（压制、封印、深山……）越难干扰她；
//   石户霞的绝一门、松实玄的宝牌照样管得到她
export const MOON_PHASES = [
  { name: '新月', icon: '🌑', power: 0.25 },
  { name: '娥眉月', icon: '🌒', power: 0.4 },
  { name: '上弦月', icon: '🌓', power: 0.55 },
  { name: '盈凸月', icon: '🌔', power: 0.75 },
  { name: '满月', icon: '🌕', power: 1 },
  { name: '亏凸月', icon: '🌖', power: 0.75 },
  { name: '下弦月', icon: '🌗', power: 0.55 },
  { name: '残月', icon: '🌘', power: 0.4 },
];

export const KOROMO = {
  hellDepth: 2, // 海底路线上，别人几向听以内摸不到进张（2：一向听、两向听）
  tide: 0.15, // 潮起潮落：不在海底路线上、她还没听牌时，这一次摸牌换成进张的概率
  flood: 0.5, // 满潮：海底路线上，这一次摸牌换成进张（没听牌时）或换进手里还听牌的宝牌（听牌以后）的概率
  resist: 0.6, // 满月时挡掉别人能力干扰的概率，别的月相按 power 打折
  dealMaxShanten: 4, // 配牌几向听以内才走海底捞月（再差的配牌不求人和不了）
  dealDora: 2, // 月下的配牌：海底归她的局，配牌里最多几张孤张换成宝牌
  riichiAt: 4, // 牌山剩这么多张时（她倒数第二次摸牌）立直
  holdUnder: 8000, // 电脑的衣：海底路线上不到这么大（庄家 1.5 倍）的和先不和，等海底自摸
  // 海底被别人鸣牌错开以后，这一局还算不算海底路线（地狱、别人不能自摸照样起作用）
  sticky: true,
  // 别家电脑（没经验的）每局会想到去鸣牌错开她海底的概率；KOROMO_READERS 里的人每局都会
  aiDisrupt: 0.3,
  // 海底路线上她听牌以后，别家（KOROMO_READERS 以外）鸣不了牌
  tenpaiFreeze: true,
};

// 看得穿衣的海底、每局都会去错开的人：原作里和她交过手、有经验的
export const KOROMO_READERS = ['saki', 'hisa', 'mako', 'mihoko'];
// 月相挡不住的能力：霞的绝一门（玄是 absolute，本来就挡不住）
const UNRESISTED = ['kasumi', 'kuro'];

interface KoromoGameState {
  moon?: number;
  sealRoll?: Record<number, boolean>; // 每一局掷一次：月相挡没挡住封印
}
interface KoromoState {
  route?: 'deal' | 'call'; // 这一局进了海底路线：配牌时（海底捞月）还是鸣牌（海底挪移）
  on?: boolean; // 现在海底在她那边，路线起作用（地狱、别人不能自摸）
  haitei?: TileId; // 安排好的海底牌（锁住，只给她看）
  kind?: number; // 海底定的是哪种牌（被错开以后再回到她这边时还按这种牌安排）
  called?: boolean; // 她这一局鸣过牌（鸣牌以后听牌、海底归她，就是海底挪移）
  disrupt?: Record<number, boolean>; // 别家电脑这一局想不想去错开她的海底（按座位，掷过才有）
  fogged?: boolean; // 稳乃的雾遮住了这一局的海底（掷过就是 true/false）
}

// 这一局海底路线起作用（地狱、别人不能自摸、不加潮起潮落）：海底归她时；sticky 时进过路线就一直算
const routeLive = (st: KoromoState) => !!st.on || (KOROMO.sticky && !!st.route);

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as KoromoGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as KoromoState;

export function koromoMoon(g: Game, seat: number) {
  const m = gameStateOf(g, seat).moon;
  return m === undefined ? null : MOON_PHASES[m];
}

// 月相挡掉别人干扰的概率
export function koromoResist(g: Game, seat: number): number {
  return KOROMO.resist * (koromoMoon(g, seat)?.power ?? 1);
}

// 这一局在海底路线上、海底现在归她
export function koromoRouteOn(g: Game, seat: number): boolean {
  return !!stateOf(g, seat).on;
}

// 这一局进过海底路线（海底可能暂时被错开了），雾也没遮住
export function koromoRouteSet(g: Game, seat: number): boolean {
  const st = stateOf(g, seat);
  return !!st.route && !st.fogged;
}

// 这一局的海底还能不能是她的（雾没遮住）：电脑别家用来决定要不要去错开
export function koromoHaiteiOn(g: Game, seat: number): boolean {
  return !stateOf(g, seat).fogged;
}

// 她安排好的海底牌（只有她自己看得到）
export function koromoHaiteiTile(g: Game, seat: number): TileId | null {
  return stateOf(g, seat).haitei ?? null;
}

// 电脑 viewer 这一局会不会去鸣牌错开衣的海底：有经验的人一定会，别人每局掷一次
export function koromoDisruptor(g: Game, seat: number, viewer: number, readers: boolean): boolean {
  const st = stateOf(g, seat);
  st.disrupt ??= {};
  st.disrupt[viewer] ??= readers || g.rng.chance(KOROMO.aiDisrupt);
  return st.disrupt[viewer];
}

// 没人再鸣牌、开杠的话，牌山最后一张是谁摸（下一次摸牌的人是 drawer）
const haiteiDrawer = (g: Game, drawer: number, rinshan: boolean) => (drawer + (rinshan ? 1 : 0) + g.wall.live.length - 1) % 4;

function release(g: Game, st: KoromoState) {
  if (st.haitei !== undefined) g.wall.locked.delete(st.haitei, 'koromo');
  st.haitei = undefined;
}

// 松实玄的宝牌还在：宝牌只归玄，衣的能力不给宝牌
const kuroHoldsDora = (g: Game, seat: number) => [0, 1, 2, 3].some((s) => s !== seat && g.active(s)?.id === 'kuro' && !kuroLost(g, s));

// 这张牌是不是她能要的宝牌
const richTile = (g: Game, seat: number) => (kuroHoldsDora(g, seat) ? () => false : (t: TileId) => isDoraTile(g, t));

// 把牌山最后一张换成 ok 的牌并锁住（已经是就留着）；能定成宝牌就定成宝牌（月下的海底）
function placeHaitei(g: Game, seat: number, st: KoromoState, ok: (t: TileId) => boolean): boolean {
  const w = g.wall;
  const last = w.live.length - 1;
  if (last < 0) return false;
  if (st.haitei !== undefined && w.live[last] === st.haitei && ok(st.haitei)) return true;
  release(g, st);
  if (w.locked.has(w.live[last])) return false;
  const rich = richTile(g, seat);
  if (!w.bringToLive(last, (t) => ok(t) && rich(t), g.rng) && !w.bringToLive(last, ok, g.rng)) return false;
  st.haitei = w.live[last];
  st.kind = kindOf(st.haitei);
  w.locked.add(st.haitei, 'koromo');
  return true;
}

// 雾：第一次进路线时掷一次，月相能挡掉一部分
function fogRoll(g: Game, seat: number, st: KoromoState): boolean {
  if (st.fogged === undefined) {
    const L = shizunoMistOver(g, seat);
    st.fogged = L > 0 && g.rng.chance(Math.min(1, L * SHIZUNO.haiteiFog) * (1 - koromoResist(g, seat)));
  }
  return st.fogged;
}

// 配牌后定海底：她的手牌加上哪种牌向听最少（牌山里、王牌里还拿得到的），就定哪种；一样少的先挑宝牌
function bestHaiteiKind(g: Game, seat: number): number | null {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const w = g.wall;
  const avail = toCounts([...w.live, ...w.rinshan, ...w.uraIndicators].filter((t) => !w.locked.has(t)));
  const doraKinds = kuroHoldsDora(g, seat) ? [] : w.visibleDoraIndicators().map((i) => doraFromIndicator(kindOf(i)));
  let best: number | null = null;
  let bestScore = Infinity;
  const order = g.rng.shuffle([...Array(34).keys()]);
  for (const k of order) {
    if (!avail[k] || counts[k] >= 4) continue;
    counts[k]++;
    const score = shanten(counts, p.melds.length) * 2 + (doraKinds.includes(k) ? 0 : 1);
    counts[k]--;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

// 摸牌换成进张（满潮、潮起潮落）：牌山里还有她能要的进张宝牌，就只放过进张宝牌
function feedRule(g: Game, seat: number, text: string, sh0: number): DrawRule {
  const p = g.players[seat];
  const counts = toCounts(p.hand);
  const eff = new Set<number>();
  for (let k = 0; k < 34; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (shanten(counts, p.melds.length) < sh0) eff.add(k);
    counts[k]--;
  }
  const w = g.wall;
  const rich = richTile(g, seat);
  const plenty = w.live.some((t) => !w.locked.has(t) && eff.has(kindOf(t)) && rich(t) && !w.deny?.(t));
  return { seat, ability: 'koromo', text, deny: (t) => !eff.has(kindOf(t)) || (plenty && !rich(t)) };
}

// 满潮（听牌以后）：只放过换进手里、打掉一张不是宝牌的牌还听着的宝牌；牌山里没有就不管
function richRule(g: Game, seat: number): DrawRule | undefined {
  const p = g.players[seat];
  const rich = richTile(g, seat);
  const counts = toCounts(p.hand);
  const plain = [...new Set(p.hand.filter((t) => !rich(t)).map(kindOf))];
  const ok = new Set<number>();
  for (let k = 0; k < 34; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    for (const j of plain) {
      if (j === k) continue;
      counts[j]--;
      const s = shanten(counts, p.melds.length);
      counts[j]++;
      if (s === 0) {
        ok.add(k);
        break;
      }
    }
    counts[k]--;
  }
  const w = g.wall;
  const want = (t: TileId) => rich(t) && ok.has(kindOf(t));
  if (!w.live.some((t, i) => i < w.live.length - 1 && !w.locked.has(t) && want(t) && !w.deny?.(t))) return;
  return { seat, ability: 'koromo', text: '满潮', deny: (t) => !want(t) };
}

export const koromoAbility: Ability = {
  id: 'koromo',
  name: '海底捞月',
  description: `海底捞月：配完牌时，如果没人鸣牌、牌山最后一张归她，海底就变成她不求人和得了的牌（只有她看得到），这一局走“海底”路线，配牌里还会混进最多 ${KOROMO.dealDora} 张宝牌；最后两巡还没人鸣牌，她立直，下一巡一发自摸海底。海底挪移：海底不归她时，她一向听以内鸣一手就能听牌、最后一张又轮到她，鸣完海底就换成她的和了牌，同样走海底路线。海底路线上，别家没听牌的进入一向听地狱，听了牌的不能自摸；她听牌以后别家鸣不了牌（咲、久、真子、美穗子看得穿，照样能鸣），立直以后谁都鸣不了；有人鸣牌、开杠把海底错开，路线就停下来。海底牌能定成宝牌就定成宝牌。满潮：海底路线上，她没听牌时摸牌有 ${KOROMO.flood * 100}% 换成进张，听牌以后有 ${KOROMO.flood * 100}% 换成还听着牌的宝牌。潮起潮落：不在海底路线上时，她的进张效率上升 ${KOROMO.tide * 100}%。换进张时先给宝牌（松实玄的宝牌还在时不给）。感知：看得出别家听没听牌、牌有多大（头像旁亮灯，不知道听哪几张）。月相：越接近满月，别人的能力越难干扰她（满月挡掉 ${KOROMO.resist * 100}%），霞和玄的能力照样管得到。`,
  priority: PRIORITY.koromo,

  beforeDeal(g, seat) {
    const gs = gameStateOf(g, seat);
    if (gs.moon === undefined) gs.moon = g.rng.int(MOON_PHASES.length);
    // 月下的配牌：没人鸣牌的话海底归她的局，配牌里最多 dealDora 张孤张换成宝牌
    const w = g.wall;
    if ((g.dealer + w.live.length - 52 - 1) % 4 !== seat) return;
    const rich = richTile(g, seat);
    const mine = g.dealIndices(seat);
    let swaps = 0;
    for (const i of g.rng.shuffle([...mine])) {
      if (swaps >= KOROMO.dealDora) break;
      const counts = toCounts(mine.map((j) => w.live[j]));
      const t = w.live[i];
      const k = kindOf(t);
      if (rich(t) || counts[k] > 1) continue;
      // 只换孤张：字牌，或者数牌前后两格内没有同花色的牌
      if (k < 27 && [-2, -1, 1, 2].some((d) => (k % 9) + d >= 0 && (k % 9) + d <= 8 && counts[k + d] > 0)) continue;
      if (w.bringToLive(i, rich, g.rng, (j) => j >= 52)) swaps++;
    }
  },

  onRoundStart(g, seat) {
    // 第一局开局时告诉大家今晚的月亮
    if (g.roundWind === 0 && g.roundNumber === 0 && g.honba === 0) {
      const moon = koromoMoon(g, seat)!;
      g.emit({ type: 'ability', seat, ability: 'koromo', text: moon.name });
    }
  },

  // 海底捞月：配完牌，庄家摸第一张之前
  afterDeal(g, seat) {
    const st = stateOf(g, seat);
    if (haiteiDrawer(g, g.dealer, false) !== seat) return;
    const p = g.players[seat];
    if (shanten(toCounts(p.hand), p.melds.length) > KOROMO.dealMaxShanten) return;
    const k = bestHaiteiKind(g, seat);
    if (k === null || fogRoll(g, seat, st)) return;
    if (!placeHaitei(g, seat, st, (t) => kindOf(t) === k)) return;
    st.route = 'deal';
    st.on = true;
    g.emit({ type: 'ability', seat, ability: 'koromo', text: '海底捞月' });
  },

  onCall(g, seat, caller, call) {
    if (caller === seat && (call === '吃' || call === '碰')) stateOf(g, seat).called = true;
  },

  beforeAnyDraw(g, seat, drawer, rinshan) {
    const w = g.wall;
    const st = stateOf(g, seat);
    const me = g.players[seat];
    const waits = me.hand.length % 3 === 1 ? g.waits(seat) : [];
    const mine = w.live.length > 0 && haiteiDrawer(g, drawer, rinshan) === seat;
    // 海底挪移：她鸣过牌、现在听牌、最后一张轮到她
    if (!st.route && st.called && waits.length && mine && !rinshan && !fogRoll(g, seat, st)) {
      if (placeHaitei(g, seat, st, (t) => waits.includes(kindOf(t)))) {
        st.route = 'call';
        st.on = true;
        g.emit({ type: 'ability', seat, ability: 'koromo', text: '海底挪移' });
      }
    }
    if (st.route) {
      // 海底被错开（有人鸣牌、开杠，或者开杠把那张挪进了王牌区）：路线停下来，等最后一张又轮到她
      const kept = st.haitei !== undefined && w.live[w.live.length - 1] === st.haitei;
      if (!mine) {
        if (st.on) release(g, st);
        st.on = false;
      } else if (waits.length) {
        // 听牌了：海底换成她现在听的牌
        st.on = placeHaitei(g, seat, st, (t) => waits.includes(kindOf(t)));
      } else if (!kept) {
        // 没听牌、海底丢了又回到她这边：还按原来那种牌安排（她拆了听牌时也不动）
        const k = st.kind;
        st.on = k !== undefined && placeHaitei(g, seat, st, (t) => kindOf(t) === k);
      } else st.on = true;
    }

    if (drawer === seat) {
      // 还没听牌时摸牌换成进张（先给宝牌）：海底路线上是满潮，不在路线上是潮起潮落
      if (rinshan) return;
      const sh0 = shanten(toCounts(me.hand), me.melds.length);
      const live = routeLive(st);
      if (!g.rng.chance(live ? KOROMO.flood : KOROMO.tide)) return;
      if (sh0 >= 1) return feedRule(g, seat, live ? '满潮' : '潮起潮落', sh0);
      // 满潮：海底归她、她听着牌时，摸牌换成换进手里还听牌的宝牌
      if (st.on && sh0 === 0) return richRule(g, seat);
      return;
    }
    // 一向听地狱：海底路线上，别家没听牌的摸不到进张
    if (!routeLive(st)) return;
    const p = g.players[drawer];
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    if (sh < 1 || sh > KOROMO.hellDepth) return;
    return {
      seat,
      ability: 'koromo',
      text: '一向听地狱',
      deny: (t) => {
        counts[kindOf(t)]++;
        const after = shanten(counts, p.melds.length);
        counts[kindOf(t)]--;
        return after < sh;
      },
    };
  },

  // 海底路线上，别人听了牌也不能自摸
  forbidsTsumo(g, seat, target) {
    return target !== seat && routeLive(stateOf(g, seat));
  },

  // 海底路线上（海底归她）：她听牌以后，别家鸣不了牌（看得穿海底的人除外）；她立直以后谁都鸣不了
  freezesCalls(g, seat, caller) {
    if (caller === seat || !stateOf(g, seat).on) return false;
    const p = g.players[seat];
    if (p.riichi || p.riichiPending) return true;
    if (!KOROMO.tenpaiFreeze || KOROMO_READERS.includes(g.abilities[caller]?.id ?? '')) return false;
    return p.hand.length % 3 === 1 && g.waits(seat).length > 0;
  },

  // 月相：挡掉别人给她定的配牌、摸牌规矩（霞、玄的除外）
  resist(g, seat, from) {
    if (from !== undefined && UNRESISTED.includes(g.abilities[from]?.id ?? '')) return 0;
    return koromoResist(g, seat);
  },
  // 月相：深山的削弱也挡掉一部分
  dampResist(g, seat) {
    return koromoResist(g, seat);
  },
  // 月相：封印每一局掷一次，挡住了这一局就封不住她
  unsealable(g, seat, round) {
    // 桌上没人会封印就不掷
    if (!g.abilities.some((a, o) => o !== seat && !!a?.seals)) return false;
    const gs = gameStateOf(g, seat);
    gs.sealRoll ??= {};
    gs.sealRoll[round] ??= g.rng.chance(koromoResist(g, seat));
    return gs.sealRoll[round];
  },

  afterDraw(g, seat) {
    const st = stateOf(g, seat);
    const p = g.players[seat];
    if (st.fogged && g.wall.remaining === 0 && !g.rinshanDraw) {
      const sz = [0, 1, 2, 3].find((s) => s !== seat && g.active(s)?.id === 'shizuno');
      if (sz !== undefined) g.emit({ type: 'ability', seat: sz, ability: 'shizuno', text: '雾遮住了海底', target: seat });
    }
    if (st.haitei !== undefined && p.drawn === st.haitei && g.wall.remaining === 0) {
      g.emit({ type: 'ability', seat, ability: 'koromo', text: '海底自摸' });
    }
  },

  skill(g, seat) {
    const st = stateOf(g, seat);
    const tile = st.kind !== undefined ? kindName(st.kind) : null;
    const note = st.on
      ? `海底路线：海底是${tile}；牌山剩 ${KOROMO.riichiAt} 张时立直，下一巡一发自摸海底`
      : st.route
        ? `海底被错开了${tile ? `（原来是${tile}）` : ''}，等最后一张再轮到你`
        : st.fogged
          ? '雾遮住了海底'
          : `潮起潮落：进张效率 +${KOROMO.tide * 100}%（先给宝牌）；一向听以内鸣一手能听牌、又能摸到海底时就是海底挪移`;
    return { label: '', note, enabled: false, active: !!st.on };
  },

  insight(g, seat) {
    const moon = koromoMoon(g, seat);
    const st = stateOf(g, seat);
    const out = [moon ? `今晚是${moon.name}，别人的能力有 ${Math.round(koromoResist(g, seat) * 100)}% 干扰不到她` : '月相还没出来'];
    out.push(st.on ? `海底路线（${st.route === 'deal' ? '海底捞月' : '海底挪移'}）：别家一向听地狱、不能自摸；满潮，宝牌往她手里流` : st.route ? '海底被错开了，路线停下来' : '不在海底路线上（潮起潮落）');
    return out;
  },

  badge(g, seat) {
    const moon = koromoMoon(g, seat);
    if (!moon) return null;
    return stateOf(g, seat).on ? `${moon.icon} 海底` : `${moon.icon} ${moon.name}`;
  },
};

import type { Game } from '../engine/game';
import type { WinResult } from '../engine/score';
import { shanten, standardShanten } from '../engine/shanten';
import { Kind, TileId, doraFromIndicator, kindOf, toCounts } from '../engine/tiles';
import { tilesOf } from './doraControl';
import { isDoraTile } from './kuro';
import type { Ability, PreDealOption } from './types';

// 真屋由晖子（有珠山高中，副将）：左手。
// 原作：一天只能用一次。换左手摸牌时身后出现十字、念一句圣经，这一局几乎一定自摸，至少满贯
// （准决赛那一次是立直、自摸、七对子、宝牌 4 的倍满）。不用左手时也很强，常听大牌。
// - 左手（一场一次，发牌前选）：牌型不固定，顺着她自己的配牌走——
//   · 配牌里换进宝牌（赤宝牌也算），至少 doraDeal 张（换掉的是不影响向听的闲张，配牌本身不变好）；
//   · 没听牌时每次摸牌有 drawLuck 的概率换成有效进张，带宝牌的进张先挑；
//   · 听牌以后第 1、2、3 次摸牌分别有 win 里的概率摸到和了牌（几种和了牌里挑和出来最大的），
//     第三次一定来（牌山里没有就从还没翻开的王牌里拿）；
//   · 立直和牌时不到满贯，里宝牌补到满贯（只有和牌的人定里宝牌，见 doraControl）。
//   别人照样可以抢先和牌，抢先了这一次左手也算用掉。别人定的规矩照守（摸牌前的规矩、配牌的规矩、锁住的牌），
//   被封印、压住、削弱时照常不起作用
// 电脑的她：南场自己坐庄的局用左手，最后两局还没用就一定用，点数不到一万时也用。
// 左手的局门清、留宝牌、不鸣牌、一向听以内不弃和，听牌就立直；荣和不到满贯不和，等自摸
export const YUKIKO = {
  uses: 1, // 一场几次（原作一天一次）
  doraDeal: 2, // 左手的局配牌里至少几张宝牌（赤宝牌也算）
  drawLuck: 0.15, // 没听牌时，每次摸牌换成有效进张的概率
  win: [0.3, 0.6, 1], // 听牌以后第 1、2、3 次摸牌换成和了牌的概率（之后照最后一个）
};

export const YUKIKO_VERSE = '你们祈求，就给你们；寻找，就寻见；叩门，就给你们开门。';
export const YUKIKO_VERSE_REF = '马太福音 7:7';

interface YukikoGameState {
  used?: number; // 这一场用过几次左手
  want?: boolean; // 玩家发牌前选了左手
}
interface YukikoState {
  left?: boolean; // 这一局用了左手
  tenpaiDraws?: number; // 左手的局听牌以后摸了几次
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as YukikoGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as YukikoState;
const isYukiko = (g: Game, seat: number) => g.abilities[seat]?.id === 'yukiko';
const pct = (v: number) => `${Math.round(v * 100)}%`;

// 左手还剩几次
export const yukikoLeftUses = (g: Game, seat: number): number => (isYukiko(g, seat) ? YUKIKO.uses - (gameStateOf(g, seat).used ?? 0) : 0);

// 这一局用了左手（被封印也算用过，只是不起作用；界面上的十字看这个）
export const yukikoLeft = (g: Game, seat: number): boolean => isYukiko(g, seat) && !!stateOf(g, seat).left;

// 这一局左手起作用（电脑的打法看这个）
export const yukikoLeftActive = (g: Game, seat: number): boolean => g.active(seat)?.id === 'yukiko' && !!stateOf(g, seat).left;

// 满贯以上（基本点 2000 起）
export const isMangan = (r: WinResult | null): boolean => !!r && r.base >= 2000;

// 电脑：南场自己坐庄的局；最后两局还没用就用；点数快见底了（不到一万）也用，免得被击飞时还没用
const aiUses = (g: Game, seat: number): boolean => (g.roundWind >= 1 && g.dealer === seat) || g.isLastRounds(2) || g.players[seat].score < 10000;

// 电脑左手的局：荣和不到满贯就不和，等自摸（几次摸牌之内就来，立直自摸至少满贯）
export function yukikoRonOk(g: Game, seat: number, tile: TileId): boolean {
  const r = g.winResult(seat, tile, false);
  if (!r) return false;
  const han = r.han - r.ura;
  return r.yakuman > 0 || han >= 5 || (han === 4 && r.fu >= 40) || (han === 3 && r.fu >= 70);
}

// 摸到 kind 自摸的话和出来怎么样（不算里宝牌：还没翻）。和不了是 null
function tsumoValue(g: Game, seat: number, kind: Kind): { han: number; mangan: boolean } | null {
  const p = g.players[seat];
  const t = (kind << 2) + 3;
  p.hand.push(t);
  const r = g.winResult(seat, t, true);
  p.hand.pop();
  if (!r) return null;
  const han = r.han - r.ura;
  return { han, mangan: r.yakuman > 0 || han >= 5 || (han === 4 && r.fu >= 40) || (han === 3 && r.fu >= 70) };
}

// 把她配牌里的一张牌换成 is 的牌：先从发完牌以后的牌山里拿，再从别人的配牌（Wall.guard 管着别人的规矩），再从没翻开的王牌
function bring(g: Game, mine: number[], slot: number, is: (t: TileId) => boolean): boolean {
  const w = g.wall;
  const later = (j: number) => j >= 52;
  const notMine = (j: number) => !mine.includes(j);
  return w.bringToLive(slot, is, g.rng, later) || w.bringToLive(slot, is, g.rng, notMine) || w.bringDeadToLive(slot, is, g.rng);
}

// 配牌里换走也不影响一般型向听的闲张（宝牌不算）
function spareSlots(g: Game, mine: number[]): number[] {
  const w = g.wall;
  const counts = toCounts(mine.map((i) => w.live[i]));
  const cur = standardShanten(counts, 0);
  return g.rng.shuffle(
    mine.filter((i) => {
      const t = w.live[i];
      if (w.locked.has(t) || isDoraTile(g, t)) return false;
      counts[kindOf(t)]--;
      const ok = standardShanten(counts, 0) === cur;
      counts[kindOf(t)]++;
      return ok;
    }),
  );
}

export const yukikoAbility: Ability = {
  id: 'yukiko',
  name: '左手',
  description: `一场一次（发牌前选）：这一局换左手摸牌。配牌带 ${YUKIKO.doraDeal} 张以上宝牌；没听牌时摸牌有 ${pct(YUKIKO.drawLuck)} 是有效进张（先挑宝牌）；听牌以后 ${YUKIKO.win.length} 次摸牌之内自摸（${YUKIKO.win.map(pct).join('、')}）。立直和牌不到满贯时，里宝牌补到满贯。别人还是能抢先和牌。`,

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    const want = g.manual[seat] ? !!gs.want : aiUses(g, seat);
    gs.want = false;
    if (!want || yukikoLeftUses(g, seat) <= 0) return;
    gs.used = (gs.used ?? 0) + 1;
    st.left = true;
    st.tenpaiDraws = 0;
  },

  beforeDeal(g, seat) {
    if (!stateOf(g, seat).left) return;
    const w = g.wall;
    const mine = g.dealIndices(seat);
    // 宝牌换进来：换掉不影响向听的闲张
    const doraIn = () => mine.filter((i) => isDoraTile(g, w.live[i])).length;
    for (let n = 0; n < 6 && doraIn() < YUKIKO.doraDeal; n++) {
      const slot = spareSlots(g, mine)[0];
      if (slot === undefined || !bring(g, mine, slot, (t) => isDoraTile(g, t))) break;
    }
  },

  onRoundStart(g, seat) {
    if (stateOf(g, seat).left) g.emit({ type: 'ability', seat, ability: 'yukiko', text: '左手' });
  },

  beforeDraw(g, seat, rinshan) {
    const st = stateOf(g, seat);
    if (!st.left) return;
    const p = g.players[seat];
    const w = g.wall;
    const counts = toCounts(p.hand);
    const sh = shanten(counts, p.melds.length);
    const next = rinshan ? w.rinshan[0] : w.live[0];
    if (next === undefined) return;
    const to = (is: (t: TileId) => boolean) => (rinshan ? w.bringToRinshan(is, g.rng) : w.bringToLive(0, is, g.rng));
    if (sh <= 0) {
      // 听牌了：几次摸牌之内一定自摸。几种和了牌里先挑和出来满贯以上的、番多的
      const n = st.tenpaiDraws ?? 0;
      st.tenpaiDraws = n + 1;
      if (!g.rng.chance(YUKIKO.win[Math.min(n, YUKIKO.win.length - 1)])) return;
      const waits = g.waits(seat);
      if (waits.includes(kindOf(next))) return;
      const ranked = waits
        .map((k) => ({ k, v: tsumoValue(g, seat, k) }))
        .sort((a, b) => Number(!!b.v?.mangan) - Number(!!a.v?.mangan) || (b.v?.han ?? -1) - (a.v?.han ?? -1));
      for (const { k } of ranked) if (to((t) => kindOf(t) === k)) return;
      const any = (t: TileId) => waits.includes(kindOf(t));
      if (!rinshan) w.bringDeadToLive(0, any, g.rng);
      return;
    }
    // 没听牌：换成有效进张，带宝牌的先挑
    if (!g.rng.chance(YUKIKO.drawLuck)) return;
    const useful = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, p.melds.length);
      counts[kindOf(t)]--;
      return after < sh;
    };
    if (useful(next) && isDoraTile(g, next)) return;
    if (to((t) => useful(t) && isDoraTile(g, t))) return;
    if (!useful(next)) to(useful);
  },

  // 左手的局立直和牌：不到满贯时，里宝牌换成指向她手里最多的牌，补到满贯
  claimUra(g, seat, winTile) {
    if (!stateOf(g, seat).left) return;
    const p = g.players[seat];
    const value = () => (winTile !== undefined ? g.winResult(seat, winTile, false) : g.winResult(seat, p.drawn!, true));
    if (isMangan(value())) return;
    const counts = toCounts(tilesOf(g, seat, winTile));
    const kinds = [...counts.keys()].filter((k) => counts[k] > 0).sort((a, b) => counts[b] - counts[a]);
    const w = g.wall;
    for (let i = 0; i < w.doraRevealed; i++) {
      for (const k of kinds) {
        if (doraFromIndicator(kindOf(w.uraIndicators[i])) === k) break;
        if (w.bringToUra(i, (t) => doraFromIndicator(kindOf(t)) === k, g.rng)) break;
      }
      if (isMangan(value())) return;
    }
  },

  preDeal(g, seat): PreDealOption[] {
    const left = yukikoLeftUses(g, seat);
    return [
      {
        id: 'left',
        name: '左手',
        desc: `这一局换左手摸牌：配牌带宝牌，进张更顺，听牌以后 ${YUKIKO.win.length} 次摸牌之内自摸；立直和牌至少满贯。一场 ${YUKIKO.uses} 次，别人抢先和了也算用掉`,
        enabled: left > 0,
        picked: false,
        note: left > 0 ? `一场 ${YUKIKO.uses} 次` : '这一场已经用过了',
      },
    ];
  },

  setPreDeal(g, seat, picked) {
    gameStateOf(g, seat).want = picked.includes('left');
  },

  skill(g, seat) {
    const left = yukikoLeftUses(g, seat);
    const meter = { value: left, max: YUKIKO.uses, label: '左手' };
    if (stateOf(g, seat).left) {
      const p = g.players[seat];
      const tenpai = shanten(toCounts(p.hand), p.melds.length) <= 0;
      return { label: '', note: tenpai ? '左手：听牌了，几次摸牌之内自摸（立直和牌至少满贯）' : '左手：进张更顺，宝牌先来', enabled: false, active: true, meter };
    }
    return { label: '', note: left > 0 ? `左手还没用（发牌前选，一场 ${YUKIKO.uses} 次）` : '左手用过了', enabled: false, meter };
  },

  powered(g, seat) {
    return !!stateOf(g, seat).left;
  },

  badge(g, seat) {
    return stateOf(g, seat).left ? '左手' : null;
  },

  insight(g, seat) {
    const left = yukikoLeftUses(g, seat);
    if (stateOf(g, seat).left) return ['这一局用了左手：进张更顺、宝牌往她手里来，听牌以后几次摸牌之内自摸，立直和牌至少满贯'];
    return [left > 0 ? `左手还没用（一场 ${YUKIKO.uses} 次）` : '左手这一场用过了'];
  },
};

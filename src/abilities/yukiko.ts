import type { Game } from '../engine/game';
import type { WinResult } from '../engine/score';
import { shanten } from '../engine/shanten';
import { Kind, TileId, doraFromIndicator, kindOf, toCounts } from '../engine/tiles';
import { tilesOf } from './doraControl';
import { isDoraTile } from './kuro';
import type { Ability } from './types';

// 真屋由晖子（有珠山高中，副将）：左手。
// 原作：一天只能用一次。换左手摸牌时手上浮出腓尼基字母 𐤄（「窗」），这一局自摸，至少满贯
// （准决赛那一次是立直、自摸、七对子、宝牌 4 的倍满）。不用左手时也很强，常听大牌。
// - 左手（一场一次，对局中随时按）：按下去以后这一局换左手摸牌，牌型不固定，顺着她自己的手走——
//   · 没听牌时每次摸牌有 drawLuck 的概率换成有效进张，带宝牌的进张先挑；
//     没换成有效进张、摸来的又是没用的牌时，手里宝牌（赤宝牌也算）不到 dora 张就换成宝牌（不碍向听；牌山里没有就从没翻开的王牌里拿）；
//   · 听牌以后（按下去时已经听牌也一样）第 1、2、3 次摸牌分别有 win 里的概率摸到和了牌
//     （几种和了牌里挑和出来最大的），第三次一定来（牌山里没有就从还没翻开的王牌里拿）；
//   · 立直和牌时不到满贯，里宝牌补到满贯（只有和牌的人定里宝牌，见 doraControl）。
//   别人照样可以抢先和牌，抢先了这一次左手也算用掉。别人定的规矩照守（摸牌前的规矩、锁住的牌），
//   被封印时按不了，按了以后被压住、削弱时照常不起作用
// 电脑的她：南场自己坐庄的局、最后两局、点数不到一万时，门清摸到听牌就按；最后一局还没用就开局直接按。
// 左手的局门清、留宝牌、不鸣牌、一向听以内不弃和，听牌就立直；荣和不到满贯不和，等自摸
export const YUKIKO = {
  uses: 1, // 一场几次（原作一天一次）
  dora: 2, // 没用的进张换成宝牌，换到手里有几张为止（赤宝牌也算）
  drawLuck: 0.15, // 没听牌时，每次摸牌换成有效进张的概率
  win: [0.3, 0.6, 1], // 听牌以后第 1、2、3 次摸牌换成和了牌的概率（之后照最后一个）
};

interface YukikoGameState {
  used?: number; // 这一场用过几次左手
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

// 这一局用了左手（按了以后被压住也算用过，只是不起作用；界面上的 𐤄 看这个）
export const yukikoLeft = (g: Game, seat: number): boolean => isYukiko(g, seat) && !!stateOf(g, seat).left;

// 这一局左手起作用（电脑的打法看这个）
export const yukikoLeftActive = (g: Game, seat: number): boolean => g.active(seat)?.id === 'yukiko' && !!stateOf(g, seat).left;

// 现在按得了左手：还有次数、这一局还没按、这一局正在打（轮到谁都行）、没被封印
export function yukikoCanLeft(g: Game, seat: number): boolean {
  if (g.active(seat)?.id !== 'yukiko' || (g.phase !== 'turn' && g.phase !== 'calls')) return false;
  return !stateOf(g, seat).left && yukikoLeftUses(g, seat) > 0;
}

// 换左手。成功返回 true
export function yukikoStartLeft(g: Game, seat: number): boolean {
  if (!yukikoCanLeft(g, seat)) return false;
  const gs = gameStateOf(g, seat);
  const st = stateOf(g, seat);
  gs.used = (gs.used ?? 0) + 1;
  st.left = true;
  st.tenpaiDraws = 0;
  g.emit({ type: 'ability', seat, ability: 'yukiko', text: '左手' });
  return true;
}

// 满贯以上（基本点 2000 起）
export const isMangan = (r: WinResult | null): boolean => !!r && r.base >= 2000;

// 不算里宝牌（还没翻）的番、符够不够满贯
const manganBefore = (r: WinResult): boolean => {
  const han = r.han - r.ura;
  return r.yakuman > 0 || han >= 5 || (han === 4 && r.fu >= 40) || (han === 3 && r.fu >= 70);
};

// 电脑左手的局：荣和不到满贯就不和，等自摸（几次摸牌之内就来，立直自摸至少满贯）
export function yukikoRonOk(g: Game, seat: number, tile: TileId): boolean {
  const r = g.winResult(seat, tile, false);
  return !!r && manganBefore(r);
}

// 摸到 kind 自摸的话和出来怎么样（不算里宝牌：还没翻）。和不了是 null
function tsumoValue(g: Game, seat: number, kind: Kind): { han: number; mangan: boolean } | null {
  const p = g.players[seat];
  const t = (kind << 2) + 3;
  p.hand.push(t);
  const r = g.winResult(seat, t, true);
  p.hand.pop();
  if (!r) return null;
  return { han: r.han - r.ura, mangan: manganBefore(r) };
}

// 电脑：门清（暗杠不算鸣），刚摸的 14 张打一张就听牌（之后立直，里宝牌补到满贯）
function aiReady(g: Game, seat: number): boolean {
  const p = g.players[seat];
  if (p.drawn === null || !p.melds.every((m) => m.type === 'ankan')) return false;
  const counts = toCounts(p.hand);
  for (let k = 0; k < counts.length; k++) {
    if (counts[k] === 0) continue;
    counts[k]--;
    const sh = shanten(counts, p.melds.length);
    counts[k]++;
    if (sh === 0) return true;
  }
  return false;
}

// 电脑：南场自己坐庄的局、最后两局、点数不到一万（免得被击飞时还没用）时，听了牌就按
const aiGoodRound = (g: Game, seat: number): boolean => (g.roundWind >= 1 && g.dealer === seat) || g.isLastRounds(2) || g.players[seat].score < 10000;

export const yukikoAbility: Ability = {
  id: 'yukiko',
  name: '左手',
  description: `一场一次，对局中随时按：这一局换左手摸牌。没听牌时摸牌有 ${pct(YUKIKO.drawLuck)} 是有效进张（先挑宝牌），没用的进张换成宝牌（手里到 ${YUKIKO.dora} 张为止）；听牌以后 ${YUKIKO.win.length} 次摸牌之内自摸（${YUKIKO.win.map(pct).join('、')}）。立直和牌不到满贯时，里宝牌补到满贯。别人还是能抢先和牌。`,

  // 电脑：最后一局还没用，开局直接按
  onRoundStart(g, seat) {
    if (!g.manual[seat] && g.isLastRounds(1)) yukikoStartLeft(g, seat);
  },

  // 电脑：好的那几局，门清、摸完这张打一张就听牌时按（按了以后立直）
  afterDraw(g, seat) {
    if (g.manual[seat] || !yukikoCanLeft(g, seat) || !aiGoodRound(g, seat)) return;
    if (aiReady(g, seat)) yukikoStartLeft(g, seat);
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
      // 听牌了：几次摸牌之内一定自摸。几种和了牌里先挑和出来满贯以上的、番多的（没役的和了牌不挑）
      const n = st.tenpaiDraws ?? 0;
      st.tenpaiDraws = n + 1;
      if (!g.rng.chance(YUKIKO.win[Math.min(n, YUKIKO.win.length - 1)])) return;
      const ranked = g
        .waits(seat)
        .map((k) => ({ k, v: tsumoValue(g, seat, k) }))
        .filter((x) => x.v !== null)
        .sort((a, b) => Number(b.v!.mangan) - Number(a.v!.mangan) || b.v!.han - a.v!.han);
      if (ranked.length === 0 || ranked.some(({ k }) => k === kindOf(next))) return;
      for (const { k } of ranked) if (to((t) => kindOf(t) === k)) return;
      const any = (t: TileId) => ranked.some(({ k }) => k === kindOf(t));
      if (!rinshan) w.bringDeadToLive(0, any, g.rng);
      return;
    }
    // 没听牌：换成有效进张，带宝牌的先挑
    const useful = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, p.melds.length);
      counts[kindOf(t)]--;
      return after < sh;
    };
    if (g.rng.chance(YUKIKO.drawLuck)) {
      if (useful(next) && isDoraTile(g, next)) return;
      if (to((t) => useful(t) && isDoraTile(g, t))) return;
      if (!useful(next) && to(useful)) return;
    }
    // 摸来的是没用的牌：手里宝牌不够就换成宝牌（本来就没用，换了不碍向听）
    const now = rinshan ? w.rinshan[0] : w.live[0];
    if (useful(now) || isDoraTile(g, now)) return;
    if (p.hand.filter((t) => isDoraTile(g, t)).length >= YUKIKO.dora) return;
    if (!to((t) => isDoraTile(g, t)) && !rinshan) w.bringDeadToLive(0, (t) => isDoraTile(g, t), g.rng);
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

  skill(g, seat) {
    const left = yukikoLeftUses(g, seat);
    const meter = { value: left, max: YUKIKO.uses, label: '左手' };
    if (stateOf(g, seat).left) {
      const p = g.players[seat];
      const tenpai = shanten(toCounts(p.hand), p.melds.length) <= 0;
      return { label: '左手', glyph: 'he', note: tenpai ? '左手：听牌了，几次摸牌之内自摸（立直和牌至少满贯）' : '左手：进张更顺，宝牌往手里来', enabled: false, active: true, meter };
    }
    const can = yukikoCanLeft(g, seat);
    const note = left <= 0 ? '左手这一场用过了' : can ? `换左手摸牌（一场 ${YUKIKO.uses} 次，什么时候按都行）` : `左手还没用（一场 ${YUKIKO.uses} 次）`;
    return { label: '左手', glyph: 'he', note, enabled: can, meter };
  },

  pressSkill(g, seat) {
    yukikoStartLeft(g, seat);
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
    return [left > 0 ? `左手还没用（一场 ${YUKIKO.uses} 次，对局中随时会按）` : '左手这一场用过了'];
  },
};

import type { Game } from '../engine/game';
import type { Rng } from '../engine/rng';
import { evaluateWin } from '../engine/score';
import { shanten } from '../engine/shanten';
import { EAST, KIND_COUNT, Kind, TileId, doraFromIndicator, isRed, kindOf, toCounts } from '../engine/tiles';
import { isDoraTile, kuroLost } from './kuro';
import { riiKeys } from './rii';
import { PRIORITY, type Ability, type BindKey, type DealRule } from './types';

// 鹤田姬子（新道寺）：只在白水哩拿到钥匙的那一局发动（别的局是普通人）。
// - 哪一局：团体赛里同队的哩在之前的位置拿到的钥匙，到姬子这一场同一个场、局、本场（Game.keys）；
//   哩和她同桌时（单局），哩拿到钥匙的下一局
// - 那一局她拿到一副能和出两倍番缚的牌（番缚 7 番是 14 番，算役满）：番数只靠役（不碰宝牌），门清自摸算进去。
//   做做样子，配牌是三向听，之后每一次摸牌都是要的牌，四五巡自摸
// - 同时压住所有人的进张：别人摸到会让向听前进的牌、她还要的牌全被换走。
//   这一局她压过所有人（Ability.supreme）：照、天照的神代、大安的丰音都挡不住，封印不了，佛灭也灭不掉；
//   别人的能力也动不了她。只有玄的宝牌照旧：玄摸宝牌不挡，玄配牌里的宝牌不换，她的牌也不碰宝牌
// - 别人的配牌也压住：至少 othersDeal 向听（天听、双立直之类的配牌做不出来）
// othersDeal：别人的配牌至少几向听（少了就换几张，最多 othersSwaps 张）
export const HIMEKO = { tries: 4000, dealShanten: 3, othersDeal: 3, othersSwaps: 4 };

interface Plan {
  han: number; // 要和出几番（番缚的两倍）
  final: Kind[]; // 和了时的 14 张
  win: Kind; // 最后自摸的那张
  deal: Kind[]; // 配牌的 13 张
}
interface HimekoState {
  plan?: Plan | null; // 这一局的牌（null 是没找到）
  announced?: boolean;
  held?: TileId[]; // 配牌时替她留在牌山里的牌（锁住，开始摸牌时解开）
}

const stateOf = (g: Game, seat: number) => g.abilityState[seat] as HimekoState;

// 这一局用的钥匙（没有是 null）。只看钥匙和局数，不看 g.active（会绕回 isSealed）
export function himekoKey(g: Game, seat: number): BindKey | null {
  const label = g.roundLabel();
  const carried = g.keys[seat]?.find((k) => !k.broken && k.label === label);
  if (carried) return carried;
  for (let s = 0; s < 4; s++) {
    if (s === seat || g.abilities[s]?.id !== 'rii') continue;
    const k = riiKeys(g, s).find((x) => !x.broken && x.round === g.round - 1);
    if (k) return k;
  }
  return null;
}

export function himekoPlan(g: Game, seat: number): Plan | null {
  return himekoKey(g, seat) ? (stateOf(g, seat).plan ?? null) : null;
}

// 还差哪些牌（按 plan.final 数，多出来的不算）
export function himekoMissing(g: Game, seat: number, plan: Plan): Kind[] {
  return himekoMissingFrom(g.players[seat].hand, plan);
}

function himekoMissingFrom(hand: TileId[], plan: Plan): Kind[] {
  const have = new Array<number>(KIND_COUNT).fill(0);
  for (const t of hand) have[kindOf(t)]++;
  const out: Kind[] = [];
  for (const k of plan.final) {
    if (have[k] > 0) have[k]--;
    else out.push(k);
  }
  return out;
}

// 手里哪些牌不是这副牌要的（电脑的姬子先打这些）
export function himekoExtra(g: Game, seat: number, plan: Plan): TileId[] {
  const want = new Array<number>(KIND_COUNT).fill(0);
  for (const k of plan.final) want[k]++;
  const out: TileId[] = [];
  for (const t of g.players[seat].hand) {
    if (want[kindOf(t)] > 0) want[kindOf(t)]--;
    else out.push(t);
  }
  return out;
}

const SUITS = [0, 1, 2];

// 随机拼一副 14 张的门清和牌（四面子一雀头或七对子），allowed 是能用的牌种
function randomHand(rng: Rng, allowed: (k: Kind) => boolean): Kind[] | null {
  const theme = rng.int(10);
  const counts = new Array<number>(KIND_COUNT).fill(0);
  const pool = (pred: (k: Kind) => boolean) => Array.from({ length: KIND_COUNT }, (_, k) => k).filter((k) => allowed(k) && pred(k));
  // 0：七对子；1–3：一门花色；4–5：一门花色加字牌；6–7：随便；8–9：对对（刻子多）
  const suit = SUITS[rng.int(3)];
  const inSet =
    theme >= 1 && theme <= 3 ? (k: Kind) => k < 27 && Math.floor(k / 9) === suit : theme >= 4 && theme <= 5 ? (k: Kind) => k >= 27 || Math.floor(k / 9) === suit : () => true;
  const kinds = pool(inSet);
  if (kinds.length === 0) return null;
  const pick = (list: Kind[]) => list[rng.int(list.length)];
  if (theme === 0) {
    const pairs = rng.shuffle(kinds).slice(0, 7);
    if (pairs.length < 7) return null;
    return pairs.flatMap((k) => [k, k]);
  }
  const koutsu = theme >= 8 ? 0.85 : theme >= 4 ? 0.35 : 0.2;
  const out: Kind[] = [];
  for (let i = 0; i < 4; i++) {
    if (rng.chance(koutsu)) {
      const k = pick(kinds);
      out.push(k, k, k);
    } else {
      const starts = kinds.filter((k) => k < 27 && k % 9 <= 6 && inSet(k + 1) && inSet(k + 2) && allowed(k + 1) && allowed(k + 2));
      if (!starts.length) return null;
      const k = pick(starts);
      out.push(k, k + 1, k + 2);
    }
  }
  const h = pick(kinds);
  out.push(h, h);
  for (const k of out) counts[k]++;
  if (counts.some((c) => c > 4)) return null;
  return out.sort((a, b) => a - b);
}

// 找一副只靠役（门清自摸）正好 han 番的牌；han 到 13 以上要役满。free[k] 是牌山里这种牌还能用几张
function composeHand(g: Game, seat: number, han: number, free: number[]): { final: Kind[]; win: Kind } | null {
  const dora = new Set(g.wall.visibleDoraIndicators().map((t) => doraFromIndicator(kindOf(t))));
  const allowed = (k: Kind) => !dora.has(k) && free[k] > 0;
  const fits = (r: { han: number; yakuman: number }) => (han >= 13 ? r.yakuman > 0 : r.yakuman === 0 && r.han === han);
  for (let i = 0; i < HIMEKO.tries; i++) {
    const final = randomHand(g.rng, allowed);
    if (!final) continue;
    const need = new Array<number>(KIND_COUNT).fill(0);
    for (const k of final) need[k]++;
    if (need.some((c, k) => c > free[k])) continue;
    // 牌 id：同种牌用不同的 id，避开赤五
    const used = new Array<number>(KIND_COUNT).fill(0);
    const closed = final.map((k) => k * 4 + 1 + (used[k]++ % 3));
    for (const win of g.rng.shuffle([...new Set(final)])) {
      const r = evaluateWin({
        closed,
        melds: [],
        winTile: closed[final.indexOf(win)],
        tsumo: true,
        seatWind: g.seatWind(seat),
        roundWind: EAST + g.roundWind,
        isDealer: seat === g.dealer,
        riichi: false,
        doubleRiichi: false,
        ippatsu: false,
        doraIndicators: g.wall.visibleDoraIndicators().map(kindOf),
      });
      if (r && fits(r)) return { final, win };
    }
  }
  return null;
}

// 配牌：从和了的牌里拿掉自摸的那张，再把几张换成不要的牌，凑出 dealShanten 向听（换三张凑不出来就多换一两张）
function dealFrom(g: Game, final: Kind[], win: Kind, free: number[]): Kind[] {
  const tenpai = final.slice();
  tenpai.splice(tenpai.indexOf(win), 1);
  const junkKinds = Array.from({ length: KIND_COUNT }, (_, k) => k).filter((k) => !final.includes(k) && free[k] > 0 && !isDoraKind(g, k));
  let best = tenpai;
  let bestSh = 0;
  for (let n = HIMEKO.dealShanten; n <= HIMEKO.dealShanten + 2; n++) {
    for (let i = 0; i < 100; i++) {
      const hand = tenpai.slice();
      const drop = g.rng.shuffle(hand.map((_, j) => j)).slice(0, n);
      const junk = g.rng.shuffle(junkKinds).slice(0, n);
      if (junk.length < n) return best;
      drop.forEach((j, m) => (hand[j] = junk[m]));
      const counts = new Array<number>(KIND_COUNT).fill(0);
      for (const k of hand) counts[k]++;
      const sh = shanten(counts, 0);
      if (sh === HIMEKO.dealShanten) return hand;
      if (sh > bestSh && sh < HIMEKO.dealShanten) {
        best = hand;
        bestSh = sh;
      }
    }
  }
  return best;
}

function isDoraKind(g: Game, k: Kind): boolean {
  return g.wall.visibleDoraIndicators().some((t) => doraFromIndicator(kindOf(t)) === k);
}

// 能拿来用的牌：不是赤五，不是宝牌，没被锁住
const usable = (g: Game, t: TileId) => !isRed(t) && !isDoraTile(g, t) && !g.wall.locked.has(t);

export const himekoAbility: Ability = {
  id: 'himeko',
  name: '钥匙',
  description: '白水哩拿到钥匙的那一局（团体赛里是同队的哩记下的那一个场、局、本场，同桌时是下一局），她拿到一副能和出两倍番缚的牌：配牌三向听，之后每一次摸牌都是要的牌。那一局所有人的进张都被压住，谁也挡不住（照和天照的神代也一样），只有玄的宝牌照旧。',
  priority: PRIORITY.himeko,

  supreme(g, seat) {
    return himekoKey(g, seat) !== null;
  },

  // 定下这一局的牌，并且立一条规矩护住自己的配牌（后动的人换不动）
  dealRules(g, seat) {
    const key = himekoKey(g, seat);
    if (!key) return;
    const free = new Array<number>(KIND_COUNT).fill(0);
    for (const t of g.wall.live) if (usable(g, t)) free[kindOf(t)]++;
    const found = composeHand(g, seat, key.bind * 2, free);
    const st = stateOf(g, seat);
    st.plan = found ? { han: key.bind * 2, ...found, deal: dealFrom(g, found.final, found.win, free) } : null;
    const plan = st.plan;
    // 别人的配牌不能少于 othersDeal 向听
    const rules: DealRule[] = [0, 1, 2, 3]
      .filter((s) => s !== seat)
      .map((target) => ({ seat, ability: 'himeko', text: '压制', target, bad: (hand: TileId[]) => Math.max(0, HIMEKO.othersDeal - shanten(toCounts(hand), 0)) }));
    if (!plan) return rules;
    return [
      ...rules,
      {
        seat,
        ability: 'himeko',
        text: '钥匙',
        target: seat,
        bad: (hand: TileId[]) => {
          const left = plan.deal.slice();
          for (const t of hand) {
            const j = left.indexOf(kindOf(t));
            if (j >= 0) left.splice(j, 1);
          }
          return left.length;
        },
      },
    ];
  },

  beforeDeal(g, seat) {
    if (!himekoKey(g, seat)) return;
    const plan = himekoPlan(g, seat);
    const planned = new Set(plan?.final ?? []);
    const w = g.wall;
    // 别人的配牌：少于 othersDeal 向听就换几张，换成让向听变差的牌（玄的宝牌不动，她要的牌不给）
    for (let s = 0; s < 4; s++) {
      if (s === seat) continue;
      const kuro = g.abilities[s]?.id === 'kuro';
      for (let n = 0; n < HIMEKO.othersSwaps; n++) {
        const idx = g.dealIndices(s);
        const counts = toCounts(idx.map((i) => w.live[i]));
        const sh = shanten(counts, 0);
        if (sh >= HIMEKO.othersDeal) break;
        let done = false;
        for (const i of g.rng.shuffle(idx)) {
          if (kuro && isDoraTile(g, w.live[i])) continue;
          const k = kindOf(w.live[i]);
          counts[k]--;
          const worse = (t: TileId) => {
            if (planned.has(kindOf(t)) || isDoraTile(g, t)) return false;
            counts[kindOf(t)]++;
            const after = shanten(counts, 0);
            counts[kindOf(t)]--;
            return after > sh;
          };
          done = w.bringToLive(i, worse, g.rng, (j) => j >= 52);
          counts[k]++;
          if (done) break;
        }
        if (!done) break;
      }
    }
    if (!plan) return;
    const mine = g.dealIndices(seat);
    const left = plan.deal.slice();
    const free: number[] = [];
    for (const i of mine) {
      const j = left.indexOf(kindOf(w.live[i]));
      if (j >= 0 && usable(g, w.live[i])) left.splice(j, 1);
      else free.push(i);
    }
    const others = (j: number) => !mine.includes(j);
    for (const i of free) {
      const k = left.shift();
      if (k === undefined) break;
      const ok = (t: TileId) => kindOf(t) === k && usable(g, t);
      if (!w.bringToLive(i, ok, g.rng, (j) => j >= 52)) w.bringToLive(i, ok, g.rng, others);
    }
    // 之后要摸的牌留在发完配牌以后的牌山里：在别人配牌里的换出来
    const rest = new Array<number>(KIND_COUNT).fill(0);
    for (let j = 52; j < w.live.length; j++) if (usable(g, w.live[j])) rest[kindOf(w.live[j])]++;
    const missing = himekoMissingFrom(mine.map((i) => w.live[i]), plan);
    for (const k of missing) {
      if (rest[k]-- > 0) continue;
      const at = w.live.findIndex((t, j) => j < 52 && !mine.includes(j) && kindOf(t) === k && usable(g, t));
      if (at >= 0) w.bringToLive(at, (t) => !planned.has(kindOf(t)), g.rng, (j) => j >= 52);
    }
    // 锁住，别人配牌、配牌后的技能拿不走；开始摸牌时解开
    const held: TileId[] = [];
    for (const k of missing) {
      const t = w.live.find((x, j) => j >= 52 && kindOf(x) === k && usable(g, x) && !held.includes(x));
      if (t !== undefined) held.push(t);
    }
    for (const t of held) w.locked.add(t, 'himeko');
    stateOf(g, seat).held = held;
  },

  onRoundStart(g, seat) {
    const st = stateOf(g, seat);
    for (const t of st.held ?? []) g.wall.locked.delete(t, 'himeko');
    st.held = [];
    if (!himekoKey(g, seat) || st.announced) return;
    st.announced = true;
    g.emit({ type: 'ability', seat, ability: 'himeko', text: '钥匙' });
  },

  // 别人的进张全压住：向听会前进的牌（听牌的是和了牌）、她还要的牌都摸不到。玄摸宝牌不挡
  beforeAnyDraw(g, seat, drawer) {
    if (drawer === seat || !himekoKey(g, seat)) return;
    const plan = himekoPlan(g, seat);
    const wanted = new Set(plan ? himekoMissing(g, seat, plan) : []);
    const p = g.players[drawer];
    const counts = new Array<number>(KIND_COUNT).fill(0);
    for (const t of p.hand) counts[kindOf(t)]++;
    const m = p.melds.length;
    const sh = shanten(counts, m);
    const kuro = g.abilities[drawer]?.id === 'kuro' && !kuroLost(g, drawer);
    return {
      seat,
      ability: 'himeko',
      text: '压制',
      deny: (t) => {
        if (kuro && isDoraTile(g, t)) return false;
        if (wanted.has(kindOf(t))) return true;
        counts[kindOf(t)]++;
        const better = shanten(counts, m) < sh;
        counts[kindOf(t)]--;
        return better;
      },
    };
  },

  // 每一次摸牌都是要的牌：先补缺的，自摸的那张留到最后
  beforeDraw(g, seat, rinshan) {
    const plan = himekoPlan(g, seat);
    if (!plan || rinshan) return;
    const missing = himekoMissing(g, seat, plan);
    if (!missing.length) return;
    const first = missing.filter((k) => k !== plan.win);
    const winLeft = missing.length - first.length;
    // 自摸的那张只缺一张时最后给；缺两张以上可以先给一张
    const now = first.length ? new Set(first) : new Set([plan.win]);
    if (first.length && winLeft > 1) now.add(plan.win);
    g.wall.bringToLive(0, (t) => now.has(kindOf(t)) && usable(g, t), g.rng);
  },

  badge(g, seat) {
    const key = himekoKey(g, seat);
    return key ? `钥匙·${key.bind * 2}番` : null;
  },

  insight(g, seat) {
    const key = himekoKey(g, seat);
    if (!key) return ['这一局没有钥匙，是普通人'];
    const plan = himekoPlan(g, seat);
    return [`哩在${key.label}缚了 ${key.bind} 番，这一局要和出 ${key.bind * 2} 番`, plan ? `还差 ${himekoMissing(g, seat, plan).length} 张` : '这一局的牌没凑出来', '所有人的进张都被压住'];
  },
};

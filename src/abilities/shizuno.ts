import type { Game } from '../engine/game';
import { shanten } from '../engine/shanten';
import { KIND_COUNT, Kind, TileId, doraFromIndicator, kindOf, toCounts } from '../engine/tiles';
import type { Ability } from './types';

// 高鸭稳乃（阿知贺）：深山。
// 牌局每进行一场（本场也算），她累计一个“深山”标记（东一局还是 0 个，第二局起有），一个半庄里只增不减。
// - 每个标记：别人的能力每次发动有 5% 的概率不起作用（配牌的规矩、调整配牌、摸牌前的规矩、自己摸牌的能力都算），
//   absolute 的（玄的宝牌、姬子拿到钥匙的那一局）和 immune 的（照）不受影响（Ability.dampens、Game.damped）
// - 每个标记：她自己配牌、进张顺利 5%（配牌换进让向听前进的牌，摸牌换成有效进张）
// - 满 6 个：宝牌、杠宝牌、里宝牌往对她有利的方向变（宝牌变成她手里最多的牌，别人手里的宝牌换走），
//   牌山上起一层白雾；之后每多 2 个，雾厚一级
// - 起雾以后（雾 L 级）还会干扰别人：
//   · 淡双立直的杠里：不受影响是中四张，雾越浓中得越少（期望 1 级 3 张、2 级 2 张、3 级 1 张、4 级 0 张，doraControl.mistUra）
//   · 别家立直和牌的里宝牌：每张有 mistUra[L] 的概率避开和牌那家的牌
//   · 衣的海底：安排好的海底牌，有 L × haiteiFog 的概率被雾遮住，这一局海底不归她（koromo.ts 里掷）
//   · 姬子拿钥匙的那一局：她的自摸晚 L 巡（前 L 次摸牌不给要的牌）。她的 supreme 照旧，挡不住和牌
export const SHIZUNO = {
  per: 0.05, // 每个标记的影响
  cap: 0.6, // 削弱别人最多到这么多（12 个标记）
  // 自己顺利：原定每个标记 5%，模拟下来一位率 82%（比照还强），压到 1.5%、最多 15%，听牌后摸和了牌再打三折
  selfPer: 0.015, // 每个标记自己顺利多少
  selfCap: 0.15, // 自己顺利最多到这么多
  tenpai: 0.3, // 听牌以后，换成和了牌的概率再乘这个（不然后半场几乎巡巡自摸）
  doraAt: 6, // 几个标记起控制宝牌、起雾
  mistStep: 2, // 之后每多几个标记雾厚一级
  mistMax: 4, // 雾最厚几级
  dealTries: 4, // 配牌最多换几张（每张按影响的概率换）
  mistUra: [0, 0.5, 0.65, 0.8, 0.95], // 雾 L 级时，别家立直和牌的每张里宝牌避开和牌那家的概率
  haiteiFog: 0.25, // 雾每一级让衣安排好的海底被遮住的概率
  himekoDelay: 1, // 雾每一级让姬子的自摸晚几巡
};

interface ShizunoGameState {
  reset?: number; // 被淡的平行宇宙清空时是第几局：那一局和之前的都不算
}

// 现在有几个深山标记：这一个半庄开过几局（发牌前算马上要开的那一局）减一，被平行宇宙清掉的不算
export function shizunoMarks(g: Game, seat: number): number {
  const round = g.phase === 'predeal' ? g.round + 1 : g.round;
  const reset = (g.abilityGameState[seat] as ShizunoGameState).reset;
  // 东一局还是 0 个（启动慢），之后每一局加一；被平行宇宙清掉以后下一局从 1 个重新数
  return Math.max(0, reset === undefined ? round - 1 : round - reset);
}

// 标记带来的影响（别人能力不起作用的概率，也是她自己顺利的概率）
export function shizunoPower(g: Game, seat: number): number {
  return Math.min(SHIZUNO.cap, shizunoMarks(g, seat) * SHIZUNO.per);
}

// 她自己配牌、进张顺利的概率
export function shizunoLuck(g: Game, seat: number): number {
  return Math.min(SHIZUNO.selfCap, shizunoMarks(g, seat) * SHIZUNO.selfPer);
}

// 能不能控制宝牌
export function shizunoDora(g: Game, seat: number): boolean {
  return shizunoMarks(g, seat) >= SHIZUNO.doraAt;
}

// 雾有几级（0 是没有雾）
export function shizunoMist(g: Game, seat: number): number {
  const m = shizunoMarks(g, seat);
  if (m < SHIZUNO.doraAt) return 0;
  return Math.min(SHIZUNO.mistMax, 1 + Math.floor((m - SHIZUNO.doraAt) / SHIZUNO.mistStep));
}

// 别家（seat 以外）起雾的稳乃里雾最浓的那一级（没有是 0）。被高维领域、巨引力源压住时雾也不起作用
export function shizunoMistOver(g: Game, seat: number): number {
  let best = 0;
  for (let s = 0; s < 4; s++) {
    if (s === seat || g.active(s)?.id !== 'shizuno' || g.quelled(s)) continue;
    best = Math.max(best, shizunoMist(g, s));
  }
  return best;
}

// 指示牌是 indicator 时宝牌是哪种
const isIndicatorOf = (want: Kind) => (t: TileId) => doraFromIndicator(kindOf(t)) === want;

// 宝牌变成哪种最好：她手里越多越好，别人手里越多越不好。从好到坏排
function bestDoraKinds(g: Game, mine: TileId[], others: TileId[]): Kind[] {
  const m = toCounts(mine);
  const o = toCounts(others);
  const score = (k: Kind) => m[k] * 4 - o[k];
  const kinds = Array.from({ length: KIND_COUNT }, (_, k) => k);
  const jitter = kinds.map(() => g.rng.next());
  return kinds.sort((a, b) => score(b) - score(a) || jitter[a] - jitter[b]);
}

// 她现在的牌（手牌和副露）、别人现在的手牌
function handsNow(g: Game, seat: number): { mine: TileId[]; others: TileId[] } {
  const p = g.players[seat];
  const mine = [...p.hand, ...p.melds.flatMap((m) => m.tiles)];
  const others = [0, 1, 2, 3].filter((s) => s !== seat).flatMap((s) => g.players[s].hand);
  return { mine, others };
}

// 把第 i 张指示牌（宝牌或里宝牌）换成指向 kinds 里最靠前、换得到的那种。已经指向前面的就不换
function steer(kinds: Kind[], current: TileId, bring: (pred: (t: TileId) => boolean) => boolean): void {
  const at = kinds.indexOf(doraFromIndicator(kindOf(current)));
  for (const k of kinds.slice(0, Math.min(at, 3))) if (bring(isIndicatorOf(k))) return;
}

// 玄的能力还在：宝牌和杠宝牌是她的，稳乃不动（里宝牌照样动）
const kuroHoldsDora = (g: Game, seat: number): boolean =>
  [0, 1, 2, 3].some((s) => s !== seat && g.abilities[s]?.id === 'kuro' && !!g.active(s) && !(g.abilityGameState[s] as { lost?: boolean }).lost);

// resetMarks 是淡的平行宇宙用的钩子（淡那边加进 Ability）；这里先自己声明，合并以后也不冲突
export const shizunoAbility: Ability & { resetMarks(g: Game, seat: number): void } = {
  id: 'shizuno',
  name: '深山',
  description: `被动。东一局没有标记，之后牌局每进行一场（本场也算）累计一个深山标记。每个标记让别人的能力每次发动有 ${SHIZUNO.per * 100}% 的概率不起作用，自己的配牌、进张顺利 ${Math.round(SHIZUNO.selfPer * 1000) / 10}%（别人最多受 ${SHIZUNO.cap * 100}% 影响，自己最多顺 ${SHIZUNO.selfCap * 100}%）。满 ${SHIZUNO.doraAt} 个起控制宝牌、杠宝牌、里宝牌：宝牌变成她手里最多的牌，别人该有的宝牌换走；牌山起雾，之后每多 ${SHIZUNO.mistStep} 个雾厚一级。起雾以后：淡的杠里雾越浓中得越少，别家立直和牌的里宝牌多半不中，衣的海底可能被雾遮住，姬子拿钥匙的那一局自摸晚几巡。`,

  // 平行宇宙：深山标记清零，这一局也不算（下一局从 1 个重新数）；雾跟着散掉
  resetMarks(g, seat) {
    (g.abilityGameState[seat] as ShizunoGameState).reset = g.round;
  },

  dampens(g, seat) {
    return shizunoPower(g, seat);
  },

  // 配牌：按影响的概率，把没用的牌换成让向听前进的牌（从发完牌以后的牌山里拿）；满 6 个以后定宝牌
  beforeDeal(g, seat) {
    const w = g.wall;
    const mine = g.dealIndices(seat);
    const p = shizunoLuck(g, seat);
    for (let n = 0; n < SHIZUNO.dealTries; n++) {
      if (!g.rng.chance(p)) continue;
      const counts = toCounts(mine.map((j) => w.live[j]));
      const cur = shanten(counts, 0);
      if (cur <= 0) break;
      // 拿掉以后向听不变差的牌里挑一张，换成让向听前进的
      const spare = g.rng.shuffle([...mine]).filter((i) => {
        const k = kindOf(w.live[i]);
        counts[k]--;
        const ok = shanten(counts, 0) === cur;
        counts[k]++;
        return ok;
      });
      for (const i of spare) {
        const k = kindOf(w.live[i]);
        counts[k]--;
        const better = (t: TileId) => {
          counts[kindOf(t)]++;
          const sh = shanten(counts, 0);
          counts[kindOf(t)]--;
          return sh < cur;
        };
        const done = w.bringToLive(i, better, g.rng, (j) => j >= 52);
        counts[k]++;
        if (done) break;
      }
    }
    // 涅莉押 3 点的局（别人的能力管不到她）不动开局宝牌，不然她定好的三倍满会被打乱
    const shielded = [0, 1, 2, 3].some((s) => s !== seat && !!g.abilities[s]?.shielded?.(g, s));
    if (shizunoDora(g, seat) && !kuroHoldsDora(g, seat) && !shielded) {
      // 宝牌指示牌还没翻开：换成指向她最多的牌。别人对配牌的规矩（比如姬子的“不碰宝牌”）不能因此变差
      const others = [0, 1, 2, 3].filter((s) => s !== seat).flatMap((s) => g.dealHand(s));
      const kinds = bestDoraKinds(g, g.dealHand(seat), others);
      const rules = g.dealRules.filter((r) => r.seat !== seat);
      const before = rules.map((r) => r.bad(g.dealHand(r.target)));
      const snapshot = { live: [...w.live], rinshan: [...w.rinshan], dora: [...w.doraIndicators], ura: [...w.uraIndicators] };
      steer(kinds, w.doraIndicators[0], (pred) => w.bringToDora(0, pred, g.rng, (j) => j >= 52));
      if (rules.some((r, i) => r.bad(g.dealHand(r.target)) > before[i])) {
        w.live = snapshot.live;
        w.rinshan = snapshot.rinshan;
        w.doraIndicators = snapshot.dora;
        w.uraIndicators = snapshot.ura;
      }
    }
  },

  onRoundStart(g, seat) {
    const m = shizunoMarks(g, seat);
    if (m === SHIZUNO.doraAt) g.emit({ type: 'ability', seat, ability: 'shizuno', text: '深山' });
    else if (m > SHIZUNO.doraAt && (m - SHIZUNO.doraAt) % SHIZUNO.mistStep === 0 && m - SHIZUNO.doraAt <= SHIZUNO.mistStep * (SHIZUNO.mistMax - 1)) {
      g.emit({ type: 'ability', seat, ability: 'shizuno', text: '雾更浓了' });
    }
  },

  // 摸牌：按影响的概率，下一张不是有效进张就换成有效进张（听牌时就是和了牌）
  beforeDraw(g, seat, rinshan) {
    const pl = g.players[seat];
    const counts = toCounts(pl.hand);
    const sh = shanten(counts, pl.melds.length);
    if (!g.rng.chance(shizunoLuck(g, seat) * (sh === 0 ? SHIZUNO.tenpai : 1))) return;
    const useful = (t: TileId) => {
      counts[kindOf(t)]++;
      const after = shanten(counts, pl.melds.length);
      counts[kindOf(t)]--;
      return after < sh;
    };
    if (rinshan) g.wall.bringToRinshan(useful, g.rng);
    else g.wall.bringToLive(0, useful, g.rng);
  },

  // 自己打完牌：没翻开的杠宝牌指示牌换成指向她最多的牌
  afterDiscard(g, seat) {
    if (!shizunoDora(g, seat) || kuroHoldsDora(g, seat)) return;
    const w = g.wall;
    const { mine, others } = handsNow(g, seat);
    const kinds = bestDoraKinds(g, mine, others);
    for (let i = w.doraRevealed; i < w.doraIndicators.length; i++) steer(kinds, w.doraIndicators[i], (pred) => w.bringToDora(i, pred, g.rng));
  },

  // 她立直和牌：翻开的里宝牌都换成指向她最多的牌（玄的能力还在时不调，见 doraControl）
  claimUra(g, seat, winTile) {
    if (!shizunoDora(g, seat)) return;
    const w = g.wall;
    const { mine, others } = handsNow(g, seat);
    if (winTile !== undefined) mine.push(winTile);
    const kinds = bestDoraKinds(g, mine, others);
    for (let i = 0; i < w.doraRevealed; i++) steer(kinds, w.uraIndicators[i], (pred) => w.bringToUra(i, pred, g.rng));
  },

  skill(g, seat) {
    const m = shizunoMarks(g, seat);
    const pct = Math.round(shizunoPower(g, seat) * 100);
    const luck = Math.round(shizunoLuck(g, seat) * 100);
    const extra = shizunoDora(g, seat) ? '，控制宝牌' : `，再 ${SHIZUNO.doraAt - m} 个控制宝牌`;
    return { label: '', note: `深山 ×${m}：别人能力 -${pct}%，自己 +${luck}%${extra}`, enabled: false, active: shizunoDora(g, seat), meter: { value: Math.min(m, 12), max: 12 } };
  },

  badge(g, seat) {
    return `深山×${shizunoMarks(g, seat)}`;
  },

  insight(g, seat) {
    const m = shizunoMarks(g, seat);
    const pct = Math.round(shizunoPower(g, seat) * 100);
    const luck = Math.round(shizunoLuck(g, seat) * 100);
    return [`深山 ${m} 个：别人的能力 ${pct}% 不起作用，自己配牌、进张顺利 ${luck}%`, shizunoDora(g, seat) ? `宝牌、杠宝牌、里宝牌往她有利的方向变（雾 ${shizunoMist(g, seat)} 级）` : `满 ${SHIZUNO.doraAt} 个起控制宝牌`];
  },
};

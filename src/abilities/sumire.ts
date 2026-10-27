import type { Game } from '../engine/game';
import { shanten, waitingKinds } from '../engine/shanten';
import { Kind, TileId, isHonor, kindOf, toCounts } from '../engine/tiles';
import { readTenpai } from './hiroe';
import type { Ability } from './types';

// 弘世堇（白糸台）：狙击手。每局开头瞄准一家（电脑瞄领先的那家；玩家操作时第一张打出去之前可以换），
// 她摸牌有 draw 的概率换成进张，快听牌时挑“听目标手里多余、迟早要打出来的牌”的那种。
// 电脑的堇：有役就默听，只和目标打的牌（自摸照和；牌山快摸完了才谁打的都和）。
// 被瞄准的人里，读得出牌的（洋榎、真子、睁眼的美穗子）和照察觉得到，不给她点（见 src/ai/ai.ts）
export const SUMIRE = {
  draw: 0.35,
  // 牌山剩这么多以内，电脑的堇谁打的都和
  anyRon: 8,
};

interface SumireState {
  target?: number;
}
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as SumireState;

// 这一局瞄准的是谁（没瞄、被封印是 null）
export function sumireTarget(g: Game, seat: number): number | null {
  if (g.active(seat)?.id !== 'sumire') return null;
  return stateOf(g, seat).target ?? null;
}

// 领先的那家（同分时从她下家起数先到的）
function leader(g: Game, seat: number): number {
  const others = [1, 2, 3].map((d) => (seat + d) % 4);
  return others.reduce((a, b) => (g.players[b].score > g.players[a].score ? b : a));
}

// 目标手里多余的牌（迟早要打出来）：孤立的单张——字牌单张，数牌单张且前后两格内没有同花色的牌
export function sumireMarks(g: Game, seat: number): Set<Kind> {
  const target = sumireTarget(g, seat);
  const out = new Set<Kind>();
  if (target === null) return out;
  const c = toCounts(g.players[target].hand);
  for (let k = 0; k < 34; k++) {
    if (c[k] !== 1) continue;
    if (isHonor(k)) {
      out.add(k);
      continue;
    }
    const n = k % 9;
    const near = [-2, -1, 1, 2].some((d) => n + d >= 0 && n + d <= 8 && c[k + d] > 0);
    if (!near) out.add(k);
  }
  return out;
}

// 打出去会被瞄着 seat 的堇荣和的牌种（她听牌了才有）
export function sumireAimedAt(g: Game, seat: number): Set<Kind> {
  const out = new Set<Kind>();
  for (let s = 0; s < 4; s++) {
    if (s === seat || sumireTarget(g, s) !== seat) continue;
    for (const k of readTenpai(g, s)?.ron ?? []) out.add(k);
  }
  return out;
}

// 13 张的手听不听得到 marks 里的牌
const aims = (counts: number[], melds: number, marks: Set<Kind>) => waitingKinds(counts, melds).some((k) => marks.has(k));

export const sumireAbility: Ability = {
  id: 'sumire',
  name: '狙击',
  description: `每局瞄准一家（玩家操作时第一张打出去之前可以换）。摸牌有 ${SUMIRE.draw * 100}% 的概率换成进张，快听牌时挑听目标手里多余牌的那种。读得出牌的人和宫永照被瞄准时察觉得到。`,

  // 发牌前就瞄好（不定配牌的规矩）
  dealRules(g, seat) {
    stateOf(g, seat).target = leader(g, seat);
  },

  onRoundStart(g, seat) {
    g.emit({ type: 'ability', seat, ability: 'sumire', text: '狙击' });
  },

  beforeDraw(g, seat, rinshan) {
    const target = sumireTarget(g, seat);
    if (rinshan || target === null || !g.rng.chance(SUMIRE.draw)) return;
    const p = g.players[seat];
    const counts = toCounts(p.hand);
    const m = p.melds.length;
    const sh = shanten(counts, m);
    if (sh <= 0) return;
    const marks = sumireMarks(g, seat);
    const good = new Set<Kind>();
    const aimed = new Set<Kind>();
    for (let k = 0; k < 34; k++) {
      if (counts[k] >= 4) continue;
      counts[k]++;
      if (shanten(counts, m) < sh) {
        good.add(k);
        // 摸了这张就听牌：有一种打法听的是目标多余的牌
        if (sh === 1) {
          for (let d = 0; d < 34; d++) {
            if (!counts[d]) continue;
            counts[d]--;
            const hit = shanten(counts, m) === 0 && aims(counts, m, marks);
            counts[d]++;
            if (hit) {
              aimed.add(k);
              break;
            }
          }
        }
      }
      counts[k]--;
    }
    const want = aimed.size ? aimed : good;
    if (!want.size || want.has(kindOf(g.wall.live[0]))) return;
    g.wall.bringToLive(0, (t: TileId) => want.has(kindOf(t)), g.rng);
  },

  // 玩家操作时：第一张打出去之前可以换目标
  skill(g, seat) {
    const target = sumireTarget(g, seat);
    if (target === null) return { label: '', note: '每局开头瞄准领先的那家', enabled: false };
    const canSwitch = g.players[seat].discards.length === 0 && g.manual[seat];
    return { label: '换目标', note: `瞄准：${g.players[target].name}${canSwitch ? '（打第一张之前可以换）' : ''}`, enabled: canSwitch, active: true };
  },

  pressSkill(g, seat) {
    const st = stateOf(g, seat);
    if (st.target === undefined || g.players[seat].discards.length > 0) return;
    st.target = (st.target + 1) % 4 === seat ? (st.target + 2) % 4 : (st.target + 1) % 4;
  },

  badge(g, seat) {
    const target = sumireTarget(g, seat);
    return target === null ? null : `瞄准·${g.players[target].name}`;
  },

  insight(g, seat) {
    const target = sumireTarget(g, seat);
    return [target === null ? '还没瞄准' : `瞄准 ${g.players[target].name}：只和这家打的牌`];
  },
};

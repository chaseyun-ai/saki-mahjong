import { describe, expect, it } from 'vitest';
import { CHARACTERS, type AiStyle } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { USUZAN_AI } from '../src/ai/usuzan';
import { Game, type RoundResult } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { kindOf, parseKinds, toCounts, type TileId } from '../src/engine/tiles';

// 有珠山的三个普通人（没有能力）：电脑照原作的性格打
const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const newGame = (seed: number, ids: string[]) => new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
// 不失误：同一个局面比两种打法
const sure = (style: AiStyle): AiStyle => ({ ...style, mistakeRate: 0 });

// 把这一家的手牌换成指定的牌：缺的从牌山、王牌、还没摆过牌的人手里换（不凭空造牌），张数要和现在的手牌一样
const fixed = new WeakMap<Game, Set<number>>();
function setHand(g: Game, seat: number, s: string): boolean {
  const want = parseKinds(s);
  const p = g.players[seat];
  expect(want.length).toBe(p.hand.length);
  const done = fixed.get(g) ?? new Set<number>();
  fixed.set(g, done);
  done.add(seat);
  const rest = [...p.hand];
  const keep: TileId[] = [];
  const need: number[] = [];
  for (const k of want) {
    const i = rest.findIndex((t) => kindOf(t) === k);
    if (i >= 0) keep.push(rest.splice(i, 1)[0]);
    else need.push(k);
  }
  const sources = [g.wall.live, g.wall.rinshan, g.wall.uraIndicators, ...g.players.filter((q) => !done.has(q.seat)).map((q) => q.hand)];
  for (const k of need) {
    const src = sources.find((a) => a.some((t) => kindOf(t) === k));
    if (!src) return false;
    const j = src.findIndex((t) => kindOf(t) === k);
    keep.push(src[j]);
    src[j] = rest.pop()!;
  }
  p.hand = keep;
  if (p.drawn !== null) p.drawn = keep[keep.length - 1];
  return true;
}

// 电脑打到轮到 seat 出牌（摸完牌）为止。这一局先结束了返回 false
function until(g: Game, ids: string[], seat: number): boolean {
  let n = 0;
  while (!(g.phase === 'turn' && g.turn === seat && g.players[seat].drawn !== null)) {
    if (g.phase === 'roundEnd' || g.phase === 'gameEnd' || ++n > 400) return false;
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
  return true;
}

// 座位 3 打出 tile，停在座位 0 要不要鸣的时候。mine：座位 0 的 13 张；摆不出来、座位 0 鸣不了时返回 null
function offer(seed: number, who: string, mine: string, tile: string, wallLeft?: number, south = false): Game | null {
  const ids = [who, 'izumi', 'izumi', 'izumi'];
  const g = newGame(seed, ids);
  if (!until(g, ids, 3)) return null;
  if (south) g.roundWind = 1;
  if (!setHand(g, 0, mine)) return null;
  // 座位 3 手里放进那一张（换掉最后一张），别人手里换成碰不了、和不了的散牌
  if (!setHand(g, 1, '1m4m7m1p4p7p1s4s7s1z2z3z4z')) return null;
  if (!setHand(g, 2, '2m5m8m2p5p8p2s5s8s5z6z7z9m')) return null;
  const p3 = g.players[3];
  const k = parseKinds(tile)[0];
  const kinds = p3.hand.map(kindOf);
  if (!kinds.includes(k)) {
    const src = g.wall.live.findIndex((t) => kindOf(t) === k && t !== g.wall.live[0]);
    if (src < 0) return null;
    const out = p3.hand.findIndex((t) => t !== p3.drawn);
    [p3.hand[out], g.wall.live[src]] = [g.wall.live[src], p3.hand[out]];
  }
  if (wallLeft !== undefined) g.wall.live.splice(0, g.wall.live.length - wallLeft);
  const t = p3.hand.find((x) => kindOf(x) === k)!;
  const discard = g.legalActions(3).find((a) => a.type === 'discard' && !a.riichi && a.tile === t);
  if (!discard) return null;
  g.act(3, discard);
  if (g.phase !== 'calls' || !g.waitingSeats().includes(0)) return null;
  return g;
}

describe('有珠山的普通人：桧森誓子', () => {
  // 1-3m 7-9p 4s6s 7s7s 2p3p 东：一向听，没役。吃 5s 就听牌（打东，听 1p4p），但还是没役
  const HAND = '123m789p46s77s23p1z';
  it('牌山快摸完、还没听牌：一鸣就听牌的就鸣（没役也鸣，凑形式听牌）；牌山还多时、一般人不鸣', () => {
    let tried = 0;
    for (let seed = 1; seed <= 12 && tried < 3; seed++) {
      const late = offer(seed, 'chikako', HAND, '5s', USUZAN_AI.formalWall - 2);
      if (!late) continue;
      tried++;
      expect(shanten(toCounts(late.players[0].hand), 0), `种子 ${seed}`).toBe(1);
      const a = chooseAction(late, 0, sure(byId('chikako').ai));
      expect(a.type, `种子 ${seed}`).toBe('chi');
      // 一般人（二条泉）没役不吃
      expect(chooseAction(late, 0, sure(byId('izumi').ai)).type, `种子 ${seed}`).toBe('pass');
      // 牌山还多：誓子也不吃
      const early = offer(seed, 'chikako', HAND, '5s');
      if (early) expect(chooseAction(early, 0, sure(byId('chikako').ai)).type, `种子 ${seed}`).toBe('pass');
    }
    expect(tried).toBeGreaterThan(0);
  });
});

describe('有珠山的普通人：岩馆摇杏', () => {
  // 全是中张、三向听：吃 4m 向听少一，有断幺九
  const HAND = '35m2p5p8p3s6s8s2m6m7p4s7s';
  it('一场还没和过：进了南场向听多也吃（求快和）；东场、和过牌以后照一般人打', () => {
    let tried = 0;
    for (let seed = 1; seed <= 12 && tried < 3; seed++) {
      const south = offer(seed, 'yuan', HAND, '4m', undefined, true);
      if (!south) continue;
      const cur = shanten(toCounts(south.players[0].hand), 0);
      expect(cur, `种子 ${seed}`).toBeGreaterThan(2);
      tried++;
      expect(chooseAction(south, 0, sure(byId('yuan').ai)).type, `种子 ${seed}`).toBe('chi');
      expect(chooseAction(south, 0, sure(byId('izumi').ai)).type, `种子 ${seed}`).toBe('pass');
      const east = offer(seed, 'yuan', HAND, '4m');
      if (east) expect(chooseAction(east, 0, sure(byId('yuan').ai)).type, `种子 ${seed}`).toBe('pass');
      // 这一场已经和过一次：不急了
      const after = offer(seed, 'yuan', HAND, '4m', undefined, true);
      if (after) {
        const won = { kind: 'win', wins: [{ seat: 0 }], tenpai: [false, false, false, false], deltas: [0, 0, 0, 0] } as unknown as RoundResult;
        after.events.unshift({ type: 'roundEnd', result: won });
        expect(chooseAction(after, 0, sure(byId('yuan').ai)).type, `种子 ${seed}`).toBe('pass');
      }
    }
    expect(tried).toBeGreaterThan(0);
  });
});

describe('有珠山的普通人：本内成香', () => {
  it('听了牌就推：同样的种子打整场，放铳比一般人（二条泉）多', () => {
    let naruka = 0;
    let plain = 0;
    for (let seed = 1; seed <= 10; seed++) {
      for (const who of ['naruka', 'izumi']) {
        const ids = [who, 'nodoka', 'yumi', 'toka'];
        const g = newGame(seed, ids);
        let steps = 0;
        while (g.phase !== 'gameEnd' && ++steps < 60000) {
          if (g.phase === 'roundEnd') {
            const r = g.roundResult!;
            const n = r.kind === 'win' ? r.wins.filter((w) => w.from === 0).length : 0;
            if (who === 'naruka') naruka += n;
            else plain += n;
            g.nextRound();
            continue;
          }
          const s = g.waitingSeats()[0];
          g.act(s, chooseAction(g, s, byId(ids[s]).ai));
        }
      }
    }
    expect(naruka).toBeGreaterThan(plain);
  }, 120000);
});

import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { HIROKO_NOTES } from '../src/abilities/hiroko';
import { isDoraTile } from '../src/abilities/kuro';
import { YUKIKO, yukikoAbility, yukikoLeft, yukikoLeftUses } from '../src/abilities/yukiko';
import { chooseAction } from '../src/ai/ai';
import { Game, type RoundResult } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';
import { SCHOOLS, membersOf } from '../src/ui/schools';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const newGame = (seed: number, ids: string[]) => new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });

// 电脑把一场打完。onPreDeal：停在发牌前时调（玩家操作的座位在这里选技能）
function play(g: Game, ids: string[], onPreDeal?: () => void): void {
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 60000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      onPreDeal?.();
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
}

// 左手的局：开局时她手里的宝牌张数、那一局怎么结束的
interface LeftRound {
  label: string;
  dealer: boolean;
  last2: boolean;
  low: boolean;
  dora: number;
  result?: RoundResult;
  riichi?: boolean;
  tenpaiDraws: number; // 听着牌摸了几次（不算和牌的那一次以后）
  missedThird: boolean; // 听着牌摸到第三次还没摸到和了牌，牌山、王牌里又明明还有
}

function watch(g: Game, seat: number): LeftRound[] {
  const out: LeftRound[] = [];
  let cur: LeftRound | null = null;
  let tenpaiBefore = false;
  g.onEvent((e) => {
    if (e.type === 'ability' && e.seat === seat && e.ability === 'yukiko' && e.text === '左手') {
      const hand = g.players[seat].hand;
      cur = {
        label: g.roundLabel(),
        dealer: g.dealer === seat && g.roundWind >= 1,
        last2: g.isLastRounds(2),
        low: false,
        dora: hand.filter((t) => isDoraTile(g, t)).length,
        tenpaiDraws: 0,
        missedThird: false,
      };
      out.push(cur);
    }
    if (!cur) return;
    if (e.type === 'draw' && e.seat === seat) {
      const p = g.players[seat];
      if (tenpaiBefore) {
        cur.tenpaiDraws++;
        const drawn = p.drawn!;
        const won = shanten(toCounts(p.hand), p.melds.length) === -1;
        // 第三次一定来：除非四张都已经看得见（牌河、副露、自己手里）
        if (cur.tenpaiDraws === 3 && !won) {
          const before = p.hand.filter((t) => t !== drawn);
          const c = toCounts(before);
          const live = [...g.wall.live, ...g.wall.rinshan, ...g.wall.uraIndicators].some((t) => {
            c[kindOf(t)]++;
            const ok = shanten(c, p.melds.length) === -1;
            c[kindOf(t)]--;
            return ok;
          });
          if (live) cur.missedThird = true;
        }
      }
    }
    if (e.type === 'discard' && e.seat === seat) {
      const p = g.players[seat];
      tenpaiBefore = shanten(toCounts(p.hand), p.melds.length) === 0;
    }
    if (e.type === 'roundEnd') {
      cur.result = e.result;
      cur.riichi = g.players[seat].riichi;
      cur = null;
      tenpaiBefore = false;
    }
  });
  return out;
}

describe('真屋由晖子：登记', () => {
  it('有珠山的五个人按先锋到大将排好；由晖子有能力，另外三个没有能力、各有一段介绍；浩子的资料本里有她', () => {
    const usuzan = SCHOOLS.find((s) => s.name === '有珠山高中')!;
    expect(usuzan.lineup).toEqual(['naruka', 'chikako', 'yuan', 'yukiko', 'sawaya']);
    expect(membersOf('有珠山高中').map((c) => c.id)).toEqual(['naruka', 'chikako', 'yuan', 'yukiko', 'sawaya']);
    const yukiko = byId('yukiko');
    expect(yukiko.ability).toBe(yukikoAbility);
    expect(yukiko.cost).toBe(3);
    expect(yukiko.ai.leftHand).toBe(true);
    expect(HIROKO_NOTES.yukiko).toBeTruthy();
    for (const id of ['naruka', 'chikako', 'yuan']) {
      const c = byId(id);
      expect(c.ability, id).toBeNull();
      expect(c.cost, id).toBe(1);
      expect(c.note, id).toBeTruthy();
    }
    expect(byId('naruka').ai.pushTenpai).toBe(true);
    expect(byId('chikako').ai.formalTenpai).toBe(true);
    expect(byId('chikako').ai.defensive).toBe(true);
    expect(byId('yuan').ai.yakitori).toBe(true);
  });
});

describe('真屋由晖子：左手', () => {
  it('玩家发牌前选了才用；那一局配牌带宝牌，一场只能用一次', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const ids = ['izumi', 'yukiko', 'izumi', 'izumi'];
      const g = newGame(seed, ids);
      g.manual[1] = true;
      const rounds = watch(g, 1);
      let asked = 0;
      play(g, ids, () => {
        asked++;
        const opt = yukikoAbility.preDeal!(g, 1).find((o) => o.id === 'left')!;
        const label = `种子 ${seed} ${g.roundLabel()}`;
        // 第二次停下来时选左手；之后就选不了了
        expect(opt.enabled, label).toBe(asked <= 2);
        expect(yukikoLeftUses(g, 1), label).toBe(asked <= 2 ? 1 : 0);
        yukikoAbility.setPreDeal!(g, 1, asked === 2 ? ['left'] : []);
      });
      expect(asked, `种子 ${seed}`).toBeGreaterThanOrEqual(2);
      expect(rounds.length, `种子 ${seed}`).toBe(1);
      expect(rounds[0].dora, `种子 ${seed} 配牌里的宝牌`).toBeGreaterThanOrEqual(YUKIKO.doraDeal);
      // 左手那一局以外不是左手
      expect(yukikoLeft(g, 1)).toBe(false);
    }
  }, 120000);

  it('电脑：南场坐庄、最后两局或者点数见底时用，一场最多一次；左手的局多半是她和，立直、荣和都至少满贯；听着牌第三次摸牌一定是和了牌', () => {
    let used = 0;
    let won = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const ids = ['yukiko', 'izumi', 'izumi', 'izumi'];
      const g = newGame(seed, ids);
      const lows: boolean[] = [];
      g.onEvent((e) => {
        if (e.type === 'ability' && e.text === '左手') lows.push(g.players[0].score < 10000);
      });
      const rounds = watch(g, 0);
      play(g, ids);
      expect(rounds.length, `种子 ${seed}`).toBeLessThanOrEqual(1);
      for (const [i, r] of rounds.entries()) {
        const label = `种子 ${seed} ${r.label}`;
        used++;
        expect(r.dealer || r.last2 || lows[i], label).toBe(true);
        expect(r.dora, label).toBeGreaterThanOrEqual(YUKIKO.doraDeal);
        expect(r.missedThird, label).toBe(false);
        const w = r.result?.kind === 'win' ? r.result.wins.find((x) => x.seat === 0) : undefined;
        if (!w) continue;
        won++;
        if (r.riichi || w.from !== null) expect(w.result.base, `${label} ${w.result.han} 番 ${w.result.fu} 符`).toBeGreaterThanOrEqual(2000);
      }
    }
    expect(used).toBeGreaterThanOrEqual(12);
    expect(won / used).toBeGreaterThan(0.7);
  }, 180000);
});

describe('真屋由晖子：整场', () => {
  it('和各种能力同桌打得完', () => {
    const others = CHARACTERS.filter((c) => c.ability && c.id !== 'yukiko').map((c) => c.id);
    for (let seed = 1; seed <= 6; seed++) {
      const pick = [0, 1, 2].map((i) => others[(seed * 7 + i * 11) % others.length]);
      const ids = ['yukiko', ...pick];
      const g = newGame(seed, ids);
      play(g, ids);
      expect(g.phase, `种子 ${seed} ${ids.join(',')}`).toBe('gameEnd');
    }
  }, 180000);
});

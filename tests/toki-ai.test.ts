import { describe, expect, it } from 'vitest';
import { CHARACTERS, type AiStyle, type Character } from '../src/abilities/characters';
import { dangerKinds } from '../src/abilities/hiroe';
import { chooseAction } from '../src/ai/ai';
import { cloneGame } from '../src/engine/clone';
import { Game, type Action } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';

// 电脑的怜照原作用一巡先见：
// 1. 看得到这一巡谁会荣和她打的牌，有别的牌可打时不打那些牌
// 2. 玩家操作的怜托管时不替玩家读铳牌（“看下一巡”要玩家自己点）

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 打一整场；每一步先问 look 再照电脑打
function play(seed: number, seats: Character[], manual: number | null, look: (g: Game, seat: number, a: Action) => void): void {
  const g = new Game({ seed, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: i === manual })) });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    const a = chooseAction(g, s, seats[s].ai);
    look(g, s, a);
    g.act(s, a);
  }
}

describe('电脑的怜', () => {
  it('看得到这一巡谁会荣和：有别的牌可打时不打铳牌', () => {
    const seats = ['toki', 'nodoka', 'saki', 'izumi'].map(byId);
    const toki = 0;
    let chances = 0;
    for (let seed = 1; seed <= 6; seed++) {
      play(seed, seats, null, (g, s, a) => {
        if (s !== toki || g.phase !== 'turn' || a.type !== 'discard' || g.players[toki].riichi || g.isSealed(toki)) return;
        const danger = dangerKinds(g, toki);
        if (!danger.size) return;
        const safe = g.legalActions(toki).filter((x) => x.type === 'discard' && !danger.has(kindOf(x.tile)));
        if (!safe.length) return;
        chances++;
        expect(danger.has(kindOf(a.tile))).toBe(false);
      });
    }
    // 真的遇到过有人听牌、手里有铳牌的局面
    expect(chances).toBeGreaterThan(20);
  }, 120000);

  it('玩家操作的怜托管时不读铳牌', () => {
    const seats = ['toki', 'nodoka', 'saki', 'izumi'].map(byId);
    const toki = 0;
    const blind: AiStyle = { ...seats[toki].ai, foresightRead: false };
    // 同一局面在两份复制品上问：读不读铳牌打出来一不一样（复制品各有一份随机数，问了不改原来的牌局）
    const differs = (g: Game) => JSON.stringify(chooseAction(cloneGame(g), toki, seats[toki].ai)) !== JSON.stringify(chooseAction(cloneGame(g), toki, blind));
    const count = (manual: number | null) => {
      let n = 0;
      for (let seed = 1; seed <= 3; seed++) {
        play(seed, seats, manual, (g, s) => {
          if (s === toki && g.phase === 'turn' && differs(g)) n++;
        });
      }
      return n;
    };
    // 电脑的怜：读了铳牌以后有时打得不一样
    expect(count(null)).toBeGreaterThan(0);
    // 玩家的怜：一样
    expect(count(toki)).toBe(0);
  }, 120000);
});

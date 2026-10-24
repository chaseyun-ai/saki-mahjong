import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game, GameEvent } from '../src/engine/game';
import { foresee } from '../src/ui/foresee';

// 怜“看下一巡”看到的，和真的往下打一巡发生的一模一样（只要她不鸣牌）
describe('看下一巡', () => {
  it('预见的一巡和实际打出来的一致', () => {
    let checked = 0;
    let dealIns = 0;
    let calls = 0;
    for (const seed of [3, 17, 2024]) {
      const g = new Game({ seed, players: CHARACTERS.map((c) => ({ name: c.name, ability: c.ability })) });
      const ai = CHARACTERS.map((c) => c.ai);
      const toki = CHARACTERS.findIndex((c) => c.id === 'toki');
      const log: GameEvent[] = [];
      g.onEvent((e) => log.push(e));
      let watch: { from: number; steps: ReturnType<typeof foresee>['steps'] } | null = null;
      const settle = () => {
        if (!watch) return;
        const real = log.slice(watch.from).flatMap((e): object[] =>
          e.type === 'discard'
            ? [{ kind: 'discard', seat: e.seat, tile: e.tile, riichi: e.riichi }]
            : e.type === 'call'
              ? [{ kind: 'call', seat: e.seat, call: e.call }]
              : e.type === 'ability'
                ? [{ kind: 'ability', seat: e.seat, text: e.text }]
                : e.type === 'draw' && e.seat === toki
                  ? [{ kind: 'draw', tile: g.players[toki].drawn }]
                  : e.type === 'roundEnd'
                    ? [{ kind: 'end', result: e.result }]
                    : [],
        );
        expect(real).toEqual(watch.steps.filter((s) => s.kind !== 'canRon'));
        checked++;
        watch = null;
      };
      for (let guard = 0; guard < 20000 && g.phase !== 'gameEnd'; guard++) {
        if (g.phase === 'roundEnd') {
          settle();
          g.nextRound();
          continue;
        }
        if (g.phase === 'turn') {
          if (g.turn === toki) settle();
          const a = chooseAction(g, g.turn, ai[g.turn]);
          if (g.turn === toki && a.type === 'discard') {
            const v = foresee(g, toki, a.tile, !!a.riichi, ai);
            if (v.dealIn) dealIns++;
            if (v.called) calls++;
            watch = { from: log.length, steps: v.steps };
          }
          g.act(g.turn, a);
          continue;
        }
        // 和牌局一样：电脑先回应，怜一律不鸣
        for (const s of g.waitingSeats()) if (s !== toki) g.act(s, chooseAction(g, s, ai[s]));
        if (g.phase === 'calls' && g.waitingSeats().includes(toki)) g.act(toki, { type: 'pass' });
      }
    }
    expect(checked).toBeGreaterThan(50);
    // 至少碰到过被鸣牌的情况，说明不只是简单的摸打
    expect(calls).toBeGreaterThan(0);
    expect(dealIns).toBeGreaterThanOrEqual(0);
  });

  it('不碰真的牌局', () => {
    const g = new Game({ seed: 9, players: CHARACTERS.map((c) => ({ name: c.name, ability: c.ability })) });
    const ai = CHARACTERS.map((c) => c.ai);
    const before = JSON.stringify({ p: g.players, w: g.wall.live, e: g.events.length, r: g.rng });
    let fired = 0;
    g.onEvent(() => fired++);
    const seat = g.turn;
    const tile = g.players[seat].hand[0];
    foresee(g, seat, tile, false, ai);
    expect(JSON.stringify({ p: g.players, w: g.wall.live, e: g.events.length, r: g.rng })).toBe(before);
    expect(fired).toBe(0);
  });
});

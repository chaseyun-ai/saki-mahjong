import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { POSITIONS, TEAM_START, TIERS, TeamRun, aiPick, draftPool, snakeOrder } from '../src/team/team';

// 一整场团体赛，全部电脑打。返回每场打了几局
function runTeam(seed: number) {
  const run = new TeamRun(seed, 0);
  while (run.drafting) {
    const team = run.picker()!;
    if (run.teams[team].human) run.pick(team, aiPick(run.available(), new Rng(seed)).id);
    else run.aiPick();
  }
  const rounds: number[] = [];
  while (!run.over) {
    const seats = run.seating();
    const chars = seats.map((t) => run.teams[t].lineup[run.pos]);
    const g = new Game({
      seed: seed * 10 + run.pos,
      format: 'team',
      scores: seats.map((t) => run.teams[t].points),
      riichiSticks: run.riichiSticks,
      players: chars.map((c) => ({ name: c.name, ability: c.ability })),
    });
    let steps = 0;
    while (g.phase !== 'gameEnd' && ++steps < 40000) {
      if (g.phase === 'roundEnd') {
        g.nextRound();
        continue;
      }
      const s = g.waitingSeats()[0];
      g.act(s, chooseAction(g, s, chars[s].ai));
    }
    expect(g.phase).toBe('gameEnd');
    rounds.push(g.round);
    // 南 4 局之前没人被打飞就不会结束
    if (g.players.every((p) => p.score >= 0)) expect(g.roundWind).toBe(1);
    run.finish(seats, g.players.map((p) => p.score), g.riichiSticks);
    expect(run.teams.reduce((a, t) => a + t.points, 0) + run.riichiSticks * 1000).toBe(TEAM_START * 4);
  }
  return { run, rounds };
}

describe('团体赛', () => {
  it('每一档凑满四人（不够的用替补），费用就是档位', () => {
    const pool = draftPool();
    for (const tier of TIERS) {
      expect(pool.get(tier)!.length).toBeGreaterThanOrEqual(4);
      for (const c of pool.get(tier)!) expect(c.cost).toBe(tier);
    }
    for (const c of CHARACTERS) expect(TIERS).toContain(c.cost);
  });

  it('蛇形选人：5 费按开局顺序，4 费倒过来，3 费再正过来', () => {
    const first = [2, 0, 3, 1];
    expect(snakeOrder(first, 5)).toEqual([2, 0, 3, 1]);
    expect(snakeOrder(first, 4)).toEqual([1, 3, 0, 2]);
    expect(snakeOrder(first, 3)).toEqual([2, 0, 3, 1]);
    const run = new TeamRun(7, 1);
    // 没轮到的队选不了
    const wrong = [0, 1, 2, 3].find((t) => t !== run.picker())!;
    expect(run.pick(wrong, run.available()[0].id)).toBe(false);
    const seen: number[][] = [];
    while (run.drafting) {
      if (run.turn === 0) seen.push(run.order());
      const team = run.picker()!;
      if (run.teams[team].human) expect(run.aiPick()).toBeNull();
      if (run.teams[team].human) run.pick(team, run.available().at(-1)!.id);
      else run.aiPick();
    }
    expect(seen).toEqual(TIERS.map((t) => snakeOrder(run.first, t)));
    const ids = run.teams.flatMap((t) => t.picks.map((c) => c.id));
    expect(new Set(ids).size).toBe(20);
    for (const t of run.teams) {
      expect(t.picks.map((c) => c.cost)).toEqual(TIERS);
      expect(t.lineup.length).toBe(POSITIONS.length);
    }
  });

  it('五个位置打完半庄，点数接力、守恒，没人被飞就打到南 4', async () => {
    for (let seed = 1; seed <= 3; seed++) {
      const { run, rounds } = runTeam(seed);
      const bust = run.teams.some((t) => t.points < 0);
      if (!bust) expect(run.pos).toBe(POSITIONS.length);
      for (const r of rounds) expect(r).toBeGreaterThanOrEqual(1);
      expect(run.history.length).toBe(run.pos);
      await new Promise((r) => setTimeout(r, 0));
    }
  }, 300000);
});

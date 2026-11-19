import { describe, expect, it } from 'vitest';
import { POSITIONS, TEAM_START, TeamRun } from '../src/team/team';
import { advance, advancers, createBracket, halfOf, lineupOf, myOut, myTable, PLAYABLE_SCHOOLS, reportMine, retryMine, roundDone, roundTables, setResult, tableSim, VIRTUAL_SCHOOLS } from '../src/story/bracket';
import { bracketHtml } from '../src/story/bracketView';
import { TeamSim } from '../src/story/teamSim';

const MINE = '清澄高中';

// 不真打的快速结果：按桌上顺序给点数（第一位最多）
const fake = (order: number[]) => {
  const pts = [130000, 110000, 90000, 70000];
  const out = [0, 0, 0, 0];
  order.forEach((i, k) => (out[i] = pts[k]));
  return out;
};

// 整届走完：别桌和玩家那桌都用假结果（玩家那桌每次都第一）
const playOut = (seed: number, mine = MINE) => {
  const b = createBracket(seed, mine);
  while (!b.champion) {
    for (const t of roundTables(b)) if (!t.result) setResult(b, t, fake(t.schools.includes(b.mine) ? [t.schools.indexOf(b.mine), ...[0, 1, 2, 3].filter((i) => i !== t.schools.indexOf(b.mine))] : [0, 1, 2, 3]));
    advance(b);
  }
  return b;
};

describe('全国大赛晋级表（东西两区，全部抽签）', () => {
  it('13 所原作学校 + 3 所虚拟学校抽进东西两区各 8 校、每区两桌', () => {
    expect(PLAYABLE_SCHOOLS).toHaveLength(13);
    for (let seed = 1; seed < 30; seed++) {
      const b = createBracket(seed, MINE);
      const first = roundTables(b, 0);
      expect(first).toHaveLength(4);
      const all = first.flatMap((t) => t.schools);
      expect(new Set(all).size).toBe(16);
      for (const v of VIRTUAL_SCHOOLS) expect(all).toContain(v.name);
      expect(first.filter((t) => t.half === 0)).toHaveLength(2);
      expect(first.filter((t) => t.half === 1)).toHaveLength(2);
      expect(myTable(b)!.schools).toContain(MINE);
      for (const s of all) expect(b.entrants[s].lineup).toHaveLength(5);
    }
  });

  it('抽签跟着种子走；虚拟学校会被抽进两个区', () => {
    expect(createBracket(7, MINE).tables).toEqual(createBracket(7, MINE).tables);
    const halves = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const b = createBracket(seed, MINE);
      for (const v of VIRTUAL_SCHOOLS) halves.add(`${v.name}:${halfOf(b, v.name)}`);
    }
    for (const v of VIRTUAL_SCHOOLS) {
      expect(halves).toContain(`${v.name}:0`);
      expect(halves).toContain(`${v.name}:1`);
    }
  });

  it('上场的人：原作学校是自己的五个人，虚拟学校是五个没有能力的电脑', () => {
    const b = createBracket(3, MINE);
    expect(lineupOf(b, MINE).map((c) => c.id)).toEqual(['yuuki', 'mako', 'hisa', 'nodoka', 'saki']);
    const v = lineupOf(b, VIRTUAL_SCHOOLS[0].name);
    expect(v).toHaveLength(POSITIONS.length);
    expect(v.every((c) => c.ability === null)).toBe(true);
  });

  it('别桌真打：五个位置打完（或有队被打飞），点数加起来不超过 40 万，种子一样结果一样', () => {
    const b = createBracket(5, MINE);
    const t = roundTables(b).find((x) => !x.schools.includes(MINE))!;
    const a = tableSim(b, t).runAll();
    expect(a).toEqual(tableSim(b, t).runAll());
    const total = a.reduce((x, y) => x + y, 0);
    expect(total).toBeLessThanOrEqual(TEAM_START * 4);
    expect(total).toBeGreaterThan(TEAM_START * 4 - 20000);
    // 一点一点算和一口气算结果一样
    const s = tableSim(b, t);
    while (!s.step(3));
    expect(s.points).toEqual(a);
    expect(s.history.length).toBeGreaterThan(0);
    expect(s.history.length === POSITIONS.length || s.points.some((p) => p < 0)).toBe(true);
  }, 60000);

  it('玩家那桌交真比赛的点数；输了重打只清自己这桌，别桌不动', () => {
    const b = createBracket(5, MINE);
    for (const t of roundTables(b)) if (!t.schools.includes(MINE)) setResult(b, t, fake([0, 1, 2, 3]));
    const others = roundTables(b).filter((t) => t !== myTable(b)).map((t) => t.result);
    const t = myTable(b)!;
    const me = t.schools.indexOf(MINE);
    reportMine(b, t.schools.map((_, i) => (i === me ? 40000 : 120000)));
    expect(myOut(b)).toBe(true);
    retryMine(b);
    expect(myTable(b)!.result).toBeNull();
    expect(b.retries).toBe(1);
    expect(roundTables(b).filter((x) => x !== myTable(b)).map((x) => x.result)).toEqual(others);
    expect(() => advance(b)).toThrow();
    reportMine(b, t.schools.map((_, i) => (i === me ? 160000 : 80000)));
    advance(b);
    expect(b.round).toBe(1);
    expect(myTable(b)!.schools).toContain(MINE);
  });

  it('半区决赛各是本区两桌的前两名，总决赛东西各两校，决出冠军', () => {
    for (let seed = 1; seed < 20; seed++) {
      const b = playOut(seed);
      const [east, west] = [0, 1].map((h) => roundTables(b, 1).find((t) => t.half === h)!);
      for (const [semi, h] of [[east, 0], [west, 1]] as const) {
        const firsts = roundTables(b, 0).filter((t) => t.half === h);
        expect(new Set(semi.schools)).toEqual(new Set(firsts.flatMap(advancers)));
      }
      const fin = roundTables(b, 2)[0];
      expect(fin.half).toBeNull();
      expect(new Set(fin.schools)).toEqual(new Set([...advancers(east), ...advancers(west)]));
      expect(b.champion).toBe(MINE);
      expect(roundDone(b)).toBe(true);
    }
  });

  it('团体赛画面用的阵容：preset 跳过选人，玩家是自己的学校', () => {
    const b = createBracket(2, MINE);
    const t = myTable(b)!;
    const run = TeamRun.preset(1, t.schools.map((s) => ({ name: b.entrants[s].short, color: b.entrants[s].color, lineup: lineupOf(b, s) })), t.schools.indexOf(MINE));
    expect(run.drafting).toBe(false);
    expect(run.teams[run.human].lineup.map((c) => c.id)).toEqual(lineupOf(b, MINE).map((c) => c.id));
    expect(run.teams.every((x) => x.points === TEAM_START)).toBe(true);
  });

  it('画面：东区、总决赛、西区，玩家那一行高亮，后台在打的桌写进行中', () => {
    const b = createBracket(9, MINE);
    const other = roundTables(b).find((t) => !t.schools.includes(MINE))!;
    const html = bracketHtml(b, new Set(), new Map([[other.name, '中坚战']]));
    expect(html.match(/class="bk-half/g)).toHaveLength(2);
    expect(html).toContain('bk-final');
    expect(html).toContain('bk-row is-wait mine');
    expect(html).toContain('进行中 · 中坚战');
  });

  it('TeamSim 被打飞立刻结束', () => {
    const b = createBracket(4, MINE);
    const sim = new TeamSim(roundTables(b)[0].schools.map((s) => lineupOf(b, s)), 1);
    sim.runAll();
    expect(sim.done).toBe(true);
    if (sim.points.some((p) => p < 0)) expect(sim.history.length).toBeLessThanOrEqual(POSITIONS.length);
  }, 60000);
});

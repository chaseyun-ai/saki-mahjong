import { describe, expect, it } from 'vitest';
import { TEAM_START } from '../src/team/team';
import { advance, advancers, createBracket, MY_SCHOOL, myOut, myTable, reportMine, retryMine, roundDone, roundTables, simulateMine, simulateOthers } from '../src/story/bracket';
import { bracketHtml } from '../src/story/bracketView';

const playOut = (seed: number) => {
  const b = createBracket(seed);
  while (!b.champion) {
    if (!myTable(b)) {
      simulateOthers(b);
    } else {
      simulateMine(b);
      simulateOthers(b);
      if (myOut(b)) {
        retryMine(b);
        continue;
      }
    }
    advance(b);
  }
  return b;
};

describe('全国大赛晋级表（方案 A）', () => {
  it('16 所学校分 4 桌，A 桌是原作的清澄、姬松、永水、宫守，我校在 B/C/D 桌', () => {
    for (let seed = 1; seed < 30; seed++) {
      const b = createBracket(seed);
      const first = roundTables(b, 0);
      expect(first).toHaveLength(4);
      const all = first.flatMap((t) => t.schools);
      expect(new Set(all).size).toBe(16);
      expect(first[0].schools).toEqual(['清澄高中', '姬松高中', '永水女子', '宫守女子']);
      expect(all.filter((s) => s === MY_SCHOOL)).toHaveLength(1);
      expect(myTable(b)!.name).not.toBe('A 桌');
      for (const s of all) expect(b.entrants[s].lineup).toHaveLength(5);
    }
  });

  it('抽签结果跟着种子走，不同种子我校会抽到不同的桌', () => {
    expect(myTable(createBracket(7))!.name).toBe(myTable(createBracket(7))!.name);
    const seen = new Set(Array.from({ length: 40 }, (_, i) => myTable(createBracket(i + 1))!.name));
    expect(seen.size).toBe(3);
  });

  it('一桌的点数总和不变，前两名晋级', () => {
    const b = createBracket(3);
    simulateMine(b);
    simulateOthers(b);
    expect(roundDone(b)).toBe(true);
    for (const t of roundTables(b)) {
      expect(t.result!.points.reduce((a, x) => a + x, 0)).toBe(TEAM_START * 4);
      const sorted = [...t.result!.points].sort((x, y) => y - x);
      expect(t.result!.order.map((i) => t.result!.points[i])).toEqual(sorted);
      expect(advancers(t)).toHaveLength(2);
    }
  });

  it('存档读档后接着算，结果和不存档一样', () => {
    const a = createBracket(11);
    const b = JSON.parse(JSON.stringify(a));
    simulateMine(a);
    simulateOthers(a);
    const c = JSON.parse(JSON.stringify(b));
    simulateMine(c);
    simulateOthers(c);
    expect(c.tables.map((t: { result: unknown }) => t.result)).toEqual(a.tables.map((t) => t.result));
  });

  it('我校这桌交真比赛的点数；输了重打只清我校这桌，别桌不动', () => {
    const b = createBracket(5);
    simulateOthers(b);
    const others = roundTables(b).filter((t) => t !== myTable(b)).map((t) => t.result);
    const t = myTable(b)!;
    const me = t.schools.indexOf(MY_SCHOOL);
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
    expect(myTable(b)!.schools).toContain(MY_SCHOOL);
  });

  it('三轮打完决出冠军；半决赛两桌、决赛一桌都是四校', () => {
    for (let seed = 1; seed < 20; seed++) {
      const b = playOut(seed);
      expect(roundTables(b, 1)).toHaveLength(2);
      expect(roundTables(b, 2)).toHaveLength(1);
      for (const t of [...roundTables(b, 1), ...roundTables(b, 2)]) expect(new Set(t.schools).size).toBe(4);
      expect(b.champion).toBeTruthy();
    }
  });

  it('强校更常出线：白糸台进半决赛的比例比小校高', () => {
    let teru = 0;
    let minor = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = createBracket(seed);
      simulateMine(b);
      simulateOthers(b);
      advance(b);
      const semi = roundTables(b, 1).flatMap((t) => t.schools);
      if (semi.includes('白糸台高中')) teru++;
      if (semi.includes('越谷女子')) minor++;
    }
    expect(teru).toBeGreaterThan(minor * 2);
  });

  it('画面里有三列，我校那一行高亮', () => {
    const b = createBracket(9);
    const html = bracketHtml(b);
    expect(html.match(/class="bk-col/g)).toHaveLength(3);
    expect(html).toContain('bk-row wait mine');
    expect(html).not.toContain('data-pick');
  });
});

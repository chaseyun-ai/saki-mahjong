import { describe, expect, it } from 'vitest';
import { HanchanSim, SOLO_START } from '../src/story/hanchanSim';
import {
  advance,
  charOf,
  createLeague,
  FINAL_TABLE,
  FINALISTS,
  inFinal,
  type League,
  myTable,
  netOf,
  PLAYERS,
  PRELIM_ROUNDS,
  prelimStandings,
  reportMine,
  retryMine,
  roundDone,
  roundTables,
  setResult,
  SOLO_ROSTER,
  type SoloTable,
  standingOf,
  standings,
  tableSim,
  TOTAL_ROUNDS,
} from '../src/story/league';

// 不真打的快速结果：桌上第一个人最多，加起来 10 万
const fake = (order: number[]) => {
  const pts = [48300, 31200, 16000, 4500];
  const out = [0, 0, 0, 0];
  order.forEach((i, k) => (out[i] = pts[k]));
  return out;
};

// 整届走完：每桌用假结果（play 决定每桌名次）
const playOut = (l: League, play: (l: League, t: SoloTable) => number[] = () => fake([0, 1, 2, 3])) => {
  while (!l.podium) {
    for (const t of roundTables(l)) if (!t.scores) setResult(t, play(l, t));
    advance(l);
  }
  return l;
};

describe('全国大赛个人赛（瑞士轮 + 决赛桌）', () => {
  it('32 人：13 校各两人加 6 名虚拟选手；第 1 轮 8 桌不重不漏，同校不同桌', () => {
    expect(SOLO_ROSTER).toHaveLength(26);
    for (let seed = 1; seed < 40; seed++) {
      const l = createLeague(seed, 'saki');
      expect(l.players).toHaveLength(PLAYERS);
      expect(l.players.filter((p) => p.minor)).toHaveLength(6);
      const first = roundTables(l);
      expect(first).toHaveLength(8);
      const all = first.flatMap((t) => t.seats);
      expect(new Set(all).size).toBe(PLAYERS);
      for (const t of first) expect(new Set(t.seats.map((p) => l.players[p].school)).size).toBe(4);
      expect(l.players[l.mine].id).toBe('saki');
    }
    expect(createLeague(7, 'saki').tables).toEqual(createLeague(7, 'saki').tables);
  });

  it('挑名单外的人：顶掉最后一名虚拟选手；同校三个人照样分开坐', () => {
    for (let seed = 1; seed < 20; seed++) {
      const l = createLeague(seed, 'hisa');
      expect(l.mine).toBe(PLAYERS - 1);
      expect(l.players[l.mine].id).toBe('hisa');
      expect(l.players.filter((p) => p.school === '清澄高中')).toHaveLength(3);
      expect(l.players.filter((p) => p.minor)).toHaveLength(5);
      for (const t of roundTables(l)) expect(new Set(t.seats.map((p) => l.players[p].school)).size).toBe(4);
    }
    expect(() => createLeague(1, 'nobody')).toThrow();
  });

  it('上场的人：原作角色照角色表，虚拟选手没有能力', () => {
    const l = createLeague(3, 'saki');
    expect(charOf(l, l.mine).ability?.id).toBe('saki');
    const v = l.players.findIndex((p) => p.minor);
    expect(charOf(l, v).ability).toBeNull();
    expect(charOf(l, v).note).toContain('没有能力');
  });

  it('积分：（终局点数 − 25000）÷ 1000，每桌加起来是 0；按积分 1–4 名一桌、5–8 名一桌分下一轮', () => {
    const l = createLeague(11, 'nodoka');
    for (const t of roundTables(l)) setResult(t, fake([0, 1, 2, 3]));
    for (const t of roundTables(l)) expect(t.seats.reduce((a, p) => a + netOf(t, p)!, 0)).toBe(0);
    advance(l);
    const order = prelimStandings(l).map((s) => s.p);
    const second = roundTables(l);
    expect(second).toHaveLength(8);
    second.forEach((t, i) => expect(t.seats).toEqual(order.slice(i * 4, i * 4 + 4)));
    // 第一轮的 8 个第一名都是 +23.3，挤在 A、B 两桌
    expect(second[0].seats.every((p) => standingOf(l, p).total === 23300)).toBe(true);
  });

  it('同分比单场最高的终局点数，再比费用', () => {
    const l = createLeague(2, 'saki');
    const [a, b] = roundTables(l);
    // a 桌第一个人 +10.0（35000），b 桌第一个人也 +10.0 但……这里给同样的 35000；费用高的在前
    setResult(a, [35000, 25000, 20000, 20000]);
    setResult(b, [35000, 25000, 20000, 20000]);
    const x = a.seats[0];
    const y = b.seats[0];
    const sx = prelimStandings(l).findIndex((s) => s.p === x);
    const sy = prelimStandings(l).findIndex((s) => s.p === y);
    const cx = l.players[x].cost;
    const cy = l.players[y].cost;
    if (cx !== cy) expect(sx < sy).toBe(cx > cy);
    // 单场最高分高的排前面：c 桌 +10.0 但是两场凑的
    const l2 = createLeague(2, 'saki');
    for (const t of roundTables(l2)) setResult(t, fake([0, 1, 2, 3]));
    advance(l2);
    const s = prelimStandings(l2);
    expect(s[0].total).toBe(23300);
    expect(s[0].best).toBe(48300);
  });

  it('重打只清自己这桌，别桌不动；这一场没打完不能往下走', () => {
    const l = createLeague(5, 'saki');
    for (const t of roundTables(l)) if (t !== myTable(l)) setResult(t, fake([0, 1, 2, 3]));
    const others = roundTables(l).filter((t) => t !== myTable(l)).map((t) => t.scores);
    const t = myTable(l)!;
    const me = t.seats.indexOf(l.mine);
    reportMine(l, fake([...[0, 1, 2, 3].filter((i) => i !== me), me]));
    expect(standingOf(l, l.mine).total).toBe(4500 - SOLO_START);
    retryMine(l);
    expect(myTable(l)!.scores).toBeNull();
    expect(l.retries).toBe(1);
    expect(roundTables(l).filter((x) => x !== myTable(l)).map((x) => x.scores)).toEqual(others);
    expect(roundDone(l)).toBe(false);
    expect(() => advance(l)).toThrow();
    reportMine(l, fake([me, ...[0, 1, 2, 3].filter((i) => i !== me)]));
    advance(l);
    expect(l.round).toBe(1);
    expect(myTable(l)!.seats).toContain(l.mine);
  });

  it('预赛 6 轮后前 4 名进决赛桌，积分清零再打两场；预赛第一在决赛垫底就拿不到冠军', () => {
    const l = createLeague(8, 'saki');
    let lead = -1;
    playOut(l, (lg, t) => {
      if (t.round < PRELIM_ROUNDS) return fake([0, 1, 2, 3]);
      // 决赛：预赛第一（finalists[0]）两场都是第四
      lead = lg.finalists![0];
      const k = t.seats.indexOf(lead);
      return fake([...[0, 1, 2, 3].filter((i) => i !== k), k]);
    });
    expect(l.round).toBe(TOTAL_ROUNDS);
    expect(l.finalists).toHaveLength(FINALISTS);
    const pre = prelimStandings(l).slice(0, FINALISTS).map((s) => s.p);
    expect(l.finalists).toEqual(pre);
    const finals = l.tables.filter((t) => t.round >= PRELIM_ROUNDS);
    expect(finals).toHaveLength(2);
    for (const t of finals) {
      expect(t.name).toBe(FINAL_TABLE);
      expect(new Set(t.seats)).toEqual(new Set(l.finalists));
    }
    expect(l.podium).toHaveLength(FINALISTS);
    expect(l.podium![3]).toBe(lead);
    expect(new Set(l.podium)).toEqual(new Set(l.finalists));
    // 总名次：决赛 4 人在前，其余照预赛
    const all = standings(l).map((s) => s.p);
    expect(all.slice(0, 4)).toEqual(l.podium);
    expect(all.slice(4)).toEqual(prelimStandings(l).filter((s) => !l.finalists!.includes(s.p)).map((s) => s.p));
    expect(standingOf(l, lead).final).toBe(2 * (4500 - SOLO_START));
  });

  it('玩家没进决赛：决赛照样打完；进了决赛：两场都在玩家那桌', () => {
    const out = playOut(createLeague(4, 'saki'), (lg, t) => {
      const k = t.seats.indexOf(lg.mine);
      return k < 0 ? fake([0, 1, 2, 3]) : fake([...[0, 1, 2, 3].filter((i) => i !== k), k]);
    });
    expect(inFinal(out)).toBe(false);
    expect(myTable(out, PRELIM_ROUNDS)).toBeNull();
    expect(out.podium).toHaveLength(4);
    const win = playOut(createLeague(4, 'saki'), (lg, t) => {
      const k = t.seats.indexOf(lg.mine);
      return k < 0 ? fake([0, 1, 2, 3]) : fake([k, ...[0, 1, 2, 3].filter((i) => i !== k)]);
    });
    expect(inFinal(win)).toBe(true);
    expect(myTable(win, PRELIM_ROUNDS)).not.toBeNull();
    expect(myTable(win, PRELIM_ROUNDS + 1)).not.toBeNull();
    expect(win.podium![0]).toBe(win.mine);
  });

  it('存档：JSON 来回一趟一样', () => {
    const l = playOut(createLeague(6, 'teru'));
    const back = JSON.parse(JSON.stringify(l)) as League;
    expect(standings(back)).toEqual(standings(l));
  });

  it('真打一个半庄：点数加起来 10 万，种子一样结果一样，一点一点算和一口气算一样', () => {
    const l = createLeague(5, 'saki');
    const t = roundTables(l)[0];
    const a = tableSim(l, t).runAll();
    expect(a.reduce((x, y) => x + y, 0)).toBe(4 * SOLO_START);
    expect(tableSim(l, t).runAll()).toEqual(a);
    const s = tableSim(l, t);
    while (!s.step(3));
    expect(s.scores).toEqual(a);
    expect(s.label).toBe('打完了');
    // 重打换种子
    expect(tableSim(l, t, 1).seed).not.toBe(tableSim(l, t).seed);
    expect(new HanchanSim(t.seats.map((p) => charOf(l, p)), 1).label).toBe('东 1 局');
  }, 60000);
});

describe('个人赛积分榜画面', () => {
  it('8 桌 + 32 人积分榜，决赛线在第 4 名下面，自己那一行高亮，后台在打的桌写进行中', async () => {
    const { soloHtml, fmtPts } = await import('../src/story/soloView');
    const l = createLeague(9, 'saki');
    const other = roundTables(l).find((t) => !t.seats.includes(l.mine))!;
    const html = soloHtml(l, new Set(), new Map([[other.name, '南 2 局']]));
    expect(html.match(/data-solo-table=/g)).toHaveLength(8);
    expect(html.match(/<div class="r[ "]/g)).toHaveLength(PLAYERS);
    expect(html.match(/class="ip-cut"/g)).toHaveLength(1);
    expect(html).toContain('<div class="r mine">');
    expect(html).toContain('进行中 · 南 2 局');
    expect(html).toContain('你在这桌');
    expect([fmtPts(23300), fmtPts(-9000), fmtPts(0)]).toEqual(['+23.3', '−9.0', '±0.0']);
    // 打完一整届：决赛桌一桌，写冠军
    playOut(l);
    const end = soloHtml(l);
    expect(end.match(/data-solo-table=/g)).toHaveLength(1);
    expect(end).toContain('冠军');
    expect(end).toContain('颁奖');
  });
});

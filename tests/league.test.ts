import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
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
  simulateOthers,
  SOLO_SEEDS,
  type SoloTable,
  standingOf,
  standings,
  tableSim,
  TOTAL_ROUNDS,
} from '../src/story/league';
import { bubbleHint, isFocus, latestNews, roundNews, tableTags } from '../src/story/news';

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
  it('32 人：8 名种子必定参赛，其余抽签、每届不一样；第 1 轮 8 桌不重不漏，同校不同桌', () => {
    expect(SOLO_SEEDS).toHaveLength(8);
    const rosters = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      const l = createLeague(seed, 'saki');
      expect(l.players).toHaveLength(PLAYERS);
      expect(new Set(l.players.map((p) => p.id)).size).toBe(PLAYERS);
      for (const id of SOLO_SEEDS) expect(l.players.find((p) => p.id === id)?.seed).toBe(true);
      expect(l.players.filter((p) => p.seed)).toHaveLength(8);
      expect(l.players.some((p) => p.minor)).toBe(false);
      const first = roundTables(l);
      expect(first).toHaveLength(8);
      const all = first.flatMap((t) => t.seats);
      expect(new Set(all).size).toBe(PLAYERS);
      for (const t of first) expect(new Set(t.seats.map((p) => l.players[p].school)).size).toBe(4);
      expect(l.players[l.mine].id).toBe('saki');
      rosters.add(l.players.map((p) => p.id).sort().join());
    }
    expect(rosters.size).toBeGreaterThan(50);
    expect(createLeague(7, 'saki').tables).toEqual(createLeague(7, 'saki').tables);
    expect(createLeague(7, 'saki').players).toEqual(createLeague(7, 'saki').players);
  });

  it('挑种子以外的人：她一定参赛；每个角色都能报名', () => {
    for (let seed = 1; seed < 20; seed++) {
      const l = createLeague(seed, 'hisa');
      expect(l.players[l.mine].id).toBe('hisa');
      expect(l.players[l.mine].seed).toBe(false);
      expect(l.players.filter((p) => p.seed)).toHaveLength(8);
      for (const t of roundTables(l)) expect(new Set(t.seats.map((p) => l.players[p].school)).size).toBe(4);
    }
    for (const c of CHARACTERS) expect(createLeague(3, c.id).players[createLeague(3, c.id).mine].id).toBe(c.id);
    expect(() => createLeague(1, 'nobody')).toThrow();
  });

  it('上场的人照角色表；旧存档里的虚拟选手是没有能力的电脑', () => {
    const l = createLeague(3, 'saki');
    expect(charOf(l, l.mine).ability?.id).toBe('saki');
    l.players[5] = { id: 'npc-solo-越谷-甲', name: '越谷·甲', school: '越谷女子', short: '越谷', color: '#8a8f99', cost: 1, minor: true };
    expect(charOf(l, 5).ability).toBeNull();
    expect(charOf(l, 5).note).toContain('没有能力');
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

describe('个人赛的场外信息：和牌记录、赛事快报、对局词条、卡线', () => {
  it('真打的桌记下每一局的和牌，存进这一桌', () => {
    const l = createLeague(21, 'saki');
    simulateOthers(l);
    const done = roundTables(l).filter((t) => t.scores);
    expect(done).toHaveLength(7);
    const hands = done.flatMap((t) => t.hands ?? []);
    expect(hands.length).toBeGreaterThan(20);
    for (const h of hands) {
      expect(h.win).toBeGreaterThanOrEqual(0);
      expect(h.win).toBeLessThan(4);
      expect(h.from).not.toBe(h.win);
      expect(h.gain).toBeGreaterThan(0);
      expect(h.yaku.length).toBeGreaterThan(0);
    }
    // 存档来回一趟还在
    expect((JSON.parse(JSON.stringify(l)) as League).tables[0].hands).toEqual(l.tables[0].hands);
  }, 120000);

  it('快报：役满排最前，一桌最多两条；击飞、种子垫底、三连一位都会写', () => {
    const l = createLeague(4, 'saki');
    const [a, b] = roundTables(l);
    const yakuman = { round: '南 4 局', win: 1, from: 2, gain: 32000, han: 13, limit: '役满', yaku: ['四暗刻'] };
    const big = { round: '东 2 局', win: 0, from: -1, gain: 24000, han: 11, limit: '三倍满', yaku: ['立直', '门前清自摸和', '清一色'] };
    const haitei = { round: '南 3 局', win: 3, from: -1, gain: 8000, han: 5, limit: '满贯', yaku: ['海底捞月', '立直'] };
    setResult(a, [20000, 60000, -2000, 22000], [yakuman, big]);
    // a 桌三条（役满、三倍满、击飞）只留两条；b 桌也有人被击飞
    setResult(b, [-1000, 30000, 26000, 45000], [haitei]);
    for (const t of roundTables(l)) if (!t.scores) setResult(t, fake([0, 1, 2, 3]));
    const news = roundNews(l, 0);
    expect(news.length).toBeLessThanOrEqual(4);
    expect(news[0].text).toContain('役满');
    expect(news[0].text).toContain('四暗刻');
    expect(news.filter((n) => n.table === a.name).length).toBeLessThanOrEqual(2);
    expect(roundNews(l, 0, 20).filter((n) => n.table === a.name).length).toBe(2);
    expect(roundNews(l, 0, 20).some((n) => n.table === b.name && n.text.includes('击飞'))).toBe(true);
    expect(roundNews(l, 0, 20).some((n) => n.text.includes('海底捞月'))).toBe(true);
    // 三连一位：假结果每桌第一个座位拿一位，积分榜第一一直坐 A 桌第一个座位
    const s = createLeague(5, 'saki');
    for (let r = 0; r < 3; r++) {
      for (const t of roundTables(s)) setResult(t, fake([0, 1, 2, 3]));
      if (r < 2) advance(s);
    }
    expect(roundNews(s, 2, 20).some((n) => n.text.includes('三连一位'))).toBe(true);
    expect(latestNews(s)?.round).toBe(2);
  });

  it('词条：同门内战、死亡之组、复仇之战；焦点桌是第 3 轮起的 A 桌和决赛桌', () => {
    const l = createLeague(6, 'saki');
    const school = (p: number) => l.players[p].school;
    const seeds = l.players.map((p, i) => (p.seed ? i : -1)).filter((i) => i >= 0 && i !== l.mine);
    const mate = l.players.findIndex((p, i) => i !== seeds[0] && p.school === school(seeds[0]));
    const others = l.players.map((_, i) => i).filter((i) => !l.players[i].seed && school(i) !== school(seeds[0]) && i !== l.mine);
    const t1: SoloTable = { round: 1, name: 'B 桌', seats: [seeds[0], mate >= 0 ? mate : others[0], others[1], others[2]], scores: null };
    if (mate >= 0) expect(tableTags(l, t1).map((x) => x.label)).toContain('同门内战');
    // 一桌两对同校（白糸台的照和淡、临海的涅莉和智叶都是种子）只挂一个词条，说明里两对都写
    const at = (id: string) => l.players.findIndex((p) => p.id === id);
    const two: SoloTable = { round: 1, name: 'E 桌', seats: ['teru', 'awai', 'nelly', 'satoha'].map(at), scores: null };
    const same = tableTags(l, two).filter((x) => x.label === '同门内战');
    expect(same).toHaveLength(1);
    expect(same[0].note.split('；')).toHaveLength(2);
    const t2: SoloTable = { round: 1, name: 'C 桌', seats: [seeds[0], seeds[1], seeds[2], others[3]], scores: null };
    expect(tableTags(l, t2).map((x) => x.label)).toContain('死亡之组');
    // 复仇：第 1 轮压过玩家的人，第 2 轮又同桌
    const mine = myTable(l)!;
    for (const t of roundTables(l)) setResult(t, t === mine ? fake([...[0, 1, 2, 3].filter((k) => t.seats[k] !== l.mine), t.seats.indexOf(l.mine)]) : fake([0, 1, 2, 3]));
    const rival = mine.seats.find((p) => p !== l.mine)!;
    const t3: SoloTable = { round: 1, name: 'D 桌', seats: [l.mine, rival, others[4], others[5]], scores: null };
    const tags = tableTags(l, t3);
    expect(tags.map((x) => x.label)).toContain('复仇之战');
    expect(tags.find((x) => x.label === '复仇之战')!.note).toContain(l.players[rival].name);
    expect(isFocus({ round: 1, name: 'A 桌', seats: [], scores: null })).toBe(false);
    expect(isFocus({ round: 2, name: 'A 桌', seats: [], scores: null })).toBe(true);
    expect(isFocus({ round: 3, name: 'B 桌', seats: [], scores: null })).toBe(false);
    expect(isFocus({ round: 6, name: FINAL_TABLE, seats: [], scores: null })).toBe(true);
  });

  it('卡线提示：只在预赛最后两轮、自己这一场还没打时出；在线下写要多少，线上写守住多少', () => {
    const l = createLeague(8, 'nodoka');
    for (let r = 0; r < PRELIM_ROUNDS - 2; r++) {
      expect(bubbleHint(l)).toBeNull();
      for (const t of roundTables(l)) setResult(t, fake([0, 1, 2, 3]));
      advance(l);
    }
    const hint = bubbleHint(l)!;
    expect(hint).toContain('最后两场加起来');
    const s = prelimStandings(l);
    const place = s.findIndex((x) => x.p === l.mine) + 1;
    expect(hint).toContain(`第 ${place} 名`);
    expect(hint).toContain(place <= FINALISTS ? '守得住' : '大概要');
    for (const t of roundTables(l)) setResult(t, fake([0, 1, 2, 3]));
    expect(bubbleHint(l)).toBeNull();
    advance(l);
    expect(bubbleHint(l)).toContain('这一场');
  });
});

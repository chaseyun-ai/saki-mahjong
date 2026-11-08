import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GbInput, GbMeldType, gbFan } from '../src/engine/gbFan';
import { parseKinds } from '../src/engine/tiles';

// 标准答案由 scripts/gen-gb-fixtures.py 用 PyMahjongGB 生成，格式见那个脚本开头
type Row = [string, string, string, string, number, number, number, string];
const rows: Row[] = JSON.parse(readFileSync(new URL('./fixtures/gb-fan.json', import.meta.url), 'utf8'));
const B36 = '0123456789abcdefghijklmnopqrstuvwx';
const MELD: Record<string, GbMeldType> = { c: 'chi', p: 'pon', m: 'minkan', a: 'ankan' };
const NAME: Record<string, string> = { '独听・边张': '边张', '独听・嵌张': '坎张', '独听・单钓': '单钓将' };

function input(r: Row): GbInput {
  const melds = [];
  for (let i = 0; i < r[1].length; i += 2) melds.push({ type: MELD[r[1][i]], kind: B36.indexOf(r[1][i + 1]) });
  return {
    hand: [...r[0]].map((ch) => B36.indexOf(ch)),
    melds,
    win: B36.indexOf(r[2]),
    tsumo: r[3].includes('t'),
    fourth: r[3].includes('f'),
    kong: r[3].includes('k'),
    last: r[3].includes('l'),
    seat: r[4],
    round: r[5],
  };
}

function fans(r: Row): string {
  return r[7]
    .split(' ')
    .filter(Boolean)
    .map((f) => {
      const [name, n] = f.split('×');
      return `${NAME[name] ?? name}×${n}`;
    })
    .sort()
    .join(' ');
}

function hand(closed: string, win: string, opts: Partial<GbInput> = {}): GbInput {
  return { hand: parseKinds(closed), melds: [], win: parseKinds(win)[0], tsumo: false, seat: 1, round: 0, ...opts };
}

describe('国标算番', () => {
  it(`${rows.length} 手标准答案的合计番数全对`, () => {
    const wrong: string[] = [];
    for (const r of rows) {
      const got = gbFan(input(r));
      if (got?.total !== r[6]) wrong.push(`${JSON.stringify(r)} → ${got?.total}`);
    }
    expect(wrong.slice(0, 5)).toEqual([]);
  });

  it('番种也基本一致（番数一样的拆法挑法可以不同）', () => {
    let same = 0;
    for (const r of rows) {
      const got = gbFan(input(r))!;
      const names = got.fans.map((f) => `${f.name}×${f.count}`).sort().join(' ');
      if (names === fans(r)) same++;
    }
    expect(same / rows.length).toBeGreaterThan(0.995);
  });

  it('一色三步高荣和 21 番，日麻里却无役', () => {
    const r = gbFan(hand('123234345m678p99s', '9s'))!;
    expect(r.total).toBe(21);
    expect(r.fans.map((f) => f.name)).toContain('一色三步高');
    expect(gbFan(hand('123234345m678p99s', '9s', { tsumo: true }))!.total).toBe(23);
  });

  it('只听一种时才算边张、坎张、单钓将', () => {
    expect(gbFan(hand('123m456p789s234s55z', '3m'))!.fans.map((f) => f.name)).toContain('边张');
    // 两面听不算
    expect(gbFan(hand('234m456p789s234s55z', '4m'))!.fans.map((f) => f.name)).not.toContain('边张');
  });

  it('没有任何番是无番和', () => {
    const r = gbFan({
      hand: parseKinds('234m567p11z456s'),
      melds: [{ type: 'pon', kind: parseKinds('8s')[0] }],
      win: parseKinds('4m')[0],
      tsumo: false,
      seat: 1,
      round: 0,
    })!;
    expect(r.fans.map((f) => f.name)).toEqual(['无番和']);
    expect(r.total).toBe(8);
  });

  it('不是和牌形返回 null', () => {
    expect(gbFan(hand('123456m789p23s11z5s', '5s'))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { Meld, MeldType } from '../src/engine/score';
import { kindName, kindOf, parseTiles } from '../src/engine/tiles';
import { MeldSlot, meldLayout } from '../src/ui/meldLayout';

// own：自己出的牌，called：叫来的牌，from：从哪个座位叫的
function meld(type: MeldType, own: string, called: string, from: number): Meld {
  const ids = parseTiles(own + called);
  const tile = ids[ids.length - 1];
  return { type, tiles: ids, calledTile: tile, from };
}

// 摆好的样子写成字：横着的牌带括号，扣着的写 #，叠在上面的写在 ^ 后面
const show = (slots: MeldSlot[]) =>
  slots
    .map((s) => {
      const name = s.hidden ? '#' : kindName(kindOf(s.tile));
      const top = s.stacked !== undefined ? `^${kindName(kindOf(s.stacked))}` : '';
      return s.sideways ? `(${name}${top})` : name;
    })
    .join(' ');

describe('副露摆法', () => {
  it('吃：叫来的牌横在最左，自己的两张从小到大', () => {
    // 座位 0 的上家是座位 3
    expect(show(meldLayout(meld('chi', '45m', '3m', 3), 0))).toBe('(3m) 4m 5m');
    expect(show(meldLayout(meld('chi', '53m', '4m', 3), 0))).toBe('(4m) 3m 5m');
    expect(show(meldLayout(meld('chi', '34m', '5m', 3), 0))).toBe('(5m) 3m 4m');
  });

  it('碰：上家最左，对家中间，下家最右', () => {
    expect(show(meldLayout(meld('pon', '77z', '7z', 3), 0))).toBe('(7z) 7z 7z');
    expect(show(meldLayout(meld('pon', '77z', '7z', 2), 0))).toBe('7z (7z) 7z');
    expect(show(meldLayout(meld('pon', '77z', '7z', 1), 0))).toBe('7z 7z (7z)');
  });

  it('换个座位也按相对位置算', () => {
    // 座位 2 的上家是 1，对家是 0，下家是 3
    expect(show(meldLayout(meld('pon', '11z', '1z', 1), 2))).toBe('(1z) 1z 1z');
    expect(show(meldLayout(meld('pon', '11z', '1z', 0), 2))).toBe('1z (1z) 1z');
    expect(show(meldLayout(meld('pon', '11z', '1z', 3), 2))).toBe('1z 1z (1z)');
  });

  it('明杠：对家的横在左数第二张', () => {
    expect(show(meldLayout(meld('minkan', '111z', '1z', 3), 0))).toBe('(1z) 1z 1z 1z');
    expect(show(meldLayout(meld('minkan', '111z', '1z', 2), 0))).toBe('1z (1z) 1z 1z');
    expect(show(meldLayout(meld('minkan', '111z', '1z', 1), 0))).toBe('1z 1z 1z (1z)');
  });

  it('加杠：加的那张叠在横着的那张上面', () => {
    const m = meld('pon', '55p', '5p', 2);
    m.type = 'kakan';
    m.tiles.push(parseTiles('0p')[0]); // 第四张是赤五
    const slots = meldLayout(m, 0);
    expect(show(slots)).toBe('5p (5p^5p) 5p');
    expect(new Set([...slots.map((s) => s.tile), slots[1].stacked]).size).toBe(4);
  });

  it('暗杠：四张一排，两头扣着', () => {
    const m: Meld = { type: 'ankan', tiles: parseTiles('3333s').reverse() };
    expect(show(meldLayout(m, 0))).toBe('# 3s 3s #');
  });

  it('赤五和普通五一起排，每张牌只出现一次', () => {
    const m = meld('chi', '06p', '4p', 3);
    const slots = meldLayout(m, 0);
    expect(show(slots)).toBe('(4p) 5p 6p');
    expect(slots.map((s) => s.tile).sort((a, b) => a - b)).toEqual([...m.tiles].sort((a, b) => a - b));
  });
});

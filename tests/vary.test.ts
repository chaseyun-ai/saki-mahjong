import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCARD, NORMAL_STYLES, RIICHI_STYLES, roomNeeded } from '../src/ui3d/discardMotion';
import { POND_LOOKS, POND_SHIFT_X, POND_TWIST, Vary, paceOf, pickDiscardStyle, pondJitter, vary, varyDiscard } from '../src/ui/vary';
import { TILE_H } from '../src/ui3d/tableLayout';

// table3d.ts 里牌河牌之间的缝
const POND_GAP = 0.04;

describe('随机微变化', () => {
  it('关掉时原样返回基准值', () => {
    const v = new Vary();
    v.reset(1, false);
    expect(v.jitter(550, 0.1)).toBe(550);
    expect(v.think(550, paceOf('yuuki'))).toBe(550);
    expect(v.pick('click', 3)).toBe(0);
    vary.reset(1, false);
    expect(varyDiscard(DEFAULT_DISCARD)).toBe(DEFAULT_DISCARD);
    // 牌河歪不歪不跟这个开关走，看牌河摆放的设置：整齐就是一点不歪
    expect(pondJitter(5, 17, 'neat')).toEqual({ yaw: 0, dx: 0, dz: 0 });
  });

  it('同一个种子得到同一串变化', () => {
    const a = new Vary();
    const b = new Vary();
    a.reset(42, true);
    b.reset(42, true);
    for (let i = 0; i < 20; i++) expect(a.think(620, paceOf(''))).toBe(b.think(620, paceOf('')));
  });

  it('浮动不超过给的幅度，平均还在原值附近', () => {
    const v = new Vary();
    v.reset(7, true);
    let sum = 0;
    for (let i = 0; i < 5000; i++) {
      const x = v.jitter(100, 0.1);
      expect(x).toBeGreaterThanOrEqual(90);
      expect(x).toBeLessThanOrEqual(110);
      sum += x;
    }
    expect(Math.abs(sum / 5000 - 100)).toBeLessThan(0.5);
  });

  it('电脑思考时间平均和原来的固定值一样，夹在范围里', () => {
    const v = new Vary();
    v.reset(3, true);
    const pace = paceOf('');
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const t = v.think(1000, pace);
      expect(t).toBeGreaterThanOrEqual(1000 * 0.7 * 0.93);
      expect(t).toBeLessThanOrEqual(1000 * 1.5 * 2.5);
      sum += t;
    }
    expect(Math.abs(sum / n - 1000)).toBeLessThan(15);
    // 立直后摸切不会长考
    for (let i = 0; i < 2000; i++) expect(v.think(1000, pace, true)).toBeLessThanOrEqual(1500);
  });

  it('角色快慢：优希比怜快', () => {
    expect(paceOf('yuuki').speed).toBeLessThan(paceOf('toki').speed);
    expect(paceOf('不存在的角色')).toEqual({ speed: 1, spread: 1 });
  });

  it('变体不连着两次一样', () => {
    const v = new Vary();
    v.reset(9, true);
    let prev = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      const k = v.pick('click', 3);
      expect(k).not.toBe(prev);
      seen.add(k);
      prev = k;
    }
    expect(seen.size).toBe(3);
  });

  it('牌河：同一张牌每次歪得一样，相邻两张最坏也碰不上', () => {
    vary.reset(11, true);
    expect(pondJitter(5, 17)).toEqual(pondJitter(5, 17));
    expect(pondJitter(5, 17)).not.toEqual(pondJitter(6, 17));
    for (let t = 0; t < 136; t++) {
      const j = pondJitter(123, t);
      expect(Math.abs(j.yaw)).toBeLessThanOrEqual(POND_TWIST);
      expect(Math.abs(j.dx)).toBeLessThanOrEqual(POND_SHIFT_X);
    }
    // 两张牌朝相反方向转到头、又朝对方偏到头：转角让牌角伸出半个牌长 × 角度
    const worst = 2 * ((TILE_H / 2) * Math.sin(POND_TWIST) + POND_SHIFT_X);
    expect(worst).toBeLessThan(POND_GAP);
    // 随手、凌乱的歪得多（牌桌摆的时候另外挨着排，见 pond-layout 的测试），但都不超过各自的上限
    for (const style of ['loose', 'messy'] as const) {
      for (let t = 0; t < 136; t++) {
        const j = pondJitter(77, t, style);
        expect(Math.abs(j.yaw)).toBeLessThanOrEqual(POND_LOOKS[style].twist);
        expect(Math.abs(j.dx)).toBeLessThanOrEqual(POND_LOOKS[style].shiftX);
        expect(Math.abs(j.dz)).toBeLessThanOrEqual(POND_LOOKS[style].shiftZ);
      }
    }
    vary.reset(0, false);
  });

  it('出牌的样子：设置里选了哪种就是哪种，选多样就照各人的手风换着来', () => {
    vary.reset(21, false);
    // 选了固定的一种：谁都用它；平常的牌用不了立直宣言的样子，反过来也一样
    for (const id of ['nodoka', 'yuuki', 'hisa', '']) {
      for (const k of NORMAL_STYLES) expect(pickDiscardStyle(id, false, k)).toBe(k);
      for (const k of RIICHI_STYLES) expect(pickDiscardStyle(id, true, k)).toBe(k);
      expect(pickDiscardStyle(id, true, 'snap')).toBe('place');
      expect(pickDiscardStyle(id, false, 'top')).toBe('place');
    }
    // 多样：只出这一类里的样子，关了微变化也照样换（它有自己的设置）
    const count = (id: string, riichi: boolean, room = Infinity, flipped = false) => {
      const seen = new Map<string, number>();
      for (let i = 0; i < 4000; i++) {
        const k = pickDiscardStyle(id, riichi, 'varied', room, flipped);
        expect(riichi ? RIICHI_STYLES : NORMAL_STYLES).toContain(k);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      return seen;
    };
    const plain = count('', false);
    expect(plain.size).toBe(NORMAL_STYLES.length);
    // 没特别写的人大多还是平放
    expect(plain.get('place')!).toBeGreaterThan(4000 * 0.4);
    expect(count('', true).size).toBe(RIICHI_STYLES.length);
    // 和规规矩矩，不拍不抛；优希拍的、抛的多
    const nodoka = count('nodoka', false);
    expect(nodoka.has('snap') || nodoka.has('toss') || nodoka.has('spin')).toBe(false);
    const yuuki = count('yuuki', false);
    expect(yuuki.get('snap')! + yuuki.get('toss')!).toBeGreaterThan(4000 * 0.3);
    // 不给设置（调试场景）也照手风来
    expect(NORMAL_STYLES).toContain(pickDiscardStyle('saki', false, undefined));
    vary.reset(0, false);
  });

  it('出牌的样子：跟前放不下的不用，牌河倒着摆的人不立倒', () => {
    vary.reset(22, true);
    for (const id of ['', 'yuuki', 'shiromi', 'hisa']) {
      for (let i = 0; i < 1500; i++) {
        expect(roomNeeded(pickDiscardStyle(id, false, 'varied', 0))).toBe(0);
        expect(roomNeeded(pickDiscardStyle(id, true, 'varied', 0))).toBe(0);
        expect(pickDiscardStyle(id, false, 'varied', Infinity, true)).not.toBe('stand');
      }
    }
    // 固定选了放不下的那种，这一张就平放
    expect(pickDiscardStyle('', false, 'slide', 0.2)).toBe('place');
    expect(pickDiscardStyle('', false, 'stand', Infinity, true)).toBe('place');
    expect(pickDiscardStyle('', false, 'slide', 2)).toBe('slide');
    vary.reset(0, false);
  });

  it('出牌的样子：同一个种子每次挑的一样', () => {
    const run = () => {
      vary.reset(1234, true);
      return Array.from({ length: 40 }, (_, i) => pickDiscardStyle(['saki', 'hisa', 'yuuki', 'nodoka'][i % 4], i % 9 === 0, 'varied'));
    };
    expect(run()).toEqual(run());
    vary.reset(0, false);
  });
});

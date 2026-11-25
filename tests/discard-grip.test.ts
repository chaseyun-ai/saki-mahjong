import { describe, expect, it } from 'vitest';
import { DEFAULT_DISCARD, RIICHI_DISCARD, afterTime, gripAt, styleParams, totalTime } from '../src/ui3d/discardMotion';

// 出牌时右手的手型：-1 张开，0 放松，1 捏着牌
describe('出牌的手型', () => {
  const p = DEFAULT_DISCARD;

  it('还没伸手、整个动作做完以后都是放松的', () => {
    expect(gripAt(p, 0)).toBe(0);
    expect(gripAt(p, -1)).toBe(0);
    expect(gripAt(p, totalTime(p) + 0.01)).toBe(0);
  });

  it('伸手的路上不张开（张着的手指会扫进手牌前面的牌山），从放松慢慢合拢，到牌上正好捏住', () => {
    for (let t = 0; t <= p.reach; t += p.reach / 20) expect(gripAt(p, t)).toBeGreaterThanOrEqual(0);
    expect(gripAt(p, p.reach * 0.2)).toBe(0);
    expect(gripAt(p, p.reach * 0.9)).toBeGreaterThan(0.8);
    expect(gripAt(p, p.reach)).toBe(1);
  });

  it('搬牌的一路都捏着，落桌以后很快张开，收手时回到放松', () => {
    for (const k of [0.01, 0.3, 0.6, 0.99]) expect(gripAt(p, p.reach + p.carry * k)).toBe(1);
    const land = p.reach + p.carry;
    expect(gripAt(p, land + 0.06)).toBeLessThan(1);
    expect(gripAt(p, land + 0.15)).toBeLessThan(0);
    const end = totalTime(p);
    expect(Math.abs(gripAt(p, end - 0.01))).toBeLessThan(0.05);
  });

  it('手型是连续变的，不会一下子跳', () => {
    const end = totalTime(p) + 0.1;
    let prev = gripAt(p, 0);
    for (let t = 0.005; t <= end; t += 0.005) {
      const g = gripAt(p, t);
      expect(Math.abs(g - prev)).toBeLessThan(0.25);
      prev = g;
    }
  });

  it('立直转横：落桌以后还按着牌转，转完才松手', () => {
    const q = styleParams(RIICHI_DISCARD, 'turn', false);
    const land = q.reach + q.carry;
    const turning = afterTime('turn', q);
    expect(turning).toBeGreaterThan(0.1);
    expect(gripAt(q, land + turning * 0.5, 0, 'turn')).toBe(1);
    expect(gripAt(q, land + turning + 0.15, 0, 'turn')).toBeLessThan(0);
  });

  it('半路抛出去的（旋转）：搬到一半就松手', () => {
    const q = styleParams(DEFAULT_DISCARD, 'spin', false);
    expect(gripAt(q, q.reach + q.carry * 0.2, 0, 'spin')).toBe(1);
    expect(gripAt(q, q.reach + q.carry * 0.9, 0, 'spin')).toBeLessThan(0);
  });
});

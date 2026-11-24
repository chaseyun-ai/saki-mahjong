import { describe, expect, it } from 'vitest';
import { EYE_TILT, eyeShotLayout } from '../src/ui/eyeShot';
import { eyeLookOf } from '../src/ui/eyeLooks';
import { EYE_TIMES, eyeStateAt } from '../src/ui/eyeDraw';
import { CHARACTERS } from '../src/abilities/characters';

// 睁眼特写：几格叠起来连斜出去的角都在画面里；每个角色都有一套眼睛参数；睁眼的时间线最后停在睁开
describe('睁眼特写', () => {
  const a = (Math.abs(EYE_TILT) * Math.PI) / 180;
  const sizes: [number, number][] = [
    [1280, 800],
    [1920, 1080],
    [1024, 600],
    [390, 844],
    [844, 390],
  ];
  for (const [W, H] of sizes) {
    it(`${W}×${H} 一到四格都在画面里，不互相盖住中间`, () => {
      for (let n = 1; n <= 4; n++) {
        const rs = eyeShotLayout(n, W, H);
        expect(rs).toHaveLength(n);
        for (const r of rs) {
          const hw = (r.w * Math.cos(a) + r.h * Math.sin(a)) / 2;
          const hh = (r.w * Math.sin(a) + r.h * Math.cos(a)) / 2;
          expect(r.x - hw).toBeGreaterThanOrEqual(0);
          expect(r.x + hw).toBeLessThanOrEqual(W);
          expect(r.y - hh).toBeGreaterThanOrEqual(0);
          expect(r.y + hh).toBeLessThanOrEqual(H);
        }
        for (let i = 1; i < n; i++) expect(rs[i].y - rs[i - 1].y).toBeGreaterThanOrEqual(rs[i].h);
      }
    });
  }

  it('每个角色都有瞳色、发色、发光色', () => {
    for (const c of CHARACTERS) {
      const l = eyeLookOf(c.id, c.color);
      for (const v of [l.iris, l.hair, l.glow]) expect(v, c.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('闭着进来，睁开以后停在全开', () => {
    const l = eyeLookOf('saki', '#f08');
    expect(eyeStateAt(0, l).open).toBe(0);
    const end = eyeStateAt(EYE_TIMES.settle + 0.4, l);
    expect(end.open).toBeCloseTo(1, 5);
    expect(end.pupil).toBeCloseTo(1, 5);
  });
});

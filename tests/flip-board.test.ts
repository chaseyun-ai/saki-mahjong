import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Flip } from '../src/ui3d/flip';
import { visualPanelHtml, DEFAULT_SETTINGS } from '../src/ui/matchSetup';
import { TABLE_STYLES } from '../src/ui/theme';

// 翻转（原来叫翻牌屏）的换局：牌翻下去以后，桌面的翻板一块块翻个面（flip.ts）
const HALF = 14;
const CONSOLE = 2.9;

const tile = (x: number, z: number) => {
  const o = new THREE.Object3D();
  o.position.set(x, 0.4, z);
  return o;
};

// 翻板（有桌布贴图的那几个 mesh），按建出来的顺序
function plates(f: Flip): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  f.group.traverse((o) => {
    if (o instanceof THREE.Mesh && Array.isArray(o.material)) out.push(o);
  });
  return out;
}

describe('翻转：桌面的翻板', () => {
  it('仪表盘外面切成翻板，仪表盘底下的不翻；平时都藏着', () => {
    const f = new Flip(new THREE.MeshStandardMaterial());
    f.build(HALF, CONSOLE);
    const ps = plates(f);
    // 每边 10 块，去掉仪表盘底下的 2×2
    expect(ps.length).toBe(96);
    for (const p of ps) expect(Math.abs(p.position.x) < CONSOLE && Math.abs(p.position.z) < CONSOLE).toBe(false);
    expect(ps.every((p) => !p.visible)).toBe(true);
    // 没有桌布材质就不建翻板（只有牌翻）
    const bare = new Flip();
    bare.build(HALF, CONSOLE);
    expect(plates(bare).length).toBe(0);
  });

  it('翻板上下两面贴的桌布：翻半圈以后和平放时同一个地方贴的是同一块', () => {
    const f = new Flip(new THREE.MeshStandardMaterial());
    f.build(HALF, CONSOLE);
    const felt = (x: number, z: number) => [(x + HALF) / (2 * HALF), (HALF - z) / (2 * HALF)];
    for (const p of plates(f).slice(0, 12)) {
      const pos = p.geometry.getAttribute('position');
      const uv = p.geometry.getAttribute('uv');
      const flipped = new THREE.Euler(Math.PI, 0, 0);
      // 上面（8–11）平放时、下面（12–15）翻了半圈以后：顶点到了桌上哪里，贴的就是桌布那里
      for (let v = 8; v < 16; v++) {
        const at = new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v));
        if (v >= 12) at.applyEuler(flipped);
        const [u, w] = felt(p.position.x + at.x, p.position.z + at.z);
        expect(uv.getX(v)).toBeCloseTo(u, 5);
        expect(uv.getY(v)).toBeCloseTo(w, 5);
      }
    }
  });

  it('牌翻下去以后翻板从对面一排排翻到自己跟前，翻完都藏起来，新牌山等翻板拍平才翻上来', () => {
    const f = new Flip(new THREE.MeshStandardMaterial());
    f.build(HALF, CONSOLE);
    f.sweep([tile(0, -9), tile(0, 9)], 0);
    const ps = plates(f);
    const far = ps.filter((p) => p.position.z < -10);
    const near = ps.filter((p) => p.position.z > 10);
    // 一开始只有牌在翻
    f.update(0.05);
    expect(ps.some((p) => p.visible)).toBe(false);
    // 对面的先翻，自己跟前的还没动
    f.update(0.45);
    expect(far.some((p) => p.visible)).toBe(true);
    expect(near.some((p) => p.visible)).toBe(false);
    f.update(1.2);
    expect(near.some((p) => p.visible)).toBe(true);
    expect(f.busy).toBe(true);
    const lead = f.rise(1.2, [{ x: 0, z: 9, hx: 8.5, hz: 0.68 }]);
    expect(lead).toBeGreaterThan(0);
    // 新牌山最早那一墩也要等自己跟前牌山底下的翻板拍平
    const out = new THREE.Vector4();
    expect(f.wallPose(-8, 9, out)).toBe(false);
    for (let t = 1.2; t < 1.2 + lead + 0.5; t += 1 / 30) f.update(t);
    expect(ps.every((p) => !p.visible)).toBe(true);
    expect(f.busy).toBe(false);
  });

  it('牌桌风格改叫「翻转」；视觉设置里牌桌风格的按钮前不再有小色样，有地方放预览', () => {
    expect(TABLE_STYLES.find((t) => t.id === 'flap')?.name).toBe('翻转');
    const html = visualPanelHtml({ ...DEFAULT_SETTINGS }, 'broadcast', '25d', false, 'flap');
    const buttons = html.match(/<button class="set-table[^>]*>[^<]*<\/button>/g) ?? [];
    expect(buttons.length).toBe(TABLE_STYLES.length);
    expect(buttons.some((b) => b.includes('>翻转<'))).toBe(true);
    expect(html).toContain('class="tp-side"');
    expect(html).toContain('class="tp-inline"');
  });
});

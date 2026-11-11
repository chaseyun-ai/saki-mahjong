import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AHEAD, AHEAD_MAX, EdgeMotion } from '../src/ui3d/slamEdge';
import { GRIP, OPEN, fingerBones } from '../src/ui3d/slamHand';
import { SLAP_HAND, TILE_AT } from '../src/ui3d/slamSlap';
import { TILE_H, TILE_T } from '../src/ui3d/tableLayout';

// 边缘切（桌切）：按着牌放在比落点靠桌子中间的地方，往自己这边划、磕在边上，弹回来停在落点
const side = new THREE.Vector3(1, 0, 0);
const out = new THREE.Vector3(0, 0, 1);
// 牌面朝上、牌顶朝桌子中间（-z）躺着
const faceUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const to = { pos: new THREE.Vector3(7, TILE_T / 2, 12.2), quat: faceUp, scale: 1 };
// 磕的那条边（桌框内沿 / 画面底边）在 z = 14
const rim = 14 - to.pos.z;
// 她手里立着的那张（手牌右边隔开半张，牌面朝自己）
const standing = { pos: new THREE.Vector3(7, TILE_H / 2, 11.2), quat: new THREE.Quaternion(), scale: 1 };
const up = new THREE.Vector3(0, 1, 0);
const faceOf = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, 1).applyQuaternion(q);

describe('边缘切', () => {
  it('自己自摸：放在比手牌靠桌子中间的地方，贴着桌面往自己这边划，越划越快', () => {
    const m = new EdgeMotion({ to, side, out, rim, hand: true });
    // 一开始手带着牌在她身前（比落点靠外）
    const first = m.frame(0);
    expect(first.hand).not.toBeNull();
    expect(first.tile.pos.clone().sub(to.pos).dot(out)).toBeGreaterThan(4);
    // 放到桌上：比落点靠桌子中间 AHEAD，牌面朝上平躺，按着停一下
    const set = m.frame(m.pressAt + 0.01);
    expect(set.tile.pos.clone().sub(to.pos).dot(out)).toBeCloseTo(-AHEAD, 6);
    expect(set.tile.pos.y).toBeCloseTo(TILE_T / 2, 6);
    expect(faceOf(set.tile.quat).dot(up)).toBeGreaterThan(0.999);
    expect(m.frame(m.pullAt - 0.01).tile.pos.distanceTo(set.tile.pos)).toBeLessThan(1e-6);
    expect(m.pullAt - m.pressAt).toBeGreaterThan(0.15);
    // 划：一直贴着桌面、只往自己这边走，后半段比前半段快
    let last = set.tile.pos.dot(out);
    for (let k = m.pullAt; k < m.hitAt; k += 0.01) {
      const p = m.frame(k).tile.pos;
      expect(p.y).toBeCloseTo(TILE_T / 2, 6);
      expect(p.dot(side)).toBeCloseTo(to.pos.x, 6);
      expect(p.dot(out)).toBeGreaterThanOrEqual(last - 1e-9);
      last = p.dot(out);
    }
    const mid = m.frame((m.pullAt + m.hitAt) / 2).tile.pos.dot(out);
    const end = m.frame(m.hitAt - 1e-6).tile.pos.dot(out);
    expect(end - mid).toBeGreaterThan((mid - set.tile.pos.dot(out)) * 2);
  });

  it('磕在桌框上：牌靠自己那条边顶到桌框内沿，手牌磕完才倒', () => {
    const m = new EdgeMotion({ to, side, out, rim, hand: true });
    const hit = m.frame(m.hitAt - 1e-6).tile.pos;
    expect(hit.dot(out) + TILE_H / 2).toBeGreaterThan(14 - 0.05);
    expect(hit.dot(out) + TILE_H / 2).toBeLessThanOrEqual(14);
    // 炸开的地方在桌框跟前的桌面上
    expect(m.hitPoint.z).toBeCloseTo(hit.z + TILE_H / 2, 4);
    expect(m.hitPoint.y).toBeCloseTo(0, 6);
    expect(m.revealAt!).toBeGreaterThan(m.hitAt);
    expect(m.pressAt).toBeLessThan(m.pullAt);
    expect(m.pullAt).toBeLessThan(m.hitAt);
  });

  it('弹回来：跳起来、不钻进桌子，停在落点，手往后上方甩开撤走', () => {
    const m = new EdgeMotion({ to, side, out, rim, hand: true });
    let top = 0;
    for (let k = m.hitAt; k < m.restAt; k += 0.01) {
      const fr = m.frame(k);
      // 牌最低的角不低于桌面
      const q = fr.tile.quat;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            const c = new THREE.Vector3((sx * 1) / 2, (sy * TILE_H) / 2, (sz * TILE_T) / 2).applyQuaternion(q).add(fr.tile.pos);
            expect(c.y).toBeGreaterThan(-0.02);
          }
      top = Math.max(top, fr.tile.pos.y);
      // 往桌子中间弹，不越过落点
      expect(fr.tile.pos.dot(out)).toBeGreaterThanOrEqual(to.pos.z - 1e-6);
    }
    expect(top - TILE_T / 2).toBeGreaterThan(0.5);
    const rest = m.frame(m.restAt + 0.01);
    expect(rest.tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
    expect(rest.tile.quat.angleTo(to.quat)).toBeLessThan(1e-6);
    // 磕完手不再按着牌：往上、往她身体那边走
    const after = m.frame(m.hitAt + 0.15).hand!;
    const at = m.frame(m.hitAt - 1e-6).hand!;
    expect(after.pos.y).toBeGreaterThan(at.pos.y + 0.5);
    expect(after.pos.dot(out)).toBeGreaterThan(at.pos.dot(out));
    expect(m.restAt).toBeLessThanOrEqual(m.doneAt);
    expect(m.frame(m.doneAt + 0.01).hand).toBeNull();
  });

  it('手一直不钻进桌子', () => {
    for (const from of [undefined, standing]) {
      const m = new EdgeMotion({ to, side, out, rim, from, hand: true });
      for (let k = 0; k < m.doneAt; k += 0.01) {
        const h = m.frame(k).hand;
        if (h) expect(h.pos.y).toBeGreaterThan(0.3);
      }
    }
  });

  it('别人自摸：手先伸过去把她手里立着的那张夹起来，再放到桌上', () => {
    const m = new EdgeMotion({ to, side, out, rim, from: standing, hand: true });
    const mine = new EdgeMotion({ to, side, out, rim, hand: true });
    expect(m.pressAt).toBeGreaterThan(mine.pressAt + 0.2);
    // 夹到之前牌还立在她手里
    const first = m.frame(0.05);
    expect(first.tile.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    expect(first.tile.quat.angleTo(standing.quat)).toBeLessThan(1e-6);
    expect(first.hand).not.toBeNull();
    const set = m.frame(m.pressAt + 0.01);
    expect(set.tile.pos.clone().sub(to.pos).dot(out)).toBeCloseTo(-AHEAD, 6);
    expect(m.frame(m.restAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
  });

  it('不带手：牌自己跳到桌上、滑过去磕桌框、弹回来', () => {
    const m = new EdgeMotion({ to, side, out, rim, from: standing, hand: false });
    expect(m.frame(0).hand).toBeNull();
    expect(m.frame(0).tile.pos.distanceTo(standing.pos)).toBeLessThan(1e-6);
    expect(m.frame(m.hitAt - 1e-6).tile.pos.dot(out) + TILE_H / 2).toBeGreaterThan(14 - 0.05);
    expect(m.frame(m.restAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
    expect(m.doneAt).toBeGreaterThanOrEqual(m.restAt);
  });

  it('前面没东西挡着：从更远的地方开始划，划得久一点，照样磕在边上', () => {
    const near = new EdgeMotion({ to, side, out, rim, hand: true });
    const far = new EdgeMotion({ to, side, out, rim, ahead: AHEAD_MAX, hand: true });
    expect(far.frame(far.pressAt + 0.01).tile.pos.clone().sub(to.pos).dot(out)).toBeCloseTo(-AHEAD_MAX, 6);
    expect(far.hitAt - far.pullAt).toBeGreaterThan(near.hitAt - near.pullAt);
    expect(far.hitAt - far.pullAt).toBeLessThan(0.4);
    expect(far.frame(far.hitAt - 1e-6).tile.pos.dot(out) + TILE_H / 2).toBeGreaterThan(14 - 0.05);
    expect(far.frame(far.restAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
  });

  it('夹牌的手：中指平放在牌面上（不嵌进牌里），盖住大半张牌；食指、无名指夹着左右两边', () => {
    // 牌在手里：牌顶朝指尖（+y）、牌面朝手背（+z），单位是手模型的牌宽
    const h = TILE_H / SLAP_HAND;
    const w = 1 / SLAP_HAND;
    const bottom = TILE_AT.y - h / 2;
    const face = TILE_AT.z + TILE_T / SLAP_HAND / 2;
    const mid = fingerBones(GRIP, 1);
    const cover = (mid[2].to.y - bottom) / h;
    expect(cover).toBeGreaterThan(0.7);
    expect(cover).toBeLessThan(0.95);
    // 中指在牌上面的那一段：最低的地方正好贴着牌面，不往牌里陷
    let low = Infinity;
    for (const bone of mid)
      for (let u = 0; u <= 1; u += 0.05) {
        const p = bone.from.clone().lerp(bone.to, u);
        if (p.y >= bottom) low = Math.min(low, p.z - bone.r);
      }
    expect(low).toBeGreaterThan(face - 0.02);
    expect(low).toBeLessThan(face + 0.04);
    // 食指、无名指的指尖在牌面底下、牌的左右两条边外面，贴着边
    const idx = fingerBones(GRIP, 0)[2];
    const ring = fingerBones(GRIP, 2)[2];
    for (const tip of [idx, ring]) {
      expect(tip.to.z).toBeLessThan(face);
      expect(tip.to.y).toBeGreaterThan(bottom + 0.3);
    }
    const gapL = TILE_AT.x - w / 2 - (idx.to.x + idx.r);
    const gapR = ring.to.x - ring.r - (TILE_AT.x + w / 2);
    for (const gap of [gapL, gapR]) {
      expect(gap).toBeGreaterThan(-0.02);
      expect(gap).toBeLessThan(0.1);
    }
  });

  it('手型：夹着牌一直到磕完，甩开时松开', () => {
    const m = new EdgeMotion({ to, side, out, rim, hand: true });
    expect(m.frame(m.pressAt + 0.01).hand!.pose).toBe(GRIP);
    expect(m.frame(m.hitAt - 0.01).hand!.pose).toBe(GRIP);
    expect(m.frame(m.hitAt + 0.3).hand!.pose).toBe(OPEN);
  });

  it('落点紧挨着桌框、前面顶着牌山：划得短一点，照样磕、照样停在落点', () => {
    const m = new EdgeMotion({ to, side, out, rim: 0.4, ahead: 0.2, hand: true });
    const set = m.frame(m.pressAt + 0.01).tile.pos;
    expect(set.clone().sub(to.pos).dot(out)).toBeCloseTo(-0.2, 6);
    // 离桌框不到半张牌：就在落点磕
    expect(m.frame(m.hitAt - 1e-6).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-4);
    expect(m.frame(m.restAt + 0.01).tile.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
  });
});

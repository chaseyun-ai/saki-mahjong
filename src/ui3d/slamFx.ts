import * as THREE from 'three';

// 自摸砸牌的光效（tileSlam.ts 管手和牌，这里管光）：
// charge：牌翻起来立好以后，牌上聚起一团越来越亮的白光，四周的小光点往牌上收；
// swirl：炸开那一下，贴着桌面卷出去一圈白色的旋风（几层螺旋状的风痕，一边转一边往外扩、慢慢淡掉）。

interface Item {
  obj: THREE.Object3D;
  t: number;
  dur: number;
  update: (k: number) => void;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
}

let glowTex: THREE.Texture | null = null;
// 一团软光：中间白、往外淡
function glow(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const swirlTex: THREE.Texture[] = [];
// 螺旋风痕：arms 条旋臂，每条几道细细的弧线，从里往外越来越宽、两头淡
function swirl(i: number): THREE.Texture {
  if (swirlTex[i]) return swirlTex[i];
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  x.globalCompositeOperation = 'lighter';
  x.lineCap = 'round';
  const arms = i === 0 ? 5 : 7;
  const R = N / 2;
  let seed = 7 + i * 31;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let a = 0; a < arms; a++) {
    const a0 = (a / arms) * Math.PI * 2 + rnd() * 0.4;
    const streaks = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < streaks; j++) {
      const off = (rnd() - 0.5) * 0.22;
      const sweep = 1.6 + rnd() * 1.4;
      const r0 = 0.12 + rnd() * 0.12;
      const r1 = 0.7 + rnd() * 0.28;
      const w = 2 + rnd() * 6;
      const alpha = 0.35 + rnd() * 0.55;
      const steps = 60;
      let px = 0;
      let py = 0;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const th = a0 + off + u * sweep;
        const r = R * (r0 + (r1 - r0) * u ** 0.85);
        const qx = R + Math.cos(th) * r;
        const qy = R + Math.sin(th) * r;
        if (k > 0) {
          const env = Math.sin(Math.PI * u) ** 0.7;
          x.strokeStyle = `rgba(255,255,255,${(alpha * env).toFixed(3)})`;
          x.lineWidth = w * (0.4 + u) * env;
          x.beginPath();
          x.moveTo(px, py);
          x.lineTo(qx, qy);
          x.stroke();
        }
        px = qx;
        py = qy;
      }
    }
  }
  // 中间一圈淡淡的光
  const g = x.createRadialGradient(R, R, 0, R, R, R * 0.45);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, N, N);
  swirlTex[i] = new THREE.CanvasTexture(c);
  return swirlTex[i];
}

export class SlamFx {
  readonly group = new THREE.Group();
  private items: Item[] = [];

  private add(obj: THREE.Object3D, dur: number, update: (k: number) => void, mats: THREE.Material[], geos: THREE.BufferGeometry[] = []): void {
    obj.frustumCulled = false;
    this.group.add(obj);
    const it = { obj, t: 0, dur, update, mats, geos };
    this.items.push(it);
    update(0);
  }

  // 牌上聚光：dur 秒里越来越亮、一闪一闪，最后一下最亮（接着就是炸开）。at 是牌中心，s 是牌的大小
  charge(at: THREE.Vector3, s: number, dur: number, color: THREE.ColorRepresentation = '#eaf6ff'): void {
    const mat = new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(at);
    sp.renderOrder = 20;
    this.add(
      sp,
      dur + 0.08,
      (k) => {
        const f = Math.min(1, k * 1.08);
        sp.scale.setScalar(s * (0.6 + 2.4 * f * f) * (1 + 0.08 * Math.sin(k * 40)));
        mat.opacity = Math.min(1, 0.15 + f * 1.1) * (k > 0.93 ? (1 - k) / 0.07 : 1);
      },
      [mat],
    );
    // 往牌上收的小光点
    const n = 14;
    const motes: { sp: THREE.Sprite; mat: THREE.SpriteMaterial; a: number; r: number; h: number }[] = [];
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      const p = new THREE.Sprite(m);
      g.add(p);
      motes.push({ sp: p, mat: m, a: (i / n) * Math.PI * 2 + Math.random() * 0.4, r: (2.2 + Math.random() * 1.6) * s, h: (Math.random() - 0.3) * 1.6 * s });
    }
    g.position.copy(at);
    this.add(
      g,
      dur,
      (k) => {
        for (const o of motes) {
          const f = 1 - (1 - k) ** 2;
          const r = o.r * (1 - f);
          const a = o.a + f * 2.2;
          o.sp.position.set(Math.cos(a) * r, o.h * (1 - f), Math.sin(a) * r);
          o.sp.scale.setScalar(0.22 * s * (1 - 0.5 * f));
          o.mat.opacity = Math.min(1, k * 4) * (1 - f * 0.4);
        }
      },
      motes.map((o) => o.mat),
    );
  }

  // 炸开时贴着桌面卷出去的白色旋风。at 是桌面点，s 是牌的大小，big 越大卷得越大、越久
  swirl(at: THREE.Vector3, s: number, big = 0, color: THREE.ColorRepresentation = '#ffffff'): void {
    const layers = [
      { tex: 0, size: 9, spin: 3.2, alpha: 1, y: 0.06, dur: 0.8 },
      { tex: 1, size: 12, spin: 2.3, alpha: 0.85, y: 0.09, dur: 0.95 },
      { tex: 0, size: 6, spin: 4.4, alpha: 1, y: 0.12, dur: 0.6 },
    ];
    for (const L of layers) {
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({ map: swirl(L.tex), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(at).setY(at.y + L.y);
      mesh.renderOrder = 15;
      const rot0 = Math.random() * Math.PI * 2;
      const dur = L.dur * (1 + 0.5 * big);
      const size = L.size * s * (1 + 0.35 * big);
      this.add(
        mesh,
        dur,
        (k) => {
          const grow = 1 - (1 - k) ** 3;
          mesh.scale.setScalar(size * (0.25 + 0.75 * grow));
          // 往一个方向卷（从上往下看逆时针），越往后转得越慢
          mesh.rotation.z = rot0 + L.spin * (1 - Math.exp(-k * 3.5));
          mat.opacity = L.alpha * Math.min(1, k / 0.06) * (1 - k) ** 1.6;
        },
        [mat],
        [geo],
      );
    }
  }

  update(dt: number): void {
    for (const it of [...this.items]) {
      it.t += dt;
      const k = Math.min(1, it.t / it.dur);
      it.update(k);
      if (k >= 1) this.remove(it);
    }
  }

  clear(): void {
    for (const it of [...this.items]) this.remove(it);
  }

  private remove(it: Item): void {
    this.items = this.items.filter((x) => x !== it);
    this.group.remove(it.obj);
    for (const m of it.mats) m.dispose();
    for (const g of it.geos) g.dispose();
  }
}

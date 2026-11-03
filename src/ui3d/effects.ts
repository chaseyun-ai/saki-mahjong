import * as THREE from 'three';

// 牌桌上的特效：冲击波圆环、光柱、闪光粒子、闪电。都是加法混合的半透明网格，播完自己移除。

interface Effect {
  obj: THREE.Object3D;
  t: number;
  duration: number;
  update: (k: number) => void;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 光柱：上下渐隐
function pillarTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 闪电的光带：横向中间亮、两边透明
function stripTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 一条折线：从 from 到 to 分 n 段，中间的点往两侧随机偏，两头偏得少
function jagged(from: THREE.Vector3, to: THREE.Vector3, n: number, amp: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const p = from.clone().lerp(to, i / n);
    if (i > 0 && i < n) {
      const a = amp * Math.sin((Math.PI * i) / n);
      p.x += (Math.random() - 0.5) * 2 * a;
      p.z += (Math.random() - 0.5) * 2 * a;
    }
    pts.push(p);
  }
  return pts;
}

// 沿折线铺一条朝着镜头的光带，宽度从 w0 渐变到 w1
function ribbon(pts: THREE.Vector3[], eye: THREE.Vector3, w0: number, w1: number): { pos: number[]; uv: number[]; index: number[] } {
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  pts.forEach((p, i) => {
    const along = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]);
    const side = along.cross(eye.clone().sub(p)).normalize();
    const w = THREE.MathUtils.lerp(w0, w1, i / (pts.length - 1)) / 2;
    const a = p.clone().addScaledVector(side, -w);
    const b = p.clone().addScaledVector(side, w);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uv.push(0, i, 1, i);
    if (i > 0) {
      const k = i * 2;
      index.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  return { pos, uv, index };
}

const additive = (color: THREE.ColorRepresentation, map?: THREE.Texture) =>
  new THREE.MeshBasicMaterial({
    color,
    ...(map ? { map } : {}),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

export class Effects {
  private list: Effect[] = [];
  private glow = glowTexture();
  private pillar = pillarTexture();
  private strip = stripTexture();

  constructor(private scene: THREE.Scene) {}

  private add(obj: THREE.Object3D, duration: number, update: (k: number) => void): void {
    this.scene.add(obj);
    this.list.push({ obj, t: 0, duration, update });
    update(0);
  }

  // 贴着桌面向外扩散的圆环
  ring(at: THREE.Vector3, color: THREE.ColorRepresentation, radius = 6, duration = 0.7): void {
    const mat = additive(color);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at).setY(at.y + 0.05);
    this.add(mesh, duration, (k) => {
      const e = 1 - (1 - k) * (1 - k);
      mesh.scale.setScalar(0.3 + e * radius);
      mat.opacity = (1 - k) * 0.9;
    });
  }

  // 从桌面升起的光柱
  beam(at: THREE.Vector3, color: THREE.ColorRepresentation, height = 14, duration = 1.4): void {
    const mat = additive(color, this.pillar);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, height, 32, 1, true), mat);
    mesh.position.copy(at).setY(at.y + height / 2);
    this.add(mesh, duration, (k) => {
      mesh.scale.set(1 + k * 0.4, Math.min(1, k * 5), 1 + k * 0.4);
      mat.opacity = (k < 0.2 ? k * 5 : (1 - k) * 1.25) * 0.6;
      mesh.rotation.y = k * 2;
    });
  }

  // 一团向上飘散的闪光
  sparkles(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 40, spread = 4, duration = 1.6): void {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      vel.push(new THREE.Vector3(Math.cos(a) * r, 3 + Math.random() * 6, Math.sin(a) * r));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      map: this.glow,
      size: 0.9,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(at);
    this.add(pts, duration, (k) => {
      for (let i = 0; i < count; i++) {
        const v = vel[i];
        pos[i * 3] = v.x * k;
        pos[i * 3 + 1] = v.y * k - 3 * k * k;
        pos[i * 3 + 2] = v.z * k;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - k * k;
      mat.size = 0.9 * (1 - k * 0.5);
    });
  }

  // 一闪而过的光晕
  flash(at: THREE.Vector3, color: THREE.ColorRepresentation, size = 8, duration = 0.45): void {
    const mat = new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    this.add(sprite, duration, (k) => {
      sprite.scale.setScalar(size * (0.5 + k));
      mat.opacity = 1 - k;
    });
  }

  // 从天上 top 劈下来打在 at 上的闪电：外面一层彩色的光、里面一条白芯，带两根分叉。
  // 一共闪三下，每下换个形状、一下比一下暗；打中的地方炸一团光和一圈冲击波。eye 是镜头位置，光带朝着镜头
  bolt(top: THREE.Vector3, at: THREE.Vector3, color: THREE.ColorRepresentation, eye: THREE.Vector3, duration = 0.55): void {
    const height = top.y - at.y;
    const glowMat = additive(color, this.strip);
    const coreMat = additive('#ffffff', this.strip);
    const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
    const core = new THREE.Mesh(new THREE.BufferGeometry(), coreMat);
    const group = new THREE.Group();
    group.add(glow, core);
    const shape = () => {
      const main = jagged(top, at, 12, 1.6);
      const lines = [main];
      for (const from of [3 + Math.floor(Math.random() * 3), 6 + Math.floor(Math.random() * 3)]) {
        const p = main[from];
        const end = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, -height * 0.22, (Math.random() - 0.5) * 8));
        lines.push(jagged(p, end, 4, 0.8));
      }
      for (const [mesh, w] of [
        [glow, 1.8],
        [core, 0.45],
      ] as const) {
        const pos: number[] = [];
        const uv: number[] = [];
        const index: number[] = [];
        lines.forEach((l, j) => {
          const r = ribbon(l, eye, j ? w * 0.5 : w * 0.7, j ? w * 0.15 : w * 1.2);
          const base = pos.length / 3;
          pos.push(...r.pos);
          uv.push(...r.uv);
          index.push(...r.index.map((x) => x + base));
        });
        mesh.geometry.dispose();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setIndex(index);
        mesh.geometry = geo;
      }
    };
    // 三下的开始时刻（占整段的比例）和亮度
    const strikes: [number, number][] = [
      [0, 1],
      [0.32, 0.75],
      [0.56, 0.9],
    ];
    let shown = -1;
    this.add(group, duration, (k) => {
      let s = 0;
      while (s + 1 < strikes.length && k >= strikes[s + 1][0]) s++;
      if (s !== shown) {
        shown = s;
        shape();
      }
      const end = s + 1 < strikes.length ? strikes[s + 1][0] : 1;
      const u = (k - strikes[s][0]) / (end - strikes[s][0]);
      const o = strikes[s][1] * (1 - 0.7 * u) * (s === strikes.length - 1 ? 1 - u : 1);
      glowMat.opacity = o * 0.9;
      coreMat.opacity = o;
    });
    // 打中的光不要太大，那张牌还看得见
    this.flash(at.clone().setY(at.y + 1), '#ffffff', 4, 0.3);
    this.flash(at.clone().setY(at.y + 1), color, 8, 0.6);
    this.ring(at, color, 7, 0.6);
    this.ring(at, '#ffffff', 4, 0.4);
    this.sparkles(at, color, 30, 6, 0.9);
  }

  // 薄墨初美的里鬼门和牌：和的那张牌上无数紫光往上冲（越往上越散开），中间一团白光。eye 是镜头位置，光带朝着镜头
  galeBurst(at: THREE.Vector3, eye: THREE.Vector3, count = 140, duration = 2.2): void {
    const SEG = 6;
    const colors = ['#c23cff', '#e04cff', '#ff6ae8', '#f4c8ff', '#ffffff', '#a64cff'].map((c) => new THREE.Color(c));
    const rays = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2;
      // 大多数往上直冲，越靠外的越斜（像喷泉一样往外张开）
      const lean = Math.pow(Math.random(), 1.6) * 0.75;
      const dir = new THREE.Vector3(Math.cos(a) * lean, 1, Math.sin(a) * lean).normalize();
      return {
        from: new THREE.Vector3(Math.cos(a) * Math.random() * 0.8, 0, Math.sin(a) * Math.random() * 0.8),
        dir,
        speed: 14 + Math.random() * 22,
        len: 3 + Math.random() * 7,
        width: 0.08 + Math.random() * 0.3,
        delay: Math.random() * 0.35,
        bend: (Math.random() - 0.5) * 0.6,
        color: colors[Math.floor(Math.random() * colors.length)],
      };
    });
    const n = count * (SEG + 1) * 2;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const index: number[] = [];
    for (let s = 0; s < count; s++) {
      for (let i = 0; i <= SEG; i++) {
        const v = (s * (SEG + 1) + i) * 2;
        uv.set([0, i / SEG, 1, i / SEG], v * 2);
        if (i > 0) index.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    const mat = new THREE.MeshBasicMaterial({ map: this.strip, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.position.copy(at);
    const eyeLocal = eye.clone().sub(at);
    const p = new THREE.Vector3();
    const along = new THREE.Vector3();
    const side = new THREE.Vector3();
    this.add(mesh, duration, (k) => {
      const t = k * duration;
      rays.forEach((r, s) => {
        const tt = Math.max(0, t - r.delay);
        const head = r.speed * tt * (1 - 0.25 * Math.min(1, tt));
        const tail = Math.max(0, head - r.len);
        // 冲出来以后慢慢淡掉
        const life = tt <= 0 ? 0 : Math.min(1, tt * 8) * Math.max(0, 1 - tt / (duration - r.delay));
        for (let i = 0; i <= SEG; i++) {
          const u = i / SEG; // 0 是头
          const d = head + (tail - head) * u;
          p.copy(r.from).addScaledVector(r.dir, d);
          // 往外弯一点
          p.x += r.dir.x * d * d * 0.01 * (1 + r.bend);
          p.z += r.dir.z * d * d * 0.01 * (1 + r.bend);
          along.copy(r.dir);
          side.copy(along).cross(eyeLocal.clone().sub(p)).normalize();
          const w = r.width * (1 - u * 0.5) * (1 + d * 0.03);
          const v = (s * (SEG + 1) + i) * 2;
          pos[v * 3] = p.x - side.x * w;
          pos[v * 3 + 1] = p.y - side.y * w;
          pos[v * 3 + 2] = p.z - side.z * w;
          pos[v * 3 + 3] = p.x + side.x * w;
          pos[v * 3 + 4] = p.y + side.y * w;
          pos[v * 3 + 5] = p.z + side.z * w;
          const b = life * (1 - u) * 1.3;
          for (const o of [0, 3]) {
            col[v * 3 + o] = r.color.r * b;
            col[v * 3 + o + 1] = r.color.g * b;
            col[v * 3 + o + 2] = r.color.b * b;
          }
        }
      });
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    });
    // 中间一团白光、紫色光柱、贴着桌面的冲击波
    this.flash(at.clone().setY(at.y + 1), '#ffffff', 9, 0.7);
    this.flash(at.clone().setY(at.y + 1.5), '#d070ff', 16, 1.1);
    this.beam(at, '#c050ff', 22, 1.8);
    this.ring(at, '#d070ff', 10, 0.9);
    this.ring(at, '#ffffff', 5, 0.5);
    this.sparkles(at, '#e8a0ff', 60, 7, 1.8);
  }

  update(dt: number): void {
    this.list = this.list.filter((e) => {
      e.t += dt;
      const k = Math.min(1, e.t / e.duration);
      e.update(k);
      if (k >= 1) {
        this.scene.remove(e.obj);
        e.obj.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          (m.material as THREE.Material | undefined)?.dispose();
        });
        return false;
      }
      return true;
    });
  }
}

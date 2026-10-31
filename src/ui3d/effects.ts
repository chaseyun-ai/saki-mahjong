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

export const additive = (color: THREE.ColorRepresentation, map?: THREE.Texture) =>
  new THREE.MeshBasicMaterial({
    color,
    ...(map ? { map } : {}),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

// 倒在桌上的一张牌：中心、朝向（牌面朝本地 +z，长边是本地 y）、宽高厚（x、y、z）
export interface TileBox {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  size: THREE.Vector3;
}

// 牌的本地坐标 → 世界坐标
export const onTile = (b: TileBox, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(b.quat).add(b.pos);

// 圆角矩形的光晕：中间实，四边柔和地淡出。垫在牌底下，露出来的一圈就像牌在发光
function haloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 15; i++) {
    const m = 1 + i * 1.6;
    ctx.beginPath();
    ctx.roundRect(m, m, 64 - 2 * m, 64 - 2 * m, Math.max(2, 14 - i));
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 一个个大小、颜色都不一样的光点（火苗用）。aSize 是世界单位的直径，aColor 乘上贴图的透明度后加到画面上
export const SPARK_VERT = `
attribute float aSize;
attribute vec3 aColor;
uniform float uHalfH;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * projectionMatrix[1][1] * uHalfH / -mv.z;
}`;
export const SPARK_FRAG = `
uniform sampler2D map;
varying vec3 vColor;
void main() {
  float a = texture2D(map, gl_PointCoord).a;
  gl_FragColor = vec4(vColor, a);
}`;

// 火苗的颜色：刚冒出来白黄，往上变橙、变红，最后暗下去
const FIRE_STOPS: [number, THREE.Color][] = [
  [0, new THREE.Color(1, 0.95, 0.7)],
  [0.25, new THREE.Color(1, 0.72, 0.2)],
  [0.55, new THREE.Color(0.95, 0.32, 0.06)],
  [0.85, new THREE.Color(0.5, 0.08, 0.02)],
  [1, new THREE.Color(0, 0, 0)],
];
export function fireColor(u: number, out: THREE.Color): THREE.Color {
  for (let i = 1; i < FIRE_STOPS.length; i++) {
    const [b, cb] = FIRE_STOPS[i];
    if (u <= b) {
      const [a, ca] = FIRE_STOPS[i - 1];
      return out.copy(ca).lerp(cb, (u - a) / (b - a));
    }
  }
  return out.setRGB(0, 0, 0);
}

// 引线：牌面上方一点，从 tiles[0] 的左边穿过每张牌的中心到最后一张的右边。at[i + 1] 是走到第 i 张牌中心的距离，
// point(d) 是走了 d 的位置
export function fuseTrack(tiles: TileBox[]): { path: THREE.Vector3[]; at: number[]; total: number; point: (d: number) => THREE.Vector3 } {
  const n = tiles.length;
  const path: THREE.Vector3[] = [onTile(tiles[0], -tiles[0].size.x / 2, 0, tiles[0].size.z * 0.6)];
  for (const b of tiles) path.push(onTile(b, 0, 0, b.size.z * 0.6));
  path.push(onTile(tiles[n - 1], tiles[n - 1].size.x / 2, 0, tiles[n - 1].size.z * 0.6));
  const at: number[] = [0];
  for (let i = 1; i < path.length; i++) at.push(at[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = at[at.length - 1];
  const point = (d: number) => {
    d = THREE.MathUtils.clamp(d, 0, total);
    let i = 1;
    while (i < at.length - 1 && at[i] < d) i++;
    const u = (d - at[i - 1]) / Math.max(1e-6, at[i] - at[i - 1]);
    return path[i - 1].clone().lerp(path[i], u);
  };
  return { path, at, total, point };
}

// 引线烧到哪了：time 秒烧完全程，先快后稍慢一点点，收尾利落
export const fuseHead = (total: number, time: number, t: number): number => total * (1 - Math.pow(1 - Math.min(1, t / time), 1.6));

export class Effects {
  private list: Effect[] = [];
  readonly glow = glowTexture();
  private pillar = pillarTexture();
  private strip = stripTexture();
  private halo = haloTexture();

  constructor(private scene: THREE.Scene) {}

  add(obj: THREE.Object3D, duration: number, update: (k: number) => void): void {
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
  // 一共闪三下，每下换个形状、一下比一下暗；打中的地方炸一团光和一圈冲击波。eye 是镜头位置，光带朝着镜头；
  // width 是粗细的倍数，细的闪电打中时的光也小一些
  bolt(top: THREE.Vector3, at: THREE.Vector3, color: THREE.ColorRepresentation, eye: THREE.Vector3, duration = 0.55, width = 1): void {
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
        [glow, 1.8 * width],
        [core, 0.45 * width],
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
    const hit = 0.4 + 0.6 * width;
    this.flash(at.clone().setY(at.y + 1), '#ffffff', 4 * hit, 0.3);
    this.flash(at.clone().setY(at.y + 1), color, 8 * hit, 0.6);
    this.ring(at, color, 7 * hit, 0.6);
    this.ring(at, '#ffffff', 4 * hit, 0.4);
    this.sparkles(at, color, Math.round(30 * hit), 6 * hit, 0.9);
  }

  // 每张牌底下垫一块光晕，返回材质，透明度由调用的人逐张控制
  halos(tiles: TileBox[], color: THREE.ColorRepresentation, group: THREE.Group): THREE.MeshBasicMaterial[] {
    return tiles.map((b) => {
      const mat = additive(color, this.halo);
      mat.side = THREE.FrontSide;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.size.x * 1.9, b.size.y * 1.6), mat);
      mesh.quaternion.copy(b.quat);
      mesh.position.copy(onTile(b, 0, 0, -b.size.z / 2 + 0.02));
      group.add(mesh);
      return mat;
    });
  }

  // 烧引线：一个亮点从 tiles[0] 的左边沿着手牌一路烧到最后一张的右边，后面拖一小截光尾、往外喷火星；
  // 亮点经过的牌亮一下，烧过就灭。kind 是 fire（火星往上蹦再落下）或 spark（蓝白电火花，头上跳着几道小电弧）。
  // time 是烧完全程的秒数；返回烧完、收尾要多久
  fuse(tiles: TileBox[], kind: 'fire' | 'spark', color: THREE.ColorRepresentation, eye: THREE.Vector3, time = 0.5): number {
    const n = tiles.length;
    if (!n) return 0;
    const unit = tiles[0].size.x;
    const electric = kind === 'spark';
    const { path, at, total, point } = fuseTrack(tiles);
    const head = (t: number) => fuseHead(total, time, t);
    const tail = 0.35;
    const duration = time + tail;
    const trailLen = unit * (electric ? 1.6 : 2.2);
    const group = new THREE.Group();
    const halos = this.halos(tiles, electric ? color : '#ff8a2a', group);
    // 光尾：外面一层彩色、里面一条白芯
    const glowMat = additive(color, this.strip);
    const coreMat = additive('#ffffff', this.strip);
    glowMat.vertexColors = coreMat.vertexColors = true;
    const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
    const core = new THREE.Mesh(new THREE.BufferGeometry(), coreMat);
    glow.frustumCulled = core.frustumCulled = false;
    group.add(glow, core);
    // 亮点
    const headGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const headCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    group.add(headGlow, headCore);
    // 火星
    const count = 220;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const uniforms = { map: { value: this.glow }, uHalfH: { value: 400 } };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    const buf = new THREE.Vector2();
    pts.onBeforeRender = (r) => (uniforms.uHalfH.value = r.getDrawingBufferSize(buf).y / 2);
    group.add(pts);
    const sp = Array.from({ length: count }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 0 }));
    let next = 0;
    let emitted = 0;
    let last = 0;
    const tint = new THREE.Color(color);
    const c = new THREE.Color();
    const rate = electric ? 360 : 420; // 每秒喷多少颗
    let frame = -1;
    this.add(group, duration, (k) => {
      const t = k * duration;
      const dt = Math.max(0, t - last);
      last = t;
      const burning = t < time;
      const d = head(t);
      const hp = point(d);
      const fade = burning ? 1 : Math.max(0, 1 - (t - time) / tail);
      // 牌：亮点快到时亮起来，烧过一张多一点就灭
      halos.forEach((m, i) => {
        const x = d - at[i + 1];
        const v = x < -unit ? 0 : x < 0 ? 1 + x / unit : Math.max(0, 1 - x / (unit * 1.4));
        m.opacity = v * 0.8 * fade;
      });
      // 亮点闪烁
      const flick = 0.85 + Math.random() * 0.3;
      headGlow.position.copy(hp);
      headCore.position.copy(hp);
      headGlow.scale.setScalar(unit * (electric ? 3.2 : 2.8) * flick * fade);
      headCore.scale.setScalar(unit * 1.1 * flick * fade);
      headGlow.material.opacity = fade;
      headCore.material.opacity = fade;
      // 喷火星
      if (burning) {
        const want = Math.floor(t * rate);
        for (; emitted < want; emitted++) {
          const s = sp[next];
          next = (next + 1) % count;
          s.p.copy(point(d - Math.random() * unit * 0.3));
          const a = Math.random() * Math.PI * 2;
          const r = (electric ? 3 + Math.random() * 5 : 1.5 + Math.random() * 3.5) * unit;
          s.v.set(Math.cos(a) * r, (electric ? (Math.random() - 0.2) * 4 : 2.5 + Math.random() * 4) * unit, Math.sin(a) * r);
          s.age = 0;
          s.life = electric ? 0.12 + Math.random() * 0.16 : 0.22 + Math.random() * 0.25;
        }
      }
      for (let j = 0; j < count; j++) {
        const s = sp[j];
        if (s.life <= 0 || s.age >= s.life) {
          size[j] = 0;
          continue;
        }
        s.age += dt;
        s.v.y -= (electric ? 4 : 14) * unit * dt;
        s.p.addScaledVector(s.v, dt);
        const u = Math.min(1, s.age / s.life);
        pos[j * 3] = s.p.x;
        pos[j * 3 + 1] = s.p.y;
        pos[j * 3 + 2] = s.p.z;
        size[j] = unit * (electric ? 0.32 : 0.42) * (1 - u * 0.6);
        if (electric) c.setRGB(1, 1, 1).lerp(tint, Math.min(1, u * 1.5)).multiplyScalar(1 - u);
        else fireColor(u, c);
        col[j * 3] = c.r;
        col[j * 3 + 1] = c.g;
        col[j * 3 + 2] = c.b;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      // 光尾和电弧：电的每 0.03 秒换个形状，火的每帧跟着走
      const f = Math.floor(t / 0.03);
      if (electric && f === frame) return;
      frame = f;
      const lines: { pts: THREE.Vector3[]; v0: number; v1: number; w: number }[] = [];
      if (fade > 0) {
        const m = 10;
        const trail: THREE.Vector3[] = [];
        for (let j = 0; j <= m; j++) {
          const p = point(d - trailLen * (1 - j / m));
          if (electric && j > 0 && j < m) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.3 * unit, (Math.random() - 0.5) * 0.2 * unit, (Math.random() - 0.5) * 0.3 * unit));
          trail.push(p);
        }
        lines.push({ pts: trail, v0: 0, v1: fade, w: 1 });
        if (electric) {
          // 头上跳着的小电弧
          for (let j = 0; j < 4; j++) {
            const a = Math.random() * Math.PI * 2;
            const end = hp.clone().add(new THREE.Vector3(Math.cos(a), (Math.random() - 0.6) * 0.8, Math.sin(a)).multiplyScalar(unit * (0.6 + Math.random() * 0.9)));
            lines.push({ pts: jagged(hp, end, 4, unit * 0.18), v0: fade, v1: 0.3 * fade, w: 0.75 });
          }
        }
      }
      for (const [mesh, w] of [
        [glow, unit * (electric ? 0.5 : 0.6)],
        [core, unit * (electric ? 0.14 : 0.16)],
      ] as const) {
        const p: number[] = [];
        const uv: number[] = [];
        const cl: number[] = [];
        const index: number[] = [];
        for (const l of lines) {
          const r = ribbon(l.pts, eye, w * l.w * 0.3, w * l.w);
          const base = p.length / 3;
          p.push(...r.pos);
          uv.push(...r.uv);
          for (let j = 0; j < l.pts.length; j++) {
            const v = THREE.MathUtils.lerp(l.v0, l.v1, j / (l.pts.length - 1));
            cl.push(v, v, v, v, v, v);
          }
          index.push(...r.index.map((x) => x + base));
        }
        mesh.geometry.dispose();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
        g.setIndex(index);
        mesh.geometry = g;
      }
    });
    // 烧到头炸一小下
    const end = path[path.length - 1];
    const boom = () => {
      this.flash(end, '#ffffff', unit * 2.5, 0.2);
      this.flash(end, color, unit * 4.5, 0.35);
    };
    this.add(new THREE.Group(), time, (k) => k >= 1 && boom());
    return time + 0.15;
  }

  update(dt: number): void {
    // 特效播放中途可能再加新的（比如电流走到一张牌时闪一下），先挪开，播完再接回去
    const running = this.list;
    this.list = [];
    const kept = running.filter((e) => {
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
    this.list = kept.concat(this.list);
  }
}

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

// 倒在桌上的一张牌：中心、朝向（牌面朝本地 +z，长边是本地 y）、宽高厚（x、y、z）
export interface TileBox {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  size: THREE.Vector3;
}

// 牌的本地坐标 → 世界坐标
const onTile = (b: TileBox, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(b.quat).add(b.pos);

// 牌四周一圈上的点：k 从 0 到 1 绕一圈，pad 是往外扩多少
function rim(b: TileBox, k: number, pad: number): [number, number] {
  const w = b.size.x / 2 + pad;
  const h = b.size.y / 2 + pad;
  const per = 4 * (w + h);
  let d = (((k % 1) + 1) % 1) * per;
  if (d < 2 * w) return [-w + d, -h];
  d -= 2 * w;
  if (d < 2 * h) return [w, -h + d];
  d -= 2 * h;
  if (d < 2 * w) return [w - d, h];
  d -= 2 * w;
  return [-w, h - d];
}

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
const SPARK_VERT = `
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
const SPARK_FRAG = `
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
function fireColor(u: number, out: THREE.Color): THREE.Color {
  for (let i = 1; i < FIRE_STOPS.length; i++) {
    const [b, cb] = FIRE_STOPS[i];
    if (u <= b) {
      const [a, ca] = FIRE_STOPS[i - 1];
      return out.copy(ca).lerp(cb, (u - a) / (b - a));
    }
  }
  return out.setRGB(0, 0, 0);
}

export class Effects {
  private list: Effect[] = [];
  private glow = glowTexture();
  private pillar = pillarTexture();
  private strip = stripTexture();
  private halo = haloTexture();

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

  // 每张牌底下垫一块光晕，返回材质，透明度由调用的人逐张控制
  private halos(tiles: TileBox[], color: THREE.ColorRepresentation, group: THREE.Group): THREE.MeshBasicMaterial[] {
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

  // 电流包住手牌：从 tiles[0] 开始每 step 秒点亮一张，一圈锯齿状的电弧绕着牌跳，相邻的牌之间连着电弧，
  // 走到最后一张后再亮 hold 秒、淡出。返回走到最后一张、闪完要多久
  current(tiles: TileBox[], color: THREE.ColorRepresentation, eye: THREE.Vector3, step = 0.07, hold = 0.9): number {
    const n = tiles.length;
    const sweep = (n - 1) * step;
    const fade = 0.45;
    const duration = sweep + hold + fade;
    const group = new THREE.Group();
    const glowMat = additive(color, this.strip);
    const coreMat = additive('#ffffff', this.strip);
    glowMat.vertexColors = coreMat.vertexColors = true;
    const glow = new THREE.Mesh(new THREE.BufferGeometry(), glowMat);
    const core = new THREE.Mesh(new THREE.BufferGeometry(), coreMat);
    glow.frustumCulled = core.frustumCulled = false;
    group.add(glow, core);
    const halos = this.halos(tiles, color, group);
    const unit = tiles[0]?.size.x ?? 1;
    // 每张牌现在多亮：刚点亮时冲一下，之后闪烁着保持
    const level = (i: number, t: number) => {
      const r = t - i * step;
      if (r < 0) return 0;
      return r < 0.18 ? 1.7 - r * 4 : 0.75 + Math.random() * 0.35;
    };
    let frame = -1;
    let lit = 0;
    this.add(group, duration, (k) => {
      const t = k * duration;
      const out = t > sweep + hold ? Math.max(0, 1 - (t - sweep - hold) / fade) : 1;
      glowMat.opacity = out * 0.8;
      coreMat.opacity = out * 0.6;
      halos.forEach((m, i) => (m.opacity = Math.min(1, level(i, t)) * 0.75 * out));
      // 走到一张新牌：那张牌上闪一下
      while (lit < n && t >= lit * step) {
        const b = tiles[lit++];
        this.flash(onTile(b, 0, 0, b.size.z), '#ffffff', unit * 2.2, 0.18);
        this.flash(onTile(b, 0, 0, b.size.z), color, unit * 3.4, 0.3);
      }
      // 电弧每 0.045 秒换一个形状
      const f = Math.floor(t / 0.045);
      if (f === frame) return;
      frame = f;
      const lines: { pts: THREE.Vector3[]; w: number; v: number }[] = [];
      for (let i = 0; i < n; i++) {
        const v = level(i, t);
        if (v <= 0) break;
        const b = tiles[i];
        const amp = b.size.x * 0.09;
        // 绕牌一圈：在牌的四周、上下厚度之间乱跳
        const m = 22;
        const start = Math.random();
        const loop: THREE.Vector3[] = [];
        for (let j = 0; j <= m; j++) {
          const [x, y] = rim(b, start + j / m, b.size.x * 0.12);
          const jit = j === m ? loop[0] : null;
          loop.push(jit ? jit.clone() : onTile(b, x + (Math.random() - 0.5) * 2 * amp, y + (Math.random() - 0.5) * 2 * amp, (Math.random() - 0.3) * b.size.z));
        }
        lines.push({ pts: loop, w: 1, v });
        // 偶尔有一道从牌面上横穿过去
        if (Math.random() < 0.2) {
          const a = rim(b, Math.random(), b.size.x * 0.1);
          const c = rim(b, Math.random(), b.size.x * 0.1);
          const from = onTile(b, a[0], a[1], b.size.z * 0.6);
          const to = onTile(b, c[0], c[1], b.size.z * 0.6);
          lines.push({ pts: jagged(from, to, 6, amp * 1.5).map((p) => p.setY(Math.max(p.y, from.y))), w: 0.7, v });
        }
        // 和前一张连上
        if (i > 0) {
          const p = tiles[i - 1];
          const from = onTile(p, p.size.x * 0.55, (Math.random() - 0.5) * p.size.y * 0.6, p.size.z * 0.3);
          const to = onTile(b, -b.size.x * 0.55, (Math.random() - 0.5) * b.size.y * 0.6, b.size.z * 0.3);
          lines.push({ pts: jagged(from, to, 4, amp), w: 0.8, v });
        }
      }
      for (const [mesh, w] of [
        [glow, unit * 0.42],
        [core, unit * 0.08],
      ] as const) {
        const pos: number[] = [];
        const uv: number[] = [];
        const col: number[] = [];
        const index: number[] = [];
        for (const l of lines) {
          const r = ribbon(l.pts, eye, w * l.w, w * l.w);
          const base = pos.length / 3;
          pos.push(...r.pos);
          uv.push(...r.uv);
          for (let j = 0; j < r.pos.length / 3; j++) col.push(l.v, l.v, l.v);
          index.push(...r.index.map((x) => x + base));
        }
        mesh.geometry.dispose();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(index);
        mesh.geometry = geo;
      }
    });
    return sweep + 0.3;
  }

  // 火焰包住手牌：从 tiles[0] 开始每 step 秒点着一张，火苗从牌的四周往上蹿，走到最后一张后再烧 hold 秒、熄掉。
  // 返回走到最后一张、点着要多久
  fire(tiles: TileBox[], step = 0.07, hold = 1): number {
    const n = tiles.length;
    const sweep = (n - 1) * step;
    const fade = 0.5;
    const duration = sweep + hold + fade;
    const stopAt = sweep + hold; // 这之后不再冒新的火苗
    const group = new THREE.Group();
    const halos = this.halos(tiles, '#ff7a1a', group);
    const per = 46; // 每张牌同时有多少火苗
    const count = n * per;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const uniforms = { map: { value: this.glow }, uHalfH: { value: 400 } };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    const buf = new THREE.Vector2();
    pts.onBeforeRender = (r) => (uniforms.uHalfH.value = r.getDrawingBufferSize(buf).y / 2);
    group.add(pts);
    // 每个火苗：从哪冒出来、往哪飘、一次烧多久、第几轮（换一轮重新找位置）
    const life = new Float32Array(count);
    const phase = new Float32Array(count);
    const cycle = new Int32Array(count).fill(-1);
    const from: THREE.Vector3[] = [];
    const vel: THREE.Vector3[] = [];
    for (let j = 0; j < count; j++) {
      life[j] = 0.38 + Math.random() * 0.3;
      phase[j] = Math.random() * life[j];
      from.push(new THREE.Vector3());
      vel.push(new THREE.Vector3());
    }
    const c = new THREE.Color();
    let lit = 0;
    this.add(group, duration, (k) => {
      const t = k * duration;
      const out = t > stopAt ? Math.max(0, 1 - (t - stopAt) / fade) : 1;
      halos.forEach((m, i) => {
        const r = t - i * step;
        m.opacity = r < 0 ? 0 : Math.min(1, r * 6) * (0.75 + Math.random() * 0.2) * out;
      });
      while (lit < n && t >= lit * step) {
        const b = tiles[lit++];
        this.flash(onTile(b, 0, 0, b.size.z), '#ffb347', b.size.x * 3, 0.3);
      }
      for (let j = 0; j < count; j++) {
        const i = Math.floor(j / per);
        const b = tiles[i];
        const age0 = t - i * step - phase[j];
        const cy = Math.floor(age0 / life[j]);
        const born = i * step + phase[j] + cy * life[j];
        if (age0 < 0 || born > stopAt) {
          size[j] = 0;
          continue;
        }
        if (cy !== cycle[j]) {
          cycle[j] = cy;
          // 牌四周（一部分从牌面上）冒出来，往上蹿，稍微往外飘
          const top = Math.random() < 0.12;
          const [x, y] = top ? [(Math.random() - 0.5) * b.size.x, (Math.random() - 0.5) * b.size.y] : rim(b, Math.random(), b.size.x * 0.05);
          from[j].copy(onTile(b, x, y, top ? b.size.z / 2 : (Math.random() - 0.5) * b.size.z));
          const outward = onTile(b, x, y, 0).sub(b.pos).setY(0).multiplyScalar(0.6);
          vel[j].set((Math.random() - 0.5) * 0.5, (2.2 + Math.random() * 1.6) * b.size.x, (Math.random() - 0.5) * 0.5).add(outward);
        }
        const age = age0 - cy * life[j];
        const u = age / life[j];
        const p = from[j].clone().addScaledVector(vel[j], age);
        // 火苗往上收拢，左右摆一点
        p.x += Math.sin(age * 18 + j) * 0.06 * b.size.x;
        pos[j * 3] = p.x;
        pos[j * 3 + 1] = p.y;
        pos[j * 3 + 2] = p.z;
        size[j] = b.size.x * (0.55 + 0.75 * Math.sin(Math.PI * Math.min(1, u * 1.4))) * (1 - u * 0.5);
        fireColor(u, c).multiplyScalar(out * 0.9);
        col[j * 3] = c.r;
        col[j * 3 + 1] = c.g;
        col[j * 3 + 2] = c.b;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
    });
    return sweep + 0.3;
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

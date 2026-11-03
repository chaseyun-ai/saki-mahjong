import * as THREE from 'three';

// 薄墨初美的里鬼门：东风、北风都鸣出来以后，紫色的风绕着牌桌打转、一圈圈往桌上聚。
// level 0–1：照她小四喜的进度，越接近听牌风越多，听牌时最多。浓淡渐变，不是一下子出现。
// 每一缕风是一条弯弯的光带（头亮尾淡），沿螺旋往里卷，卷到桌子中间附近散掉，再从外圈生出来。
// release()：和牌时风一下子散掉（往上冲的那一下由 Effects.galeBurst 放）

const STREAKS = 160; // 最多几缕
const SEG = 14; // 每缕分几段
const PALETTE = ['#c23cff', '#e04cff', '#9b3cff', '#ff5ae6', '#b45cff', '#f0a8ff'];

// 横向中间亮、两边透明的光带贴图
function stripTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 桌面中间一团柔和的紫光
function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Streak {
  rank: number; // 0–1：level 比它大才出现
  theta: number; // 头所在的角度
  r: number; // 头离中心多远
  y: number;
  span: number; // 拖多长（弧度）
  width: number;
  omega: number; // 转多快（弧度/秒）
  inward: number; // 往里卷多快（单位/秒）
  tilt: number; // 光带的宽往上翘多少（0 平铺在桌面上方，1 竖着）
  wobble: number;
  color: THREE.Color;
  on: number; // 0–1 渐显
}

export class Gale {
  readonly group = new THREE.Group();
  private streaks: Streak[] = [];
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private col: Float32Array;
  private mat: THREE.MeshBasicMaterial;
  private glow: THREE.Mesh;
  private level = 0;
  private shown = 0;
  private fade = 1; // release 以后往 0 掉
  private t = 0;

  // outer：从多远卷进来；inner：卷到多近散掉
  constructor(
    private outer = 22,
    private inner = 3,
  ) {
    const n = STREAKS * (SEG + 1) * 2;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const index: number[] = [];
    for (let s = 0; s < STREAKS; s++) {
      for (let i = 0; i <= SEG; i++) {
        const v = (s * (SEG + 1) + i) * 2;
        uv.set([0, i / SEG, 1, i / SEG], v * 2);
        if (i > 0) index.push(v - 2, v - 1, v, v - 1, v + 1, v);
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(index);
    this.mat = new THREE.MeshBasicMaterial({
      map: stripTexture(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#a83cff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.05;
    this.glow.renderOrder = 1;
    this.group.add(this.glow, mesh);
    this.group.visible = false;
    for (let s = 0; s < STREAKS; s++) {
      const st: Streak = {
        rank: (s * 0.61803) % 1,
        theta: 0,
        r: 0,
        y: 0,
        span: 0,
        width: 0,
        omega: 0,
        inward: 0,
        tilt: 0,
        wobble: 0,
        color: new THREE.Color(),
        on: 0,
      };
      this.respawn(st, true);
      this.streaks.push(st);
    }
  }

  // 从外圈重新生出来（first：开头那一次撒在整个螺旋上，不是全挤在外圈）
  private respawn(s: Streak, first = false): void {
    s.theta = Math.random() * Math.PI * 2;
    s.r = first ? this.inner + Math.random() * (this.outer - this.inner) : this.outer * (0.85 + Math.random() * 0.2);
    // 大多贴着牌桌转，少数飘得高一点
    s.y = 0.3 + Math.pow(Math.random(), 2) * 2.6;
    s.span = 0.35 + Math.random() * 0.75;
    s.width = 0.14 + Math.random() * 0.24;
    s.omega = 0.9 + Math.random() * 1.1;
    s.inward = 1.2 + Math.random() * 2.2;
    s.tilt = 0.25 + Math.random() * 0.6;
    s.wobble = Math.random() * Math.PI * 2;
    s.color.set(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    s.on = 0;
  }

  setLevel(level: number): void {
    const v = Math.max(0, Math.min(1, level));
    // 新的一局又聚起来：撤掉散掉的状态
    if (v > 0 && this.level === 0) this.fade = 1;
    this.level = v;
  }

  // 和牌那一下：风一下子散掉
  release(): void {
    this.fade = Math.min(this.fade, 0.999);
  }

  update(dt: number): void {
    this.t += dt;
    this.shown += (this.level - this.shown) * (1 - Math.exp(-dt * 1.2));
    if (this.level === 0 && this.shown < 0.01) this.shown = 0;
    if (this.fade < 1) this.fade = Math.max(0, this.fade - dt * 1.6);
    const amount = this.shown * this.fade;
    this.group.visible = amount > 0.005;
    if (!this.group.visible) return;
    // 越接近听牌转得越急
    const speed = 0.7 + 0.6 * this.shown;
    const up = new THREE.Vector3(0, 1, 0);
    const radial = new THREE.Vector3();
    const p = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let i = 0; i < STREAKS; i++) {
      const s = this.streaks[i];
      s.theta += s.omega * speed * dt;
      // 越往里卷越快
      s.r -= s.inward * speed * dt * (0.6 + (this.outer / Math.max(s.r, 1)) * 0.2);
      if (s.r < this.inner) this.respawn(s);
      const want = s.rank < this.shown ? 1 : 0;
      s.on += (want - s.on) * (1 - Math.exp(-dt * 2.5));
      // 外圈渐显、卷到中间渐隐
      const life = Math.min(1, (this.outer * 1.05 - s.r) / 3) * Math.min(1, (s.r - this.inner) / 2.5);
      const alpha = Math.max(0, life) * s.on * this.fade;
      const yy = s.y + Math.sin(this.t * 1.3 + s.wobble) * 0.35;
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG; // 0 是头，1 是尾
        const a = s.theta - u * s.span;
        // 尾巴在外面一点：螺旋
        const r = s.r + u * s.span * 2.2;
        radial.set(Math.cos(a), 0, Math.sin(a));
        p.set(radial.x * r, yy + Math.sin(u * 3 + s.wobble) * 0.25, radial.z * r);
        side.copy(up).multiplyScalar(s.tilt).addScaledVector(radial, 1 - s.tilt).normalize();
        const w = s.width * (1 - u * 0.6) * (0.6 + 0.4 * Math.min(1, r / 8));
        const v = (i * (SEG + 1) + k) * 2;
        this.pos[v * 3] = p.x - side.x * w;
        this.pos[v * 3 + 1] = p.y - side.y * w;
        this.pos[v * 3 + 2] = p.z - side.z * w;
        this.pos[v * 3 + 3] = p.x + side.x * w;
        this.pos[v * 3 + 4] = p.y + side.y * w;
        this.pos[v * 3 + 5] = p.z + side.z * w;
        // 头亮尾淡（加法混合：颜色越暗越透明）
        const b = alpha * Math.pow(1 - u, 1.2) * (u < 0.08 ? 2.2 : 1.6);
        for (const o of [0, 3]) {
          this.col[v * 3 + o] = s.color.r * b;
          this.col[v * 3 + o + 1] = s.color.g * b;
          this.col[v * 3 + o + 2] = s.color.b * b;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    // 桌面中间的紫光：聚得越多越亮，轻轻一明一暗
    const gm = this.glow.material as THREE.MeshBasicMaterial;
    gm.opacity = amount * (0.28 + 0.06 * Math.sin(this.t * 2.4));
    this.glow.scale.setScalar(this.inner * 3 + amount * 10);
  }
}

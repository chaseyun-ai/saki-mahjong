import * as THREE from 'three';

// 高鸭稳乃的深山：牌山上的白雾。几级就有多浓，0 是没有。
// 一团团柔和的白色云片贴着四排牌山慢慢飘，浓淡跟着级数渐变（不是一下子出现）。

const PER_WALL = 14; // 每排牌山最多几团雾
const MAX_LEVEL = 4;
// 每级：亮出来几成的雾团、雾的不透明度、雾团大小
const SHOWN = [0, 0.5, 0.7, 0.85, 1];
const OPACITY = [0, 0.38, 0.52, 0.64, 0.76];
const SIZE = [0, 2.6, 3.0, 3.4, 3.9];

// 柔和的云片：几个错开的径向渐变叠在一起，边缘完全透明
function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const blobs = [
    [64, 64, 52, 0.55],
    [44, 72, 34, 0.5],
    [86, 58, 32, 0.45],
    [62, 48, 28, 0.4],
    [76, 80, 26, 0.4],
  ];
  for (const [x, y, r, a] of blobs) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.6, `rgba(255,255,255,${a * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Puff {
  sprite: THREE.Sprite;
  wall: number;
  u: number; // 沿这排牌山的位置（0–1）
  rank: number; // 0–1，级数低时只亮 rank 小的
  phase: number;
  speed: number;
}

export class WallMist {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private level = 0;
  private shown = 0; // 现在显示的浓度（往 level 渐变）
  private ends: [THREE.Vector3, THREE.Vector3][] = [];
  private t = 0;

  constructor() {
    const tex = cloudTexture();
    for (let wall = 0; wall < 4; wall++) {
      for (let i = 0; i < PER_WALL; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, color: '#f4f7fa', transparent: true, opacity: 0, depthWrite: false, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 5;
        sprite.visible = false;
        this.group.add(sprite);
        // 按位置错开 rank，雾少的时候也是整排都有、只是稀
        const rank = ((i * 7) % PER_WALL) / PER_WALL;
        this.puffs.push({ sprite, wall, u: (i + 0.5) / PER_WALL, rank, phase: Math.random() * Math.PI * 2, speed: 0.04 + Math.random() * 0.05 });
      }
    }
  }

  // 四排牌山两端（世界坐标，牌山顶上的高度）。座位、视角变了要重新给
  setWalls(ends: [THREE.Vector3, THREE.Vector3][]): void {
    this.ends = ends;
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(MAX_LEVEL, level));
  }

  update(dt: number): void {
    this.t += dt;
    // 渐浓、渐淡：大约两秒到位
    this.shown += (this.level - this.shown) * (1 - Math.exp(-dt * 1.5));
    if (this.level === 0 && this.shown < 0.01) this.shown = 0;
    const lv = this.shown;
    const lo = Math.floor(lv);
    const f = lv - lo;
    const mix = (arr: number[]) => arr[lo] + ((arr[Math.min(MAX_LEVEL, lo + 1)] ?? arr[lo]) - arr[lo]) * f;
    const shown = mix(SHOWN);
    const opacity = mix(OPACITY);
    const size = mix(SIZE);
    this.group.visible = lv > 0 && this.ends.length === 4;
    if (!this.group.visible) return;
    for (const p of this.puffs) {
      const on = p.rank < shown;
      p.sprite.visible = on;
      if (!on) continue;
      const [a, b] = this.ends[p.wall];
      // 沿牌山来回飘，上下轻轻起伏
      const u = p.u + Math.sin(this.t * p.speed * 2 + p.phase) * 0.04;
      p.sprite.position.lerpVectors(a, b, u);
      p.sprite.position.y += 0.35 + Math.sin(this.t * 0.6 + p.phase) * 0.15;
      const breathe = 0.85 + 0.15 * Math.sin(this.t * 0.8 + p.phase * 1.7);
      // 刚亮出来的雾团从淡到浓
      const edge = Math.min(1, (shown - p.rank) * 6);
      (p.sprite.material as THREE.SpriteMaterial).opacity = opacity * breathe * edge;
      const s = size * (0.85 + 0.3 * ((p.phase / (Math.PI * 2)) % 1));
      p.sprite.scale.set(s * 1.4, s, 1);
    }
  }
}

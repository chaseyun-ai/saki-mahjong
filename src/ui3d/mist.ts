import * as THREE from 'three';

// 高鸭稳乃的深山：牌山上的白雾。几级就有多浓，0 是没有。
// 每一墩牌山上方一团柔和的白色云片，原地轻轻飘，浓淡跟着级数渐变（不是一下子出现）。
// 只罩在还有牌的地方：一墩摸空了，它上面的雾就散掉；雾团不比一墩半宽多少，不会飘到空的桌面上。

export const STACKS = 17; // 每排牌山几墩
const MAX_LEVEL = 4;
// 每级：亮出来几成的雾团、雾的不透明度、雾团大小
const SHOWN = [0, 0.5, 0.7, 0.85, 1];
const OPACITY = [0, 0.55, 0.7, 0.82, 0.9];
const SIZE = [0, 2.1, 2.35, 2.6, 2.85];

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
  stack: number; // 0..16
  rank: number; // 0–1，级数低时只亮 rank 小的
  phase: number;
  presence: number; // 0–1：底下有没有牌（渐变，摸空了慢慢散）
}

// 一墩牌山：雾团放在哪（世界坐标，牌山顶上），底下还有没有牌
export interface MistStack {
  pos: THREE.Vector3;
  filled: boolean;
}

export class WallMist {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private level = 0;
  private shown = 0; // 现在显示的浓度（往 level 渐变）
  private stacks: MistStack[][] = [];
  private t = 0;

  constructor() {
    const tex = cloudTexture();
    for (let wall = 0; wall < 4; wall++) {
      for (let i = 0; i < STACKS; i++) {
        const mat = new THREE.SpriteMaterial({ map: tex, color: '#f4f7fa', transparent: true, opacity: 0, depthWrite: false, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 5;
        sprite.visible = false;
        this.group.add(sprite);
        // 按位置错开 rank，雾少的时候也是整排都有、只是稀
        const rank = ((i * 7) % STACKS) / STACKS;
        this.puffs.push({ sprite, wall, stack: i, rank, phase: Math.random() * Math.PI * 2, presence: 0 });
      }
    }
  }

  // 四排牌山每一墩的位置和有没有牌（stacks[wall][stack]）。每次牌局变了都给
  setStacks(stacks: MistStack[][]): void {
    this.stacks = stacks;
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
    this.group.visible = lv > 0 && this.stacks.length === 4;
    if (!this.group.visible) return;
    const fade = 1 - Math.exp(-dt * 3);
    for (const p of this.puffs) {
      const row = this.stacks[p.wall];
      const here = row[p.stack];
      // 底下有牌才有雾；两边都空了的孤零零一墩，雾也小一点
      const neighbours = [row[p.stack - 1], row[p.stack + 1]].filter((x) => x?.filled).length;
      const want = here?.filled ? 0.6 + 0.2 * neighbours : 0;
      p.presence += (want - p.presence) * fade;
      const on = p.rank < shown && p.presence > 0.02 && !!here;
      p.sprite.visible = on;
      if (!on) continue;
      // 原地轻轻起伏、左右晃一点（不超过半墩）
      p.sprite.position.copy(here.pos);
      const drift = Math.sin(this.t * 0.35 + p.phase) * 0.25;
      const prev = row[Math.max(0, p.stack - 1)].pos;
      const next = row[Math.min(STACKS - 1, p.stack + 1)].pos;
      p.sprite.position.addScaledVector(next.clone().sub(prev).normalize(), drift);
      p.sprite.position.y += 0.3 + Math.sin(this.t * 0.6 + p.phase) * 0.12;
      const breathe = 0.85 + 0.15 * Math.sin(this.t * 0.8 + p.phase * 1.7);
      // 刚亮出来的雾团从淡到浓
      const edge = Math.min(1, (shown - p.rank) * 6);
      (p.sprite.material as THREE.SpriteMaterial).opacity = opacity * breathe * edge * Math.min(1, p.presence);
      const s = size * (0.9 + 0.2 * ((p.phase / (Math.PI * 2)) % 1)) * (0.6 + 0.4 * Math.min(1, p.presence));
      p.sprite.scale.set(s * 1.15, s * 0.8, 1);
    }
  }
}

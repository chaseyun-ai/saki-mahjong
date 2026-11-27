import type { Game } from '../engine/game';
import { STACKS_PER_WALL } from '../engine/wall';
import { wallSlots } from '../ui3d/wallLayout';
import { fogNoise } from './fogNoise';
import { MistLook, MistTone, mistCover, stackDepth } from './mistLook';

// 2D 牌桌上高鸭稳乃的深山。2D 不画牌山，但牌山该在的地方（牌河外面、手牌里面的那一圈）照样起雾：
// 和 2.5D、3D 同一套算法（mistLook.ts），从王牌那头顺着这一圈往前漫，标记越多罩得越长、越浓；摸空了的那一段雾散掉。
// 雾铺在牌底下（桌布上面），牌河、手牌、中间的信息都压在雾上，不挡字。
//
// 画法：一圈雾团（每两墩一团），每团是一张事先画好的雾的小图，只用 CSS 改透明度、慢慢挪和转，
// 不占每帧的脚本时间；不跟着牌桌重画，动画不会断。桌上没有雾的时候不建。

// 牌山这一圈在 2D 牌桌（1040×800）上的位置：中心，和四边离中心多远、每墩多宽
const CENTER = { x: 520, y: 375 };
const RING = [
  { away: 316, pitch: 34 }, // 自己面前（下）
  { away: 322, pitch: 33 }, // 下家（右）
  { away: 306, pitch: 34 }, // 对家（上）
  { away: 322, pitch: 33 }, // 上家（左）
];
const PER_BLOB = 2; // 几墩一团
const BLOBS = Math.ceil(STACKS_PER_WALL / PER_BLOB); // 每边 9 团
const SIZE = 118; // 一团雾多大（像素）
const SPRITE = 128; // 雾的小图边长
const SPREAD = 1.5; // 起雾时从最深处漫到前沿要几秒

const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

// 雾团的小图：圆的，边上被噪声啃成一缕一缕的，浓的地方白、薄的地方带点青灰。和 3D 着色器里是同一个式子
const sprites = new Map<boolean, string[]>();
function fogSprites(tone: MistTone): string[] {
  const made = sprites.get(tone.pale);
  if (made) return made;
  const a = fogNoise(SPRITE, 7);
  const b = fogNoise(SPRITE, 23, 8, 3);
  const [lit, dim] = [tone.light, tone.shade];
  const out = [0, 1].map((variant) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SPRITE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const img = ctx.createImageData(SPRITE, SPRITE);
    const shift = variant * 53;
    for (let y = 0; y < SPRITE; y++) {
      for (let x = 0; x < SPRITE; x++) {
        const u = (x + 0.5) / SPRITE * 2 - 1;
        const v = (y + 0.5) / SPRITE * 2 - 1;
        const fall = Math.max(0, 1 - (u * u + v * v));
        const n = a[((y + shift) % SPRITE) * SPRITE + ((x + shift * 2) % SPRITE)] * 0.6 + b[((y * 2 + shift) % SPRITE) * SPRITE + ((x * 2) % SPRITE)] * 0.4;
        const wisp = smooth((n - 0.3) / 0.4);
        const alpha = smooth((fall * fall * (0.6 + 1.1 * wisp) - 0.22) / 0.5) * (0.5 + 0.5 * wisp);
        const light = Math.min(1, 0.15 + 0.85 * wisp);
        const i = (y * SPRITE + x) * 4;
        for (let c = 0; c < 3; c++) img.data[i + c] = dim[c] + (lit[c] - dim[c]) * light;
        img.data[i + 3] = alpha * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  });
  sprites.set(tone.pale, out);
  return out;
}

const rand = (a: number, b: number): number => {
  const x = Math.sin(a * 91.7 + b * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// 从谁的视角看，谁面前、第几墩（1..17）的牌山在牌桌上的位置
export function stackSpot2d(me: number, wall: number, stack: number): { x: number; y: number } {
  const rel = (wall - me + 4) % 4;
  const { away, pitch } = RING[rel];
  // 第 1 墩在这一家的右手边
  const along = (9 - stack) * pitch;
  if (rel === 0) return { x: CENTER.x + along, y: CENTER.y + away };
  if (rel === 1) return { x: CENTER.x + away, y: CENTER.y - along };
  if (rel === 2) return { x: CENTER.x - along, y: CENTER.y - away };
  return { x: CENTER.x - away, y: CENTER.y + along };
}

export class Mist2D {
  readonly el: HTMLDivElement;
  private blobs: HTMLElement[] = [];
  private shown: number[] = []; // 每团现在的透明度
  private placed = ''; // 雾团按谁的视角摆的
  private pale: boolean | null = null; // 小图是照深色还是浅色桌布画的

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'mist2d';
  }

  private build(): void {
    for (let n = 0; n < 4 * BLOBS; n++) {
      const b = document.createElement('i');
      if (n % 2) b.className = 'b';
      // 每团挪多远、转多少、多快都不一样
      const r = (k: number) => rand(n, k);
      b.style.cssText = `--dx:${Math.round((r(1) - 0.5) * 22)}px;--dy:${Math.round((r(2) - 0.5) * 22)}px;--a0:${Math.round(r(3) * 360)}deg;--a1:${Math.round(r(3) * 360 + (r(4) - 0.5) * 70)}deg;--s:${(0.9 + r(5) * 0.35).toFixed(2)};--t:${(9 + r(6) * 8).toFixed(1)}s;--p:${(-r(7) * 12).toFixed(1)}s`;
      this.el.append(b);
      this.blobs.push(b);
      this.shown.push(0);
    }
  }

  // 每次重画牌桌都调：雾的样子（没有是 null）、牌局、从谁的视角看、照桌布挑的颜色
  set(look: MistLook | null, g: Game, me: number, tone: MistTone): void {
    if (!look && !this.blobs.length) return;
    if (!this.blobs.length) this.build();
    if (look && this.pale !== tone.pale) {
      this.pale = tone.pale;
      const [s0, s1] = fogSprites(tone);
      this.el.style.setProperty('--mist-a', `url(${s0})`);
      this.el.style.setProperty('--mist-b', `url(${s1})`);
    }
    this.el.classList.toggle('on', !!look);
    if (this.placed !== String(me)) {
      this.placed = String(me);
      for (let w = 0; w < 4; w++) {
        for (let b = 0; b < BLOBS; b++) {
          const first = b * PER_BLOB + 1;
          const last = Math.min(STACKS_PER_WALL, first + PER_BLOB - 1);
          const p = stackSpot2d(me, w, (first + last) / 2);
          const el = this.blobs[w * BLOBS + b];
          el.style.left = `${Math.round(p.x - SIZE / 2)}px`;
          el.style.top = `${Math.round(p.y - SIZE / 2)}px`;
        }
      }
    }
    // 还有牌的墩
    const filled = new Uint8Array(4 * STACKS_PER_WALL);
    if (look) for (const slot of wallSlots(g).values()) filled[slot.wall * STACKS_PER_WALL + slot.stack - 1] = 1;
    const sum = g.dice[0] + g.dice[1];
    for (let w = 0; w < 4; w++) {
      for (let b = 0; b < BLOBS; b++) {
        let cover = 0;
        let depth = Infinity;
        let count = 0;
        for (let s = b * PER_BLOB + 1; s <= Math.min(STACKS_PER_WALL, (b + 1) * PER_BLOB); s++) {
          const d = stackDepth(g.dealer, sum, w, s);
          depth = Math.min(depth, d);
          cover += filled[w * STACKS_PER_WALL + s - 1] ? mistCover(look, d) : 0;
          count++;
        }
        const n = w * BLOBS + b;
        const o = look ? Math.round((cover / count) * (0.28 + 0.36 * look.density) * 100) / 100 : 0;
        if (o === this.shown[n]) continue;
        const el = this.blobs[n];
        // 起雾：从最深处一团接一团地漫过来；散：一起散
        el.style.setProperty('--d', o > this.shown[n] && look ? `${((depth / Math.max(12, look.reach)) * SPREAD).toFixed(2)}s` : '0s');
        el.style.setProperty('--o', String(o));
        el.classList.toggle('on', o > 0);
        this.shown[n] = o;
      }
    }
  }
}

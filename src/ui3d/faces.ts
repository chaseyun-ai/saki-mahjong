import * as THREE from 'three';
import { KIND_COUNT, TileId, isRed, kindOf } from '../engine/tiles';
import { FACE_H, FACE_W, faceSvg } from '../ui/tileArt';

// 把 34 种牌加 3 张赤牌的 SVG 牌面画进一张贴图，每张牌的正面用自己那一格的 UV

const COLS = 8;
const ROWS = 5;
const CELL_W = 160;
const CELL_H = Math.round((CELL_W * FACE_H) / FACE_W);
const FACE_COUNT = KIND_COUNT + 3;

export function faceIndex(id: TileId): number {
  if (!isRed(id)) return kindOf(id);
  return KIND_COUNT + [4, 13, 22].indexOf(kindOf(id));
}

function faceKind(index: number): { kind: number; red: boolean } {
  if (index < KIND_COUNT) return { kind: index, red: false };
  return { kind: [4, 13, 22][index - KIND_COUNT], red: true };
}

export class FaceAtlas {
  readonly texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = COLS * CELL_W;
    this.canvas.height = ROWS * CELL_H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  // SVG 转成图片是异步的，画完后刷新贴图
  async draw(): Promise<void> {
    const ctx = this.canvas.getContext('2d')!;
    await Promise.all(
      Array.from({ length: FACE_COUNT }, async (_, i) => {
        const { kind, red } = faceKind(i);
        const svg = faceSvg(kind, red).replace('width="100%" height="100%"', `width="${CELL_W}" height="${CELL_H}"`);
        const img = new Image();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await img.decode();
        const x = (i % COLS) * CELL_W;
        const y = Math.floor(i / COLS) * CELL_H;
        ctx.drawImage(img, x + CELL_W * 0.06, y + CELL_H * 0.06, CELL_W * 0.88, CELL_H * 0.88);
      }),
    );
    this.texture.needsUpdate = true;
  }

  // 把一张牌面画到别的 canvas 上（控制台上的宝牌指示牌）
  drawFace(ctx: CanvasRenderingContext2D, index: number, x: number, y: number, w: number, h: number): void {
    ctx.drawImage(this.canvas, (index % COLS) * CELL_W, Math.floor(index / COLS) * CELL_H, CELL_W, CELL_H, x, y, w, h);
  }

  // 一张牌正面的平面，UV 对准图集里的那一格
  faceGeometry(index: number, w: number, h: number): THREE.PlaneGeometry {
    const g = new THREE.PlaneGeometry(w, h);
    const u0 = (index % COLS) / COLS;
    const v1 = 1 - Math.floor(index / COLS) / ROWS;
    const u1 = u0 + 1 / COLS;
    const v0 = v1 - 1 / ROWS;
    const uv = g.attributes.uv as THREE.BufferAttribute;
    // PlaneGeometry 的顶点顺序：左上、右上、左下、右下
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
    return g;
  }
}

export const FACE_TOTAL = FACE_COUNT;

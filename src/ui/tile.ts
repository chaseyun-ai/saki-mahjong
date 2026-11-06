import { TileId, isRed, kindOf } from '../engine/tiles';
import { sketchFaceSvg } from './sketchArt';
import { faceSvg } from './tileArt';

// top：2D 牌桌上别家立着的手牌，从上往下看只看得到牌的顶边（牌背一半、牌面一半）
export type TileSize = 'hand' | 'pond' | 'mini' | 'top';

export interface TileOpts {
  size?: TileSize;
  sideways?: boolean;
  classes?: string[];
  data?: Record<string, string | number>;
  // 手绘风格的牌面（爱丽丝的手绘板）；不写就跟着 setSketchTiles
  sketch?: boolean;
  // 写在牌上的内联样式（比如动画用的 CSS 变量）
  style?: string;
  // 接在牌面后面的额外内容（比如初美东、北上的字形光柱）
  after?: string;
}

// 2D 牌桌变成手绘板时，所有牌都画成手绘风格（爱丽丝）
let sketchAll = false;
export function setSketchTiles(on: boolean): void {
  sketchAll = on;
}

// 34 种牌 × 是否赤牌，SVG 只生成一次
const faceCache = new Map<number, string>();

function face(id: TileId, sketch: boolean): string {
  const key = kindOf(id) * 2 + (isRed(id) ? 1 : 0) + (sketch ? 1000 : 0);
  let svg = faceCache.get(key);
  if (!svg) {
    svg = (sketch ? sketchFaceSvg : faceSvg)(kindOf(id), isRed(id));
    faceCache.set(key, svg);
  }
  return svg;
}

export function tileHtml(id: TileId, opts: TileOpts = {}): string {
  const sketch = opts.sketch ?? sketchAll;
  const cls = ['tile', `t-${opts.size ?? 'hand'}`, ...(opts.classes ?? [])];
  if (sketch) cls.push('sketch');
  if (isRed(id)) cls.push('red');
  if (opts.sideways) cls.push('sideways');
  const data = Object.entries(opts.data ?? {})
    .map(([key, v]) => ` data-${key}="${v}"`)
    .join('');
  const style = opts.style ? ` style="${opts.style}"` : '';
  return `<div class="${cls.join(' ')}"${data}${style}><div class="face">${face(id, sketch)}</div>${opts.after ?? ''}</div>`;
}

// 美穗子睁开右眼时，别人手牌的牌背按花色上色：万红、筒蓝、索绿、字牌白
export type BackTint = 'm' | 'p' | 's' | 'z' | 'aka';
export const tintOf = (t: TileId): BackTint => (['m', 'p', 's', 'z'] as const)[Math.min(3, Math.floor(kindOf(t) / 9))];

export function backHtml(size: TileSize = 'pond', tint?: BackTint): string {
  return `<div class="tile back t-${size}${tint ? ` tint tint-${tint}` : ''}${sketchAll ? ' sketch' : ''}"></div>`;
}

import { TileId, isRed, kindOf } from '../engine/tiles';
import { faceSvg } from './tileArt';

export type TileSize = 'hand' | 'pond' | 'mini';

export interface TileOpts {
  size?: TileSize;
  sideways?: boolean;
  classes?: string[];
  data?: Record<string, string | number>;
}

// 34 种牌 × 是否赤牌，SVG 只生成一次
const faceCache = new Map<number, string>();

function face(id: TileId): string {
  const key = kindOf(id) * 2 + (isRed(id) ? 1 : 0);
  let svg = faceCache.get(key);
  if (!svg) {
    svg = faceSvg(kindOf(id), isRed(id));
    faceCache.set(key, svg);
  }
  return svg;
}

export function tileHtml(id: TileId, opts: TileOpts = {}): string {
  const cls = ['tile', `t-${opts.size ?? 'hand'}`, ...(opts.classes ?? [])];
  if (isRed(id)) cls.push('red');
  if (opts.sideways) cls.push('sideways');
  const data = Object.entries(opts.data ?? {})
    .map(([key, v]) => ` data-${key}="${v}"`)
    .join('');
  return `<div class="${cls.join(' ')}"${data}><div class="face">${face(id)}</div></div>`;
}

// 美穗子睁开右眼时，别人手牌的牌背按花色上色：万红、筒蓝、索绿、字牌白
export type BackTint = 'm' | 'p' | 's' | 'z';
export const tintOf = (t: TileId): BackTint => (['m', 'p', 's', 'z'] as const)[Math.min(3, Math.floor(kindOf(t) / 9))];

export function backHtml(size: TileSize = 'pond', tint?: BackTint): string {
  return `<div class="tile back t-${size}${tint ? ` tint tint-${tint}` : ''}"></div>`;
}

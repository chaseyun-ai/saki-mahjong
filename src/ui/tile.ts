import { Kind, TileId, isRed, kindOf, numOf, suitOf } from '../engine/tiles';

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT_CN = ['萬', '筒', '索'];
const HONOR_CN = ['東', '南', '西', '北', '', '發', '中'];

export type TileSize = 'hand' | 'pond' | 'mini';

export interface TileOpts {
  size?: TileSize;
  sideways?: boolean;
  classes?: string[];
  data?: Record<string, string | number>;
}

export function kindFace(k: Kind): string {
  if (k < 27) {
    const suit = suitOf(k);
    return `<span class="t-num">${NUM_CN[numOf(k) - 1]}</span><span class="t-suit s${suit}">${SUIT_CN[suit]}</span>`;
  }
  if (k === 31) return '<span class="t-haku"></span>';
  return `<span class="t-honor h${k - 27}">${HONOR_CN[k - 27]}</span>`;
}

export function tileHtml(id: TileId, opts: TileOpts = {}): string {
  const k = kindOf(id);
  const cls = ['tile', `t-${opts.size ?? 'hand'}`, ...(opts.classes ?? [])];
  if (isRed(id)) cls.push('red');
  if (opts.sideways) cls.push('sideways');
  const data = Object.entries(opts.data ?? {})
    .map(([key, v]) => ` data-${key}="${v}"`)
    .join('');
  return `<div class="${cls.join(' ')}"${data}><div class="face">${kindFace(k)}</div></div>`;
}

export function backHtml(size: TileSize = 'pond'): string {
  return `<div class="tile back t-${size}"></div>`;
}

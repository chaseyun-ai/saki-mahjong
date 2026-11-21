import { POND_LOOKS, type PondStyle, pondJitter, pondRowDrift } from '../ui/vary';
import { POND_COLS, POND_GAP, POND_ROWS, TILE_H, TILE_W } from './tableLayout';

// 牌河里每张牌摆在哪：六张一行，立直牌横放。摆得多齐看这家的手风（vary.ts 的 pondStyleOf）。
// 只算位置，不碰牌桌：坐标是座位自己的（x 往右，z 朝出牌的人），牌桌再换成世界坐标

// 摆得松时行距加大，跟前放不下就整个往中间挪，最多挪这么多（再多会碰到牌河前的立直棒、别家牌河的角）
const POND_INWARD = 0.08;
// 摆得松的牌河里相邻两张牌之间至少留这么宽的缝
const POND_MIN_GAP = 0.015;
// 一行占的地方两头各让出这么一点，两行的牌怎么歪都碰不上
const BAND_MARGIN = 0.004;

export interface PondItem {
  tile: number;
  side: boolean; // 横放（立直宣言牌）
}

// 一张牌的位置：中心在哪，比摆正的时候多转了多少（横放的那 90° 不算在里面）
export interface PondSpot {
  x: number;
  z: number;
  yaw: number;
}

export interface PondRows {
  z0: number; // 第一行靠桌子中心的那条边
  pitch: number; // 一行占多深（牌长 + 行距）
}

// 牌河从哪里开始、一行占多深。pondZ 是照牌桌尺寸算的起点，wallInner 是跟前牌山靠里的那条边。
// 摆得松的行距大一点；跟前的牌山近（2.5D 的对家）放不下那么多，就整个往中间挪一点点，还不够再把行距收回来
export function pondRows(style: PondStyle, pondZ: number, wallInner: number): PondRows {
  const look = POND_LOOKS[style];
  const base = TILE_H + POND_GAP;
  if (!look.rowGap) return { z0: pondZ, pitch: base };
  const gaps = POND_ROWS - 1;
  const free = wallInner - 0.1 - (pondZ + POND_ROWS * TILE_H + gaps * POND_GAP);
  const inward = Math.min(POND_INWARD, Math.max(0, gaps * look.rowGap - free));
  const gap = Math.min(look.rowGap, Math.max(0, free + inward) / gaps);
  return { z0: pondZ - inward, pitch: base + gap };
}

// 转了 yaw 的牌左右、前后各占多宽（各一半）。w 是沿着这一行的边，h 是跨行的边
export function pondExtent(side: boolean, yaw: number): { hx: number; hz: number } {
  const w = side ? TILE_H : TILE_W;
  const h = side ? TILE_W : TILE_H;
  const sin = Math.abs(Math.sin(yaw));
  const cos = Math.abs(Math.cos(yaw));
  return { hx: (w * cos + h * sin) / 2, hz: (h * cos + w * sin) / 2 };
}

// items 是牌河里还留着的牌（被鸣走的不算），按打出来的先后。salt 每局换一个，同一张牌这一局一直歪成一样
export function pondSpots(items: PondItem[], style: PondStyle, salt: number, seat: number, rows: PondRows): PondSpot[] {
  const look = POND_LOOKS[style];
  // 摆得松的（随手、凌乱）：每张牌前后夹在自己这一行里，左右挨着上一张往右排，怎么歪都压不到别的牌。
  // 整齐、自然的照格子摆（自然的只歪一点点，格子之间的缝本来就够）
  const packed = look.rowGap > 0;
  const band = rows.pitch / 2 - BAND_MARGIN;
  const left = -((POND_COLS * (TILE_W + POND_GAP)) / 2);
  const out: PondSpot[] = [];
  let col = 0;
  let row = 0;
  let px = left;
  let drift = pondRowDrift(salt, seat, 0, style);
  let right = -Infinity;
  for (const it of items) {
    if (col === POND_COLS && row < POND_ROWS - 1) {
      col = 0;
      row++;
      px = left;
      drift = pondRowDrift(salt, seat, row, style);
      right = -Infinity;
    }
    const w = it.side ? TILE_H : TILE_W;
    const h = it.side ? TILE_W : TILE_H;
    const j = pondJitter(salt, it.tile, style);
    let x = px + w / 2 + j.dx;
    let dz = j.dz;
    let yaw = j.yaw;
    if (packed) {
      // 转得再多，前后也不能伸出这一行
      const most = Math.max(0, (2 * (band - h / 2)) / w);
      yaw = Math.max(-most, Math.min(most, yaw));
      const { hx, hz } = pondExtent(it.side, yaw);
      x = Math.max(x + drift.shift, right + POND_MIN_GAP + hx);
      right = x + hx;
      const room = Math.max(0, band - hz);
      dz = Math.max(-room, Math.min(room, dz + drift.slope * (col - (POND_COLS - 1) / 2)));
    }
    out.push({ x, z: rows.z0 + row * rows.pitch + TILE_H / 2 + dz, yaw });
    px += w + POND_GAP;
    col++;
  }
  return out;
}

// 牌的四个角（座位自己的坐标）
function corners(side: boolean, spot: PondSpot): [number, number][] {
  const w = (side ? TILE_H : TILE_W) / 2;
  const h = (side ? TILE_W : TILE_H) / 2;
  const c = Math.cos(spot.yaw);
  const s = Math.sin(spot.yaw);
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([x, z]) => [spot.x + x * c + z * s, spot.z - x * s + z * c]);
}

// 两张牌（凸四边形）是不是挨得比 gap 还近（分离轴）
function tooClose(a: [number, number][], b: [number, number][], gap: number): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const nx = (z1 - z0) / len;
      const nz = (x0 - x1) / len;
      const da = a.map(([x, z]) => x * nx + z * nz);
      const db = b.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...da) + gap <= Math.min(...db) || Math.max(...db) + gap <= Math.min(...da)) return false;
    }
  }
  return true;
}

// 横推的宣言牌撞上前一张：被撞的那张歪一点（knocks 记着哪张牌多歪了多少，弧度），往左让开到不压着撞它的那张；
// 再往左的牌要是被挤到了也跟着让一点。歪了以后会碰到上一行、下一行的牌就少歪一点。直接改 spots
export function applyKnocks(items: PondItem[], spots: PondSpot[], knocks: ReadonlyMap<number, number>): void {
  if (!knocks.size) return;
  const rowOf = (i: number) => Math.min(POND_ROWS - 1, Math.floor(i / POND_COLS));
  items.forEach((it, i) => {
    let yaw = knocks.get(it.tile);
    if (yaw === undefined) return;
    const row = rowOf(i);
    const base = spots[i].yaw;
    // 别的行里的牌：歪过去不能碰到它们
    const others = items.map((o, j) => (rowOf(j) === row ? null : corners(o.side, spots[j]))).filter((c) => c !== null);
    for (let n = 0; n < 12; n++) {
      const mine = corners(it.side, { ...spots[i], yaw: base + yaw });
      if (!others.some((o) => tooClose(mine, o, POND_MIN_GAP / 2))) break;
      yaw *= n < 11 ? 0.75 : 0;
    }
    spots[i].yaw = base + yaw;
    // 右边那张（撞它的宣言牌）不动；没有右边那张（被鸣走了）就只是歪着
    if (i + 1 >= items.length || rowOf(i + 1) !== row) return;
    let edge = spots[i + 1].x - pondExtent(items[i + 1].side, spots[i + 1].yaw).hx;
    for (let j = i; j >= 0 && rowOf(j) === row; j--) {
      const hx = pondExtent(items[j].side, spots[j].yaw).hx;
      const most = edge - POND_MIN_GAP - hx;
      if (spots[j].x <= most) break;
      spots[j].x = most;
      edge = most - hx;
    }
  });
}

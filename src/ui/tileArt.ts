import { Kind, numOf, suitOf } from '../engine/tiles';

// 牌面图案：万子和字牌用字，筒子画圆饼，索子画竹节。
// 输出完整的 SVG，2D 牌桌直接嵌入，3D 牌桌画成贴图。

export const FACE_W = 40;
export const FACE_H = 56;

const BLUE = '#1f5e9e';
const RED = '#c0392b';
const GREEN = '#1f7a45';
const INK = '#1c1c1c';

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_CN = ['東', '南', '西', '北', '', '發', '中'];
const FONT = "'Noto Serif SC','Songti SC','SimSun',serif";

type Dot = [number, number, string];

function circle([x, y, c]: Dot, r: number): string {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.74}" fill="#fff"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.52}" fill="${c}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.2}" fill="#fff"/>`
  );
}

function stick([x, y, c]: Dot, h: number): string {
  const w = 6.4;
  const top = y - h / 2;
  return (
    `<rect x="${x - w / 2}" y="${top}" width="${w}" height="${h}" rx="2.2" fill="${c}"/>` +
    `<rect x="${x - w / 2 + 1.2}" y="${top + 1}" width="1.2" height="${h - 2}" rx="0.6" fill="#fff" opacity="0.45"/>` +
    `<line x1="${x - w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y}" stroke="#fff" stroke-width="0.9" opacity="0.8"/>` +
    `<line x1="${x - w / 2}" y1="${top + 2}" x2="${x + w / 2}" y2="${top + 2}" stroke="#0d3b22" stroke-width="0.6"/>` +
    `<line x1="${x - w / 2}" y1="${top + h - 2}" x2="${x + w / 2}" y2="${top + h - 2}" stroke="#0d3b22" stroke-width="0.6"/>`
  );
}

function pinFace(n: number, red: boolean): string {
  const B = red ? RED : BLUE;
  const G = red ? RED : GREEN;
  const R = RED;
  switch (n) {
    case 1:
      return (
        `<circle cx="20" cy="28" r="15" fill="${red ? RED : GREEN}"/>` +
        `<circle cx="20" cy="28" r="12.5" fill="#fff"/>` +
        `<circle cx="20" cy="28" r="10.5" fill="${R}"/>` +
        `<circle cx="20" cy="28" r="7" fill="#fff"/>` +
        `<circle cx="20" cy="28" r="5" fill="${B}"/>` +
        `<circle cx="20" cy="28" r="1.8" fill="#fff"/>`
      );
    case 2:
      return [circle([20, 15, G], 9.5), circle([20, 41, B], 9.5)].join('');
    case 3:
      return [circle([9, 11, B], 7.5), circle([20, 28, R], 7.5), circle([31, 45, G], 7.5)].join('');
    case 4:
      return [
        circle([11, 15, B], 8),
        circle([29, 15, G], 8),
        circle([11, 41, G], 8),
        circle([29, 41, B], 8),
      ].join('');
    case 5:
      return [
        circle([10, 12, B], 7),
        circle([30, 12, G], 7),
        circle([20, 28, R], 7),
        circle([10, 44, G], 7),
        circle([30, 44, B], 7),
      ].join('');
    case 6:
      return [
        circle([11, 10, G], 6.5),
        circle([29, 10, G], 6.5),
        circle([11, 29, R], 6.5),
        circle([29, 29, R], 6.5),
        circle([11, 46, R], 6.5),
        circle([29, 46, R], 6.5),
      ].join('');
    case 7:
      return [
        circle([8, 8, G], 5.5),
        circle([20, 13, G], 5.5),
        circle([32, 18, G], 5.5),
        circle([11, 33, R], 6),
        circle([29, 33, R], 6),
        circle([11, 47, R], 6),
        circle([29, 47, R], 6),
      ].join('');
    case 8:
      return [8, 21, 34, 47].flatMap((y) => [circle([11, y, B], 5.8), circle([29, y, B], 5.8)]).join('');
    default:
      return [
        [11, B],
        [28, R],
        [45, G],
      ]
        .flatMap(([y, c]) => [8, 20, 32].map((x) => circle([x, y as number, c as string], 5.6)))
        .join('');
  }
}

function souFace(n: number, red: boolean): string {
  const G = red ? RED : GREEN;
  const R = RED;
  switch (n) {
    case 1:
      // 一索：一只小鸟
      return (
        `<path d="M8 40 Q4 22 14 14 L18 22 Q12 28 14 40 Z" fill="${R}"/>` +
        `<path d="M10 44 Q6 30 12 24 L16 30 Q12 36 14 44 Z" fill="${BLUE}"/>` +
        `<ellipse cx="22" cy="32" rx="9" ry="11" fill="${G}"/>` +
        `<circle cx="27" cy="17" r="5.5" fill="${G}"/>` +
        `<path d="M32 16 L37 18 L32 20 Z" fill="${R}"/>` +
        `<circle cx="28.5" cy="16" r="1.2" fill="#fff"/>` +
        `<path d="M18 43 L16 51 M24 43 L26 51" stroke="${R}" stroke-width="1.6"/>` +
        `<path d="M17 30 Q22 36 27 30" stroke="#fff" stroke-width="1" fill="none"/>`
      );
    case 2:
      return [stick([20, 15, G], 18), stick([20, 41, G], 18)].join('');
    case 3:
      return [stick([20, 15, G], 18), stick([12, 41, G], 18), stick([28, 41, G], 18)].join('');
    case 4:
      return [stick([12, 15, G], 18), stick([28, 15, G], 18), stick([12, 41, G], 18), stick([28, 41, G], 18)].join('');
    case 5:
      return [
        stick([10, 14, G], 16),
        stick([30, 14, G], 16),
        stick([20, 28, R], 16),
        stick([10, 42, G], 16),
        stick([30, 42, G], 16),
      ].join('');
    case 6:
      return [15, 41].flatMap((y) => [9, 20, 31].map((x) => stick([x, y, G], 18))).join('');
    case 7:
      return [stick([20, 9, R], 13), ...[28, 46].flatMap((y) => [9, 20, 31].map((x) => stick([x, y, G], 14)))].join('');
    case 8:
      return [15, 41].flatMap((y) => [7, 15.5, 24.5, 33].map((x) => stick([x, y, G], 18))).join('');
    default:
      return [10, 28, 46]
        .flatMap((y) => [9, 20, 31].map((x) => stick([x, y, x === 20 ? R : G], 14)))
        .join('');
  }
}

function text(content: string, x: number, y: number, size: number, color: string): string {
  return `<text x="${x}" y="${y}" font-size="${size}" font-family="${FONT}" font-weight="700" fill="${color}" text-anchor="middle" dominant-baseline="central">${content}</text>`;
}

function manFace(n: number, red: boolean): string {
  return text(NUM_CN[n - 1], 20, 17, 19, red ? RED : INK) + text('萬', 20, 40, 21, RED);
}

function honorFace(k: Kind): string {
  if (k === 31) {
    return `<rect x="8" y="10" width="24" height="36" rx="2" fill="none" stroke="${BLUE}" stroke-width="2.4"/><rect x="11.5" y="13.5" width="17" height="29" rx="1" fill="none" stroke="${BLUE}" stroke-width="0.8"/>`;
  }
  const color = k === 32 ? GREEN : k === 33 ? RED : INK;
  return text(HONOR_CN[k - 27], 20, 29, 28, color);
}

export function faceSvg(k: Kind, red: boolean): string {
  let body: string;
  if (k >= 27) body = honorFace(k);
  else if (suitOf(k) === 0) body = manFace(numOf(k), red);
  else if (suitOf(k) === 1) body = pinFace(numOf(k), red);
  else body = souFace(numOf(k), red);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FACE_W} ${FACE_H}" width="100%" height="100%">${body}</svg>`;
}

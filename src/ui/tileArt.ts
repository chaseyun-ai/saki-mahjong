import { Kind, numOf, suitOf } from '../engine/tiles';
import { GLYPHS } from './glyphs';

// 牌面图案：万子和字牌用楷书字形，筒子画花饼，索子画竹节，一索是孔雀。
// 输出完整的 SVG，2D 牌桌直接嵌入，3D 牌桌画成贴图。
// 字形是预先转好的轮廓，不依赖玩家电脑上装了什么字体。

export const FACE_W = 40;
export const FACE_H = 56;

const INK = '#1d1f33';
const RED = '#c4212c';
const RED_DARK = '#7d1119';
const GREEN = '#17734a';
const GREEN_DARK = '#0b4429';
const BLUE = '#1c4c8f';
const BLUE_DARK = '#0f2c57';

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_CN = ['東', '南', '西', '北', '', '發', '中'];

// 把一个字形缩放到指定高度，中心放在 (cx, cy)
export function glyph(ch: string, cx: number, cy: number, h: number, color: string, maxW = 34): string {
  const g = GLYPHS[ch];
  const [x1, y1, x2, y2] = g.box;
  const s = Math.min(h / (y2 - y1), maxW / (x2 - x1));
  const tx = cx - ((x1 + x2) / 2) * s;
  const ty = cy - ((y1 + y2) / 2) * s;
  // 描一圈同色细边，让笔画更饱满
  return `<path transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})" d="${g.d}" fill="${color}" stroke="${color}" stroke-width="${(0.9 / s).toFixed(2)}" stroke-linejoin="round"/>`;
}

// ---------- 筒子 ----------

type Pin = [number, number, string];

const PIN_DARK: Record<string, string> = { [BLUE]: BLUE_DARK, [GREEN]: GREEN_DARK, [RED]: RED_DARK };

// 一枚饼：外圈、白环上一圈花瓣、内圈、花心
function pin([x, y, c]: Pin, r: number): string {
  const dark = PIN_DARK[c] ?? c;
  let s =
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${dark}" stroke-width="${r * 0.08}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.8}" fill="#fbf8ef"/>`;
  const n = r > 7 ? 12 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s += `<circle cx="${(x + Math.cos(a) * r * 0.62).toFixed(2)}" cy="${(y + Math.sin(a) * r * 0.62).toFixed(2)}" r="${(r * 0.13).toFixed(2)}" fill="${c}"/>`;
  }
  s +=
    `<circle cx="${x}" cy="${y}" r="${r * 0.4}" fill="${c}"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.22}" fill="#fbf8ef"/>` +
    `<circle cx="${x}" cy="${y}" r="${r * 0.1}" fill="${dark}"/>`;
  return s;
}

// 一筒：大花饼，绿外圈、红花瓣、蓝花心
function onePin(red: boolean): string {
  const x = 20;
  const y = 28;
  const outer = red ? RED : GREEN;
  let s =
    `<circle cx="${x}" cy="${y}" r="16.5" fill="${outer}"/>` +
    `<circle cx="${x}" cy="${y}" r="15" fill="#fbf8ef"/>`;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    s += `<ellipse cx="${(x + Math.cos(a) * 12.2).toFixed(2)}" cy="${(y + Math.sin(a) * 12.2).toFixed(2)}" rx="2.5" ry="1.5" transform="rotate(${((a * 180) / Math.PI).toFixed(1)} ${(x + Math.cos(a) * 12.2).toFixed(2)} ${(y + Math.sin(a) * 12.2).toFixed(2)})" fill="${outer}"/>`;
  }
  s +=
    `<circle cx="${x}" cy="${y}" r="9.6" fill="${RED}"/>` +
    `<circle cx="${x}" cy="${y}" r="9.6" fill="none" stroke="${RED_DARK}" stroke-width="0.7"/>` +
    `<circle cx="${x}" cy="${y}" r="7.4" fill="#fbf8ef"/>`;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    s += `<circle cx="${(x + Math.cos(a) * 5.2).toFixed(2)}" cy="${(y + Math.sin(a) * 5.2).toFixed(2)}" r="1.25" fill="${red ? RED : BLUE}"/>`;
  }
  s +=
    `<circle cx="${x}" cy="${y}" r="3.2" fill="${red ? RED : BLUE}"/>` +
    `<circle cx="${x}" cy="${y}" r="1.4" fill="#fbf8ef"/>`;
  return s;
}

function pinFace(n: number, red: boolean): string {
  const B = red ? RED : BLUE;
  const G = red ? RED : GREEN;
  const R = RED;
  const pins = (list: Pin[], r: number) => list.map((p) => pin(p, r)).join('');
  switch (n) {
    case 1:
      return onePin(red);
    case 2:
      return pins([[20, 15.5, G], [20, 40.5, B]], 10);
    case 3:
      return pins([[9.5, 10.5, B], [20, 28, R], [30.5, 45.5, G]], 8);
    case 4:
      return pins([[11, 15, B], [29, 15, G], [11, 41, G], [29, 41, B]], 8.6);
    case 5:
      return pins([[10.5, 11.5, B], [29.5, 11.5, G], [20, 28, R], [10.5, 44.5, G], [29.5, 44.5, B]], 7.6);
    case 6:
      return pins([[11, 10, G], [29, 10, G], [11, 29, R], [29, 29, R], [11, 46, R], [29, 46, R]], 7.4);
    case 7:
      return pins(
        [[8.5, 7.5, G], [20, 12.5, G], [31.5, 17.5, G], [11, 33, R], [29, 33, R], [11, 47.5, R], [29, 47.5, R]],
        6.1,
      );
    case 8:
      return pins([7.5, 20.5, 33.5, 46.5].flatMap((y) => [[11, y, B], [29, y, B]] as Pin[]), 6.3);
    default:
      return pins(
        [
          [11, B],
          [28, R],
          [45, G],
        ].flatMap(([y, c]) => [8, 20, 32].map((x) => [x, y, c] as Pin)),
        5.7,
      );
  }
}

// ---------- 索子 ----------

const STICK_DARK: Record<string, string> = { [GREEN]: GREEN_DARK, [RED]: RED_DARK, [BLUE]: BLUE_DARK };

// 一根竹子：两节，中间和两头有竹节
function stick(x: number, y: number, h: number, c: string, w = 6.2): string {
  const dark = STICK_DARK[c] ?? c;
  const top = y - h / 2;
  const seg = (y0: number, y1: number) => {
    const pinch = w * 0.12;
    return `<path d="M${x - w / 2} ${y0} Q${x - w / 2 + pinch} ${(y0 + y1) / 2} ${x - w / 2} ${y1} L${x + w / 2} ${y1} Q${x + w / 2 - pinch} ${(y0 + y1) / 2} ${x + w / 2} ${y0} Z" fill="${c}" stroke="${dark}" stroke-width="0.5"/>`;
  };
  const node = (yy: number) =>
    `<rect x="${x - w / 2 - 0.5}" y="${yy - 0.8}" width="${w + 1}" height="1.6" rx="0.8" fill="${dark}"/>`;
  return (
    seg(top + 0.8, y) +
    seg(y, top + h - 0.8) +
    `<rect x="${x - w * 0.22}" y="${top + 1.8}" width="${w * 0.16}" height="${h / 2 - 2.8}" rx="0.4" fill="#fff" opacity="0.4"/>` +
    `<rect x="${x - w * 0.22}" y="${y + 1}" width="${w * 0.16}" height="${h / 2 - 2.8}" rx="0.4" fill="#fff" opacity="0.4"/>` +
    node(top + 0.8) +
    node(y) +
    node(top + h - 0.8)
  );
}

// 一索：孔雀
function bird(red: boolean): string {
  const body = red ? RED : GREEN;
  const dark = red ? RED_DARK : GREEN_DARK;
  const feathers = [-38, -22, -6, 10]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const fx = 15 + Math.sin(a) * 15;
      const fy = 34 + Math.cos(a) * 15;
      return (
        `<path d="M15 34 Q${(15 + fx) / 2 - 2} ${(34 + fy) / 2} ${fx.toFixed(1)} ${fy.toFixed(1)}" stroke="${dark}" stroke-width="1" fill="none"/>` +
        `<ellipse cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" rx="2.8" ry="3.6" fill="${BLUE}" transform="rotate(${-deg} ${fx.toFixed(1)} ${fy.toFixed(1)})"/>` +
        `<circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="1.5" fill="${RED}"/>`
      );
    })
    .join('');
  return (
    feathers +
    // 身体
    `<path d="M14 36 Q12 22 21 17 Q30 14 31 23 Q31 33 22 38 Q17 40 14 36 Z" fill="${body}" stroke="${dark}" stroke-width="0.7"/>` +
    // 翅膀
    `<path d="M17 31 Q19 22 27 22 Q24 28 25 33 Q21 35 17 31 Z" fill="${dark}"/>` +
    `<path d="M19 30 Q21 25 25 24.5" stroke="#fff" stroke-width="0.6" fill="none" opacity="0.6"/>` +
    // 头、冠、喙、眼
    `<circle cx="28.5" cy="11" r="4.4" fill="${body}" stroke="${dark}" stroke-width="0.7"/>` +
    `<path d="M26 18 Q27 14 27.5 14.5 L30 14.5 Q29.5 17 28 20 Z" fill="${body}"/>` +
    `<path d="M27 6.8 L26 3 M28.6 6.6 L29 2.6 M30.2 7 L32 3.4" stroke="${dark}" stroke-width="0.8"/>` +
    `<circle cx="26" cy="3" r="0.9" fill="${RED}"/><circle cx="29" cy="2.6" r="0.9" fill="${RED}"/><circle cx="32" cy="3.4" r="0.9" fill="${RED}"/>` +
    `<path d="M32.6 10.2 L37 11.6 L32.6 12.8 Z" fill="${RED}"/>` +
    `<circle cx="29.6" cy="10.2" r="1.3" fill="#fbf8ef"/><circle cx="29.9" cy="10.2" r="0.7" fill="${INK}"/>` +
    // 脚
    `<path d="M21 38 L20 46 M20 46 L17.5 47.5 M20 46 L22 48 M25 36.5 L26 45 M26 45 L23.8 46.8 M26 45 L28.4 46.6" stroke="${RED}" stroke-width="1.1" stroke-linecap="round" fill="none"/>`
  );
}

function souFace(n: number, red: boolean): string {
  const G = red ? RED : GREEN;
  const R = RED;
  const B = red ? RED : BLUE;
  switch (n) {
    case 1:
      return bird(red);
    case 2:
      return stick(20, 15, 21, G) + stick(20, 41, 21, B);
    case 3:
      return stick(20, 15, 21, G) + stick(12.5, 41, 21, B) + stick(27.5, 41, 21, B);
    case 4:
      return stick(12, 15, 21, G) + stick(28, 15, 21, B) + stick(12, 41, 21, B) + stick(28, 41, 21, G);
    case 5:
      return (
        stick(9.5, 14, 18, G) +
        stick(30.5, 14, 18, B) +
        stick(20, 28, 18, R) +
        stick(9.5, 42, 18, B) +
        stick(30.5, 42, 18, G)
      );
    case 6:
      return [15, 41].map((y, i) => [9, 20, 31].map((x) => stick(x, y, 21, i ? B : G)).join('')).join('');
    case 7:
      return stick(20, 9.5, 14, R) + [28, 45.5].map((y, i) => [9, 20, 31].map((x) => stick(x, y, 15, i ? B : G)).join('')).join('');
    case 8: {
      // 八索：上下两组摆成 M 和 W
      const tilt = (x: number, y: number, deg: number, c: string) =>
        `<g transform="rotate(${deg} ${x} ${y})">${stick(x, y, 20, c, 5.4)}</g>`;
      return (
        tilt(6.5, 15, 0, G) +
        tilt(15, 15, 24, G) +
        tilt(25, 15, -24, G) +
        tilt(33.5, 15, 0, G) +
        tilt(6.5, 41, 0, B) +
        tilt(15, 41, -24, B) +
        tilt(25, 41, 24, B) +
        tilt(33.5, 41, 0, B)
      );
    }
    default:
      return [10, 28, 46].map((y) => [9, 20, 31].map((x) => stick(x, y, 15, x === 20 ? R : y === 28 ? B : G)).join('')).join('');
  }
}

// ---------- 万子、字牌 ----------

function manFace(n: number, red: boolean): string {
  return glyph(NUM_CN[n - 1], 20, n === 1 ? 14 : 14.5, n === 1 ? 4.5 : 17, red ? RED : INK, 30) + glyph('萬', 20, 38.5, 25, RED, 33);
}

function honorFace(k: Kind): string {
  if (k === 31) {
    // 白：蓝色双线框
    return (
      `<rect x="6.5" y="8" width="27" height="40" rx="2.5" fill="none" stroke="${BLUE}" stroke-width="2.6"/>` +
      `<rect x="10.5" y="12" width="19" height="32" rx="1" fill="none" stroke="${BLUE}" stroke-width="0.9"/>`
    );
  }
  const color = k === 32 ? GREEN : k === 33 ? RED : INK;
  return glyph(HONOR_CN[k - 27], 20, 28, 34, color, 34);
}

export function faceSvg(k: Kind, red: boolean): string {
  let body: string;
  if (k >= 27) body = honorFace(k);
  else if (suitOf(k) === 0) body = manFace(numOf(k), red);
  else if (suitOf(k) === 1) body = pinFace(numOf(k), red);
  else body = souFace(numOf(k), red);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FACE_W} ${FACE_H}" width="100%" height="100%">${body}</svg>`;
}

// 发紫光的字（薄墨初美鸣出来的东、北）：只有字，紫色，背景透明。3D 牌桌把它叠在牌面上、再糊开一层当光晕
export function glowGlyph(k: Kind, color = '#b267ff'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FACE_W} ${FACE_H}" width="100%" height="100%">${glyph(HONOR_CN[k - 27], 20, 28, 34, color, 34)}</svg>`;
}

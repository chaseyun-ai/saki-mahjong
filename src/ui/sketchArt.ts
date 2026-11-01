import { Rng } from '../engine/rng';
import { Kind, numOf, suitOf } from '../engine/tiles';
import { FACE_H, FACE_W, glyph } from './tileArt';

// 爱丽丝的手绘板：一套手绘风格的牌面。底子是白板（淡淡的铅笔双线框），上面用马克笔画：
// 线条都有一点抖、起笔收笔多出一截，整张再过一遍“手抖”滤镜。每种牌的抖法固定（按牌种取随机数），
// 同一种牌每次画出来一样。2D 牌桌直接嵌入，3D 牌桌画进另一张贴图（faces.ts 的 FaceAtlas）

const INK = '#2b2b33';
const RED = '#d8463c';
const GREEN = '#2f9a5e';
const BLUE = '#2f6fcc';
const PENCIL = '#9fb3cc';

const f = (n: number) => n.toFixed(2);

// 一笔抖动的线：从 (x1,y1) 到 (x2,y2)，中间轻轻弯一下，两头各多出一点
function line(rng: Rng, x1: number, y1: number, x2: number, y2: number, color: string, w: number, extra = ''): string {
  const j = () => (rng.next() - 0.5) * 0.9;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const over = 0.06 + rng.next() * 0.06;
  const sx = x1 - dx * over * rng.next();
  const sy = y1 - dy * over * rng.next();
  const ex = x2 + dx * over * rng.next();
  const ey = y2 + dy * over * rng.next();
  const mx = (sx + ex) / 2 - dy * 0.05 * (rng.next() - 0.5) * 2 + j();
  const my = (sy + ey) / 2 + dx * 0.05 * (rng.next() - 0.5) * 2 + j();
  return `<path d="M${f(sx + j())} ${f(sy + j())} Q${f(mx)} ${f(my)} ${f(ex + j())} ${f(ey + j())}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"${extra}/>`;
}

// 一个手画的圈：半径时大时小，画过头一点再收笔
function circle(rng: Rng, cx: number, cy: number, r: number, color: string, w: number, fill = 'none'): string {
  const start = rng.next() * Math.PI * 2;
  const sweep = Math.PI * 2 * (1.06 + rng.next() * 0.08);
  const n = 14;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const a = start + (sweep * i) / n;
    const rr = r * (0.93 + rng.next() * 0.12);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    d += i === 0 ? `M${f(x)} ${f(y)}` : ` L${f(x)} ${f(y)}`;
  }
  const body = fill !== 'none' ? `<circle cx="${f(cx + (rng.next() - 0.5))}" cy="${f(cy + (rng.next() - 0.5))}" r="${f(r * 0.86)}" fill="${fill}" opacity="0.35"/>` : '';
  return `${body}<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// 一个手画的方框（白板的框）
function box(rng: Rng, x: number, y: number, w: number, h: number, color: string, sw: number, extra = ''): string {
  return [line(rng, x, y, x + w, y, color, sw, extra), line(rng, x + w, y, x + w, y + h, color, sw, extra), line(rng, x + w, y + h, x, y + h, color, sw, extra), line(rng, x, y + h, x, y, color, sw, extra)].join('');
}

// ---------- 筒子 ----------

const PIN_SPOTS: Record<number, [number, number, string][]> = {
  2: [[20, 16, GREEN], [20, 40, BLUE]],
  3: [[10, 11, BLUE], [20, 28, RED], [30, 45, GREEN]],
  4: [[11, 15, BLUE], [29, 15, GREEN], [11, 41, GREEN], [29, 41, BLUE]],
  5: [[10.5, 11.5, BLUE], [29.5, 11.5, GREEN], [20, 28, RED], [10.5, 44.5, GREEN], [29.5, 44.5, BLUE]],
  6: [[11, 10, GREEN], [29, 10, GREEN], [11, 29, RED], [29, 29, RED], [11, 46, RED], [29, 46, RED]],
  7: [[8.5, 8, GREEN], [20, 13, GREEN], [31.5, 18, GREEN], [11, 33, RED], [29, 33, RED], [11, 47.5, RED], [29, 47.5, RED]],
  8: [7.5, 20.5, 33.5, 46.5].flatMap((y) => [[11, y, BLUE], [29, y, BLUE]] as [number, number, string][]),
  9: [[11, BLUE], [28, RED], [45, GREEN]].flatMap(([y, c]) => [8, 20, 32].map((x) => [x, y as number, c as string] as [number, number, string])),
};
const PIN_R: Record<number, number> = { 2: 9.5, 3: 7.5, 4: 8, 5: 7, 6: 6.8, 7: 5.8, 8: 5.9, 9: 5.3 };

function pinFace(rng: Rng, n: number, red: boolean): string {
  if (n === 1) {
    // 一筒：两圈加一朵小花
    const c = red ? RED : GREEN;
    let s = circle(rng, 20, 28, 15, c, 1.8) + circle(rng, 20, 28, 9, red ? RED : RED, 1.5, red ? RED : RED) + circle(rng, 20, 28, 3.2, red ? RED : BLUE, 1.4, red ? RED : BLUE);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      s += line(rng, 20 + Math.cos(a) * 10.8, 28 + Math.sin(a) * 10.8, 20 + Math.cos(a) * 13.2, 28 + Math.sin(a) * 13.2, c, 1.2);
    }
    return s;
  }
  const r = PIN_R[n];
  return PIN_SPOTS[n].map(([x, y, c]) => circle(rng, x, y, r, red ? RED : c, 1.5, red ? RED : c) + circle(rng, x, y, r * 0.3, red ? RED : c, 1.1)).join('');
}

// ---------- 索子 ----------

function stick(rng: Rng, x: number, y: number, h: number, c: string): string {
  const top = y - h / 2;
  const bot = y + h / 2;
  // 竹子：一根粗马克笔竖线，外面再描一道细边，中间、两头三个竹节
  return (
    line(rng, x, top + 0.6, x, bot - 0.6, c, 3.4, ' opacity="0.35"') +
    line(rng, x - 1.5, top + 0.8, x - 1.3, bot - 0.8, c, 0.9) +
    line(rng, x + 1.5, top + 0.8, x + 1.3, bot - 0.8, c, 0.9) +
    [top + 1, y, bot - 1].map((yy) => line(rng, x - 2.4, yy, x + 2.4, yy, c, 1.1)).join('')
  );
}

function bird(rng: Rng, red: boolean): string {
  const c = red ? RED : GREEN;
  // 一索：涂鸦小鸟（圆脑袋、胖身子、三根尾羽、小脚）
  return (
    circle(rng, 27, 13, 5, c, 1.5) +
    `<circle cx="28.4" cy="12.2" r="1" fill="${INK}"/>` +
    line(rng, 31.5, 12.5, 36, 14, RED, 1.4) +
    `<path d="M23 17 Q12 20 13 32 Q15 40 24 38 Q31 35 30 24" stroke="${c}" stroke-width="1.6" fill="${c}" fill-opacity="0.18" stroke-linecap="round"/>` +
    line(rng, 14, 32, 5, 42, BLUE, 1.3) +
    line(rng, 15, 34, 8, 47, BLUE, 1.3) +
    line(rng, 17, 36, 13, 50, BLUE, 1.3) +
    line(rng, 22, 38, 21, 46, RED, 1.2) +
    line(rng, 26, 37, 27, 45, RED, 1.2)
  );
}

function souFace(rng: Rng, n: number, red: boolean): string {
  const G = red ? RED : GREEN;
  const B = red ? RED : BLUE;
  const R = RED;
  switch (n) {
    case 1:
      return bird(rng, red);
    case 2:
      return stick(rng, 20, 15, 21, G) + stick(rng, 20, 41, 21, B);
    case 3:
      return stick(rng, 20, 15, 21, G) + stick(rng, 12.5, 41, 21, B) + stick(rng, 27.5, 41, 21, B);
    case 4:
      return stick(rng, 12, 15, 21, G) + stick(rng, 28, 15, 21, B) + stick(rng, 12, 41, 21, B) + stick(rng, 28, 41, 21, G);
    case 5:
      return stick(rng, 9.5, 14, 18, G) + stick(rng, 30.5, 14, 18, B) + stick(rng, 20, 28, 18, R) + stick(rng, 9.5, 42, 18, B) + stick(rng, 30.5, 42, 18, G);
    case 6:
      return [15, 41].map((y, i) => [9, 20, 31].map((x) => stick(rng, x, y, 21, i ? B : G)).join('')).join('');
    case 7:
      return stick(rng, 20, 9.5, 14, R) + [28, 45.5].map((y, i) => [9, 20, 31].map((x) => stick(rng, x, y, 15, i ? B : G)).join('')).join('');
    case 8: {
      const tilt = (x: number, y: number, deg: number, c: string) => `<g transform="rotate(${deg} ${x} ${y})">${stick(rng, x, y, 20, c)}</g>`;
      return tilt(6.5, 15, 0, G) + tilt(15, 15, 24, G) + tilt(25, 15, -24, G) + tilt(33.5, 15, 0, G) + tilt(6.5, 41, 0, B) + tilt(15, 41, -24, B) + tilt(25, 41, 24, B) + tilt(33.5, 41, 0, B);
    }
    default:
      return [10, 28, 46].map((y) => [9, 20, 31].map((x) => stick(rng, x, y, 15, x === 20 ? R : y === 28 ? B : G)).join('')).join('');
  }
}

// ---------- 万子、字牌 ----------

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_CN = ['東', '南', '西', '北', '', '發', '中'];

// 马克笔写的字：先错开一点涂一层浅的（像笔水洇开），再写实的
function marker(ch: string, cx: number, cy: number, h: number, color: string, maxW: number): string {
  return `<g opacity="0.3" transform="translate(0.9 0.7)">${glyph(ch, cx, cy, h, color, maxW)}</g>${glyph(ch, cx, cy, h, color, maxW)}`;
}

function manFace(n: number, red: boolean): string {
  return marker(NUM_CN[n - 1], 20, n === 1 ? 14 : 14.5, n === 1 ? 4.5 : 17, red ? RED : INK, 30) + marker('萬', 20, 38.5, 25, RED, 33);
}

function honorFace(rng: Rng, k: Kind): string {
  if (k === 31) return box(rng, 7, 8.5, 26, 39, BLUE, 2.2) + box(rng, 11, 12.5, 18, 31, BLUE, 0.9);
  const color = k === 32 ? GREEN : k === 33 ? RED : INK;
  return marker(HONOR_CN[k - 27], 20, 28, 34, color, 34);
}

export function sketchFaceSvg(k: Kind, red: boolean): string {
  const rng = new Rng(1000 + k * 7 + (red ? 3 : 0));
  // 底子是白板：铅笔描的淡淡双线框
  const base = k === 31 ? '' : box(rng, 3.5, 4.5, 33, 47, PENCIL, 0.7, ' opacity="0.55"') + box(rng, 6, 7, 28, 42, PENCIL, 0.45, ' opacity="0.4"');
  let body: string;
  if (k >= 27) body = honorFace(rng, k);
  else if (suitOf(k) === 0) body = manFace(numOf(k), red);
  else if (suitOf(k) === 1) body = pinFace(rng, numOf(k), red);
  else body = souFace(rng, numOf(k), red);
  const id = `sk${k}${red ? 'r' : ''}`;
  // 手抖：轻轻扭一下所有线条
  const filter = `<filter id="${id}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="${k + 1}"/><feDisplacementMap in="SourceGraphic" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FACE_W} ${FACE_H}" width="100%" height="100%"><defs>${filter}</defs><g filter="url(#${id})">${base}${body}</g></svg>`;
}

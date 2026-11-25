import { type Col, type Painter, clamp, hex, mix, rgb, rng } from './core';
import { drawText } from './text';

// 像素皮肤（或者像素牌桌）上的立直、吃碰、杠、和牌、技能：画在一层低分辨率的像素画布上（layer.ts），方块世界那种画法——
// 粒子都是一个个实心的小方块（左上亮一格、右下暗一格，像一粒小方块），受重力往下掉，快没了的时候缩小一圈再消失，不半透明、不发光；
// 大字是像素字，实色，往右下错一格是一层深色的影子（不描边）。
// 粒子都是开头一下子算好初速度，之后每一帧按时间直接算位置（和帧率无关），随机数有种子，同一个特效每次放出来一样。
// 按时间解析地算粒子、帧按最近邻放大的做法参考 pixelfx（github.com/patch-gg/pixelfx，MIT），代码是照这个游戏重写的

export type PixelFxKind = 'riichi' | 'call' | 'kan' | 'win' | 'ability';

export interface FxSpec {
  kind: PixelFxKind;
  // 大字（立直、碰、杠、荣和……；技能是技能名）
  word: string;
  // 角色色
  color: string;
  // 在帧上的哪里放（这家座位那边），帧的大小
  x: number;
  y: number;
  w: number;
  h: number;
  seed?: number;
}

export interface PixelFx {
  dur: number;
  draw(p: Painter, t: number): void;
}

const WHITE = rgb(255, 255, 255);
const BLACK = rgb(0, 0, 0);
const GOLD = hex('#ffd83d');
const SMOKE = [hex('#f2f2f2'), hex('#c9c9c9'), hex('#9a9a9a')];
const STICK_RED = hex('#d23c30');

const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const between = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const dark = (c: Col, k = 0.35) => mix(c, BLACK, k);
const light = (c: Col, k = 0.35) => mix(c, WHITE, k);

// 一粒小方块：s 格见方，左上一行一列亮一级，右下一行一列暗一级（s 是 1 就是一格实色）
function cube(p: Painter, x: number, y: number, s: number, c: Col): void {
  const X = Math.round(x - s / 2);
  const Y = Math.round(y - s / 2);
  if (s <= 1) {
    p.rect(X, Y, 1, 1, c);
    return;
  }
  p.rect(X, Y, s, s, c);
  p.rect(X, Y, s - 1, 1, light(c));
  p.rect(X, Y + 1, 1, s - 2, light(c));
  p.rect(X + s - 1, Y, 1, s, dark(c));
  p.rect(X, Y + s - 1, s, 1, dark(c));
}

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  delay: number;
  c: Col;
}

// 一把碎块：从 (x, y) 往四面飞（up 是往上多给多少速度），颜色从 cols 里挑
function bits(rnd: () => number, n: number, x: number, y: number, speed: number, up: number, cols: Col[], size: [number, number] = [2, 3], delay = 0): Bit[] {
  return Array.from({ length: n }, () => {
    const a = rnd() * Math.PI * 2;
    const v = speed * (0.3 + rnd() * 0.7);
    return {
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v * 0.7 - up * (0.5 + rnd() * 0.5),
      size: size[0] + Math.floor(rnd() * (size[1] - size[0] + 1)),
      life: 0.5 + rnd() * 0.5,
      delay: delay + rnd() * 0.05,
      c: cols[Math.floor(rnd() * cols.length)],
    };
  });
}

// 碎块：按时间算位置，受重力 g；最后三成的时间缩小一圈，再缩一圈，然后没了
function drawBits(p: Painter, list: Bit[], t: number, g = 260): void {
  for (const b of list) {
    const u = t - b.delay;
    if (u < 0 || u > b.life) continue;
    const k = u / b.life;
    const s = k < 0.7 ? b.size : Math.max(1, b.size - Math.ceil((k - 0.7) / 0.15));
    cube(p, b.x + b.vx * u, b.y + b.vy * u + (g * u * u) / 2, s, b.c);
  }
}

// 一团烟：几粒灰白的方块慢慢往上冒、先变大再变小
function puffs(rnd: () => number, n: number, x: number, y: number, spread: number, delay = 0): Bit[] {
  return Array.from({ length: n }, () => ({
    x: x + (rnd() - 0.5) * spread,
    y: y + (rnd() - 0.5) * 6,
    vx: (rnd() - 0.5) * 14,
    vy: -10 - rnd() * 16,
    size: 3 + Math.floor(rnd() * 2),
    life: 0.6 + rnd() * 0.5,
    delay: delay + rnd() * 0.12,
    c: SMOKE[Math.floor(rnd() * SMOKE.length)],
  }));
}

function drawPuffs(p: Painter, list: Bit[], t: number): void {
  for (const b of list) {
    const u = t - b.delay;
    if (u < 0 || u > b.life) continue;
    const k = u / b.life;
    const s = Math.max(1, Math.round(b.size * (k < 0.3 ? 0.6 + k * 1.3 : 1 - (k - 0.3) * 1.1)));
    const c = k < 0.5 ? b.c : SMOKE[Math.min(SMOKE.length - 1, SMOKE.indexOf(b.c) + 1)];
    cube(p, b.x + b.vx * u, b.y + b.vy * u, s, c);
  }
}

// 大字：实色像素字，往右下一格是深色影子。出场时先大一号，一下落回原来大小；最后一小段一闪一闪地收掉
function title(p: Painter, word: string, x: number, y: number, t: number, dur: number, k: number, fill: Col): void {
  if (t < 0 || t > dur) return;
  if (t > dur - 0.2 && Math.floor((t - dur) * 14) % 2 === 0) return;
  const kk = t < 0.07 ? k + 1 : k;
  drawText(p, word, x, y, { k: kk, fill: [fill], shadow: dark(fill, 0.72) });
}

// ---------- 立直：一根千点棒从天上掉下来，砸起一把碎块和一团烟 ----------

function riichi(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 7);
  const c = hex(s.color);
  const hit = 0.2;
  const debris = bits(rnd, 26, s.x, s.y, 110, 70, [WHITE, WHITE, STICK_RED, light(c, 0.2), c], [2, 3], hit);
  const smoke = puffs(rnd, 10, s.x, s.y, 50, hit);
  const dur = 1.45;
  return {
    dur,
    draw(p, t) {
      // 千点棒：一根白色的长方块（上边亮一格、下边暗一格），中间一颗红点；砸到以后弹一下就不见了
      if (t < hit + 0.3) {
        const fall = ease(between(t, 0, hit));
        const bounce = t > hit ? Math.sin(between(t, hit, hit + 0.2) * Math.PI) * 4 : 0;
        const sy = Math.round(s.y - 80 + 80 * fall - bounce);
        if (!(t > hit + 0.2 && Math.floor(t * 20) % 2)) {
          p.rect(s.x - 22, sy - 3, 44, 6, dark(WHITE, 0.25));
          p.rect(s.x - 22, sy - 3, 44, 4, WHITE);
          p.rect(s.x - 22, sy - 3, 44, 1, light(WHITE));
          p.rect(s.x - 2, sy - 2, 4, 3, STICK_RED);
          p.rect(s.x - 2, sy + 1, 4, 1, dark(STICK_RED));
        }
      }
      if (t >= hit) {
        drawPuffs(p, smoke, t);
        drawBits(p, debris, t);
      }
      title(p, s.word, s.x, s.y - 46, t - 0.1, dur - 0.1, 2, light(c, 0.35));
    },
  };
}

// ---------- 吃、碰：一圈小方块往外蹦，大字先大一号再落回去 ----------

function call(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 11);
  const c = hex(s.color);
  const ring = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.15;
    const v = 70 + rnd() * 30;
    return { x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 30, size: 2 + (i % 2), life: 0.45 + rnd() * 0.2, delay: 0.02, c: i % 3 ? light(c, 0.3) : WHITE };
  });
  const dur = 0.95;
  return {
    dur,
    draw(p, t) {
      drawBits(p, ring, t, 120);
      title(p, s.word, s.x, s.y - 6, t, dur, 2, WHITE);
    },
  };
}

// ---------- 杠：一道方块闪电劈下来，整个画面白一下，落点碎块乱飞 ----------

// 闪电：从天上往下一级级折下来，每一段是一截粗线
function bolt(rnd: () => number, x0: number, y0: number, x1: number, y1: number, segs: number): [number, number][] {
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < segs; i++) {
    const u = i / segs;
    pts.push([Math.round(x0 + (x1 - x0) * u + (rnd() - 0.5) * 22), Math.round(y0 + (y1 - y0) * u)]);
  }
  pts.push([x1, y1]);
  return pts;
}

function kan(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 23);
  const c = hex(s.color);
  const path = bolt(rnd, s.x + (rnd() - 0.5) * 60, -4, s.x, s.y, 8);
  const debris = bits(rnd, 30, s.x, s.y, 130, 80, [WHITE, light(c, 0.3), c, hex('#8a8a8a')], [2, 3], 0.1);
  const smoke = puffs(rnd, 12, s.x, s.y, 60, 0.12);
  const dur = 1.3;
  const pop = call({ ...s, seed: (s.seed ?? 23) + 1 });
  return {
    dur,
    draw(p, t) {
      // 画面白一下（光那层整片加亮，闪两下）
      if (t < 0.22) {
        const k = (Math.floor(t * 18) % 2 ? 0.15 : 0.4) * (1 - t / 0.22);
        for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) p.add(x, y, WHITE, k);
      }
      // 闪电：白芯、浅蓝边，一亮一暗地闪三下
      if (t < 0.36 && Math.floor(t * 22) % 3 !== 2) {
        const edge = hex('#a9d8ff');
        for (let i = 0; i < path.length - 1; i++) {
          const [x0, y0] = path[i];
          const [x1, y1] = path[i + 1];
          for (const d of [-2, 2]) p.line(x0 + d, y0, x1 + d, y1, edge);
          for (const d of [-1, 0, 1]) p.line(x0 + d, y0, x1 + d, y1, WHITE);
        }
      }
      drawPuffs(p, smoke, t);
      drawBits(p, debris, t);
      if (t > 0.1) pop.draw(p, Math.min(pop.dur, t - 0.1));
    },
  };
}

// ---------- 和牌：几发烟花往上冲、炸开一团方块火星（闪着往下落），金色的大字 ----------

function win(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 31);
  const c = hex(s.color);
  const cx = s.w / 2;
  const cy = s.h * 0.42;
  const pals = [
    [light(c, 0.4), c, WHITE],
    [GOLD, hex('#ff9f1c'), WHITE],
    [hex('#7be3ff'), hex('#3fa9f5'), WHITE],
    [hex('#ff7ac6'), light(c, 0.2), WHITE],
  ];
  const shots = Array.from({ length: 7 }, (_, i) => {
    const x = Math.round(s.w * (0.1 + rnd() * 0.8));
    const y = Math.round(s.h * (0.1 + rnd() * 0.32));
    const pal = pals[i % pals.length];
    // 炸开的火星：一圈往外，速度差不多（是一个球，不是一把乱撒）
    const n = 36;
    const sparks: Bit[] = Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.2;
      const v = 60 + rnd() * 18;
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, size: 2, life: 0.9 + rnd() * 0.5, delay: 0, c: pal[k % pal.length] };
    });
    return { at: 0.15 + i * 0.26 + rnd() * 0.08, x, y, sparks, smoke: [] as Bit[] };
  });
  for (const f of shots) f.smoke = Array.from({ length: 6 }, (_, k) => ({ x: f.x, y: s.h - 4 - k * ((s.h - f.y) / 6), vx: 0, vy: -6, size: 2, life: 0.5, delay: -0.3 + k * 0.05, c: SMOKE[1] }));
  const dur = 2.6;
  return {
    dur,
    draw(p, t) {
      for (const f of shots) {
        const u = t - f.at;
        if (u < -0.3 || u > 1.6) continue;
        if (u < 0) {
          // 往上冲：一粒亮方块，身后一串灰烟
          const k = 1 + u / 0.3;
          const y = s.h + (f.y - s.h) * k;
          for (const sm of f.smoke) if (sm.y > y) cube(p, sm.x, sm.y, 1, SMOKE[2]);
          cube(p, f.x, y, 2, WHITE);
          continue;
        }
        // 炸开：火星往外飞、慢慢往下落，最后一段一闪一闪
        for (const b of f.sparks) {
          if (u > b.life) continue;
          const k = u / b.life;
          const drag = 1 - Math.exp(-u * 3);
          const x = b.x + (b.vx / 3) * drag;
          const y = b.y + (b.vy / 3) * drag + 14 * u * u;
          if (k > 0.6 && Math.floor(u * 16 + b.vx) % 2) continue;
          cube(p, x, y, k > 0.8 ? 1 : b.size, b.c);
        }
      }
      title(p, s.word, cx, cy, t - 0.1, dur - 0.1, 3, GOLD);
    },
  };
}

// ---------- 技能：这家脚下一圈方块转起来，一粒粒方块往上飘，头顶一块深色牌子写技能名 ----------

function ability(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 41);
  const c = hex(s.color);
  const motes = Array.from({ length: 26 }, () => ({ x: (rnd() - 0.5) * 70, at: rnd() * 1.1, sp: 26 + rnd() * 30, ph: rnd() * Math.PI * 2, size: 2 + Math.floor(rnd() * 2), c: rnd() < 0.3 ? WHITE : light(c, 0.2 + rnd() * 0.3) }));
  const dur = 1.9;
  return {
    dur,
    draw(p, t) {
      const open = ease(between(t, 0, 0.3)) * (1 - between(t, dur - 0.35, dur));
      // 脚下一圈：16 粒方块排成一个压扁的圈，转着；隔一粒亮一粒
      const R = 40 * open;
      if (R > 3) {
        for (let i = 0; i < 16; i++) {
          const a = t * 1.4 + (i / 16) * Math.PI * 2;
          cube(p, s.x + Math.cos(a) * R, s.y + Math.sin(a) * R * 0.42, 3, i % 2 ? c : light(c, 0.45));
        }
      }
      // 方块往上飘，左右晃，快到顶时缩小
      for (const m of motes) {
        const u = t - m.at;
        if (u < 0 || u > 0.9) continue;
        const k = u / 0.9;
        cube(p, s.x + m.x * open + Math.sin(u * 6 + m.ph) * 3, s.y - u * m.sp, k > 0.7 ? 1 : m.size, m.c);
      }
      // 技能名的牌子：深色底、上边一道角色色，白字带影子
      if (t > 0.15 && t < dur - 0.1) {
        const blink = t > dur - 0.35 && Math.floor(t * 16) % 2 === 0;
        if (!blink) {
          const yTop = s.y - 60;
          const size = drawSize(s.word, 1);
          const bw = size.w + 10;
          const bh = size.h + 8;
          const bx = Math.round(s.x - bw / 2);
          const by = Math.round(yTop - bh / 2);
          p.rect(bx, by, bw, bh, hex('#16161a'));
          p.rect(bx, by, bw, 1, c);
          p.rect(bx, by + bh, bw, 1, dark(c, 0.6));
          drawText(p, s.word, s.x, yTop + 1, { k: 1, fill: [WHITE], shadow: hex('#3f3f3f') });
        }
      }
    },
  };
}

// 字画出来多大（只量不画）
function drawSize(word: string, k: number): { w: number; h: number } {
  const probe = { rect() {}, dot() {} } as unknown as Painter;
  return drawText(probe, word, 0, 0, { k, fill: [WHITE] });
}

export function makePixelFx(s: FxSpec): PixelFx {
  if (s.kind === 'riichi') return riichi(s);
  if (s.kind === 'kan') return kan(s);
  if (s.kind === 'win') return win(s);
  if (s.kind === 'ability') return ability(s);
  return call(s);
}

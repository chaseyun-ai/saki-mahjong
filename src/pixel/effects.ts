import { type Col, type Painter, at, clamp, hex, mix, rampOf, rgb, rng } from './core';
import { drawText } from './text';

// 像素皮肤（或者像素牌桌）上的立直、吃碰、杠、和牌、技能：画在一层低分辨率的像素画布上（layer.ts），
// 粒子都是开头一下子算好初速度，之后每一帧按时间直接算位置（和帧率无关）；淡出用抖动打散，不是半透明。
// 颜色用这家角色色现做的色阶（暗处偏冷、亮处偏暖到白），和像素画的色阶一样一格格挑。
// 做法参考 pixelfx（github.com/patch-gg/pixelfx，MIT）的冲击波、火花、光柱、烟花，代码是照这个游戏重写的

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

const WHITE = rgb(255, 252, 240);
const INK = hex('#1d1632');
const GOLD = ['#fff6c8', '#ffe27a', '#f4c13d', '#e0902a', '#b4581e'].map(hex);

const ease = (t: number) => 1 - Math.pow(1 - clamp(t), 3);
const between = (t: number, a: number, b: number) => clamp((t - a) / (b - a));

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  delay: number;
  c: number;
}

// 一把火花：从 (x, y) 往四面（spread 是往上偏多少）飞，受重力
function sparks(rnd: () => number, n: number, x: number, y: number, speed: number, up: number, delay = 0): Spark[] {
  return Array.from({ length: n }, () => {
    const a = rnd() * Math.PI * 2;
    const v = speed * (0.35 + rnd() * 0.65);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up * (0.5 + rnd() * 0.5), life: 0.45 + rnd() * 0.5, delay: delay + rnd() * 0.06, c: rnd() };
  });
}

function drawSparks(p: Painter, list: Spark[], t: number, ramp: Col[], g = 140, trail = true): void {
  for (const s of list) {
    const u = t - s.delay;
    if (u < 0 || u > s.life) continue;
    const k = u / s.life;
    const x = s.x + s.vx * u;
    const y = s.y + s.vy * u + (g * u * u) / 2;
    const c = at(ramp, 1 - k * 0.8 - s.c * 0.15);
    p.dot(x, y, c, 1 - k * k);
    if (trail) {
      // 拖一格尾巴（往回半步），亮一点的光
      p.dot(x - s.vx * 0.016, y - (s.vy + g * u) * 0.016, at(ramp, 0.5 - k * 0.4), (1 - k) * 0.7);
      p.light(x, y, ramp[ramp.length - 2], 0.5 * (1 - k));
    }
  }
}

// 大字出场：从小一号弹到正常，最后一下闪两下消失。center 是字的中心
function bigWord(p: Painter, word: string, x: number, y: number, t: number, dur: number, k: number, fill: Col[], edge = INK): void {
  if (t < 0.04 || t > dur) return;
  const pop = t < 0.12 ? k + 1 : k;
  // 最后 0.24 秒：一格格闪着收掉
  if (t > dur - 0.24 && Math.floor((t - dur) * 16) % 2 === 0) return;
  const slide = Math.round((1 - ease(between(t, 0.04, 0.2))) * 12);
  drawText(p, word, x - slide, y, { k: pop, fill, edge, shadow: mix(edge, rgb(0, 0, 0), 0.4) });
}

// ---------- 立直：一根千点棒从天上砸下来，砸出一圈冲击波、一把火花，一道光柱 ----------

function riichi(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 7);
  const ramp = rampOf(s.color, 7);
  const hit = 0.22;
  const spk = sparks(rnd, 34, s.x, s.y, 120, 40, hit);
  const dur = 1.45;
  return {
    dur,
    draw(p, t) {
      // 千点棒：白色长条，中间一颗红点，下落时拖几格残影
      const fall = ease(between(t, 0, hit));
      const sy = s.y - 90 + 90 * fall;
      if (t < hit + 0.5) {
        const a = t < hit ? 1 : 1 - between(t, hit + 0.25, hit + 0.5);
        for (let g = 2; g >= 0; g--) {
          if (t >= hit && g) continue;
          const yy = sy - g * 7;
          p.rect(s.x - 22, yy - 2, 44, 5, g ? at(ramp, 0.6) : INK, a * (g ? 0.4 : 1));
          if (!g) {
            p.rect(s.x - 21, yy - 1, 42, 3, WHITE, a);
            p.rect(s.x - 2, yy - 1, 4, 3, hex('#d9573b'), a);
          }
        }
      }
      if (t >= hit) {
        const u = t - hit;
        // 冲击波：压扁的一圈（桌面上），外沿亮、里沿暗，越往外越淡
        const r = 6 + 150 * ease(u / 0.7);
        const fade = 1 - between(u, 0.2, 0.75);
        p.ring(s.x, s.y, r, 3, (v) => at(ramp, 0.5 + v * 0.5), fade, 0.42);
        p.glowRing(s.x, s.y, r, 6, ramp[5], 0.45 * fade, 0.42);
        // 第二圈，慢一点
        const r2 = 4 + 90 * ease(between(u, 0.08, 0.9));
        p.ring(s.x, s.y, r2, 2, WHITE, fade * 0.8, 0.42);
        // 光柱：从砸下去的地方往上，先粗后细
        const pk = 1 - between(u, 0, 0.9);
        p.glowLine(s.x, s.y, s.x, s.y - 120, 10 * pk + 2, ramp[5], 0.55 * pk);
        p.rect(s.x - 1, s.y - 110 * pk, 2, 110 * pk, WHITE, pk);
        // 砸下去那一下整块亮一闪
        if (u < 0.08) p.glow(s.x, s.y, 60, WHITE, 0.6 * (1 - u / 0.08), 0.5);
        drawSparks(p, spk, t, ramp);
      }
      bigWord(p, s.word, s.x, s.y - 52, t - 0.12, dur - 0.12, 3, [WHITE, ...ramp.slice(3).reverse()]);
    },
  };
}

// ---------- 吃、碰：漫画里那种锯齿爆炸框“啪”地弹出来，四周一圈速度线 ----------

function call(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 11);
  const ramp = rampOf(s.color, 7);
  const lines = Array.from({ length: 14 }, (_, i) => ({ a: (i / 14) * Math.PI * 2 + rnd() * 0.2, len: 14 + rnd() * 16, sp: 140 + rnd() * 80 }));
  const dur = 0.95;
  const n = 12;
  const jag = Array.from({ length: n * 2 }, (_, i) => (i % 2 ? 0.62 : 1) * (0.9 + rnd() * 0.2));
  return {
    dur,
    draw(p, t) {
      // 框：0.1 秒弹出（先大一点再回来），最后 0.2 秒缩掉
      const grow = t < 0.1 ? (t / 0.1) * 1.18 : t < 0.18 ? 1.18 - ((t - 0.1) / 0.08) * 0.18 : 1;
      const shrink = 1 - between(t, dur - 0.2, dur);
      const R = 34 * grow * shrink;
      if (R > 1) {
        const pts = (r: number): [number, number][] => jag.map((j, i) => [s.x + Math.cos((i / (n * 2)) * Math.PI * 2 - 0.2) * r * j * 1.25, s.y + Math.sin((i / (n * 2)) * Math.PI * 2 - 0.2) * r * j]);
        p.poly(pts(R + 3), INK);
        p.poly(pts(R), ramp[4]);
        p.poly(pts(R * 0.72), ramp[5]);
      }
      // 速度线：从框边往外跑
      for (const l of lines) {
        const u = t * l.sp;
        const r0 = 30 + u;
        const a = 1 - between(t, 0.25, 0.7);
        if (a <= 0) continue;
        p.line(s.x + Math.cos(l.a) * r0 * 1.25, s.y + Math.sin(l.a) * r0, s.x + Math.cos(l.a) * (r0 + l.len) * 1.25, s.y + Math.sin(l.a) * (r0 + l.len), WHITE, a);
      }
      if (shrink > 0.3) drawText(p, s.word, s.x, s.y, { k: s.word.length > 1 ? 2 : 3, fill: [WHITE, WHITE, hex('#fff1c4')], edge: INK, a: 1 });
    },
  };
}

// ---------- 杠：天上劈下来几道像素闪电，落点一圈冲击波，整个画面闪一下 ----------

function bolt(rnd: () => number, x0: number, y0: number, x1: number, y1: number, segs: number): [number, number][] {
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 1; i < segs; i++) {
    const u = i / segs;
    pts.push([x0 + (x1 - x0) * u + (rnd() - 0.5) * 26, y0 + (y1 - y0) * u + (rnd() - 0.5) * 6]);
  }
  pts.push([x1, y1]);
  return pts;
}

function kan(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 23);
  const ramp = rampOf(s.color, 7);
  const bolts = [0, 1, 2].map((i) => ({ at: 0.05 + i * 0.09, pts: bolt(rnd, s.x + (rnd() - 0.5) * 120, -4, s.x + (rnd() - 0.5) * 16, s.y, 9) }));
  const spk = sparks(rnd, 40, s.x, s.y, 140, 30, 0.12);
  const dur = 1.25;
  const base = call({ ...s, seed: (s.seed ?? 23) + 1 });
  return {
    dur,
    draw(p, t) {
      // 画面闪一下（光那层整片加亮）
      if (t < 0.18) {
        const k = (1 - t / 0.18) * 0.35;
        for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 1) p.add(x, y, WHITE, k);
      }
      for (const b of bolts) {
        const u = t - b.at;
        if (u < 0 || u > 0.32) continue;
        // 一闪一闪：亮、暗、亮
        const on = Math.floor(u * 30) % 3 !== 1;
        const a = 1 - u / 0.32;
        for (let i = 0; i < b.pts.length - 1; i++) {
          const [x0, y0] = b.pts[i];
          const [x1, y1] = b.pts[i + 1];
          p.line(x0 + 1, y0, x1 + 1, y1, ramp[3], a);
          if (on) p.line(x0, y0, x1, y1, WHITE, a);
          p.glowLine(x0, y0, x1, y1, 6, ramp[5], 0.35 * a);
        }
      }
      const u = t - 0.12;
      if (u > 0) {
        const r = 8 + 170 * ease(u / 0.8);
        const fade = 1 - between(u, 0.25, 0.85);
        p.ring(s.x, s.y, r, 4, (v) => at(ramp, 0.4 + v * 0.6), fade, 0.42);
        p.glowRing(s.x, s.y, r, 8, ramp[5], 0.5 * fade, 0.42);
      }
      drawSparks(p, spk, t, ramp, 160);
      if (t > 0.1) base.draw(p, Math.min(base.dur, t - 0.1));
    },
  };
}

// ---------- 和牌：一道白光，身后一圈转着的光芒，几簇像素烟花、一阵彩纸，金色的大字 ----------

function win(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 31);
  const ramp = rampOf(s.color, 7);
  const cx = s.w / 2;
  const cy = s.h * 0.42;
  const fireworks = Array.from({ length: 6 }, (_, i) => {
    const x = s.w * (0.12 + rnd() * 0.76);
    const y = s.h * (0.12 + rnd() * 0.36);
    const pal = i % 2 ? ramp : GOLD.slice().reverse();
    return { at: 0.25 + i * 0.28 + rnd() * 0.1, x, y, pal, list: sparks(rnd, 46, x, y, 95, 0, 0) };
  });
  const paper = Array.from({ length: 70 }, () => ({ x: rnd() * s.w, y: -10 - rnd() * s.h * 0.6, vy: 30 + rnd() * 40, sway: rnd() * Math.PI * 2, c: rnd() < 0.5 ? ramp[4] : GOLD[1 + Math.floor(rnd() * 3)] }));
  const dur = 2.4;
  return {
    dur,
    draw(p, t) {
      // 白光：一开始整个画面亮一下
      if (t < 0.25) {
        const k = (1 - t / 0.25) * 0.55;
        for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) p.add(x, y, WHITE, k);
      }
      // 光芒：一圈楔形，慢慢转，隔一条亮一条
      const rays = 16;
      const rot = t * 0.6;
      const show = between(t, 0.05, 0.3) * (1 - between(t, dur - 0.45, dur));
      if (show > 0) {
        // 光芒画在光那层：隔一条亮一条的楔形，离中心越远越淡（加在底下的牌桌上是一层透亮的光，不是一片网点）
        const R = Math.max(s.w, s.h) * 0.75;
        const warm = ramp[5];
        for (let y = 0; y < s.h; y++)
          for (let x = 0; x < s.w; x++) {
            const dx = x + 0.5 - cx;
            const dy = (y + 0.5 - cy) * 1.4;
            const d = Math.sqrt(dx * dx + dy * dy) / R;
            if (d >= 1) continue;
            const a = Math.atan2(dy, dx) - rot;
            const band = Math.floor(((a / (Math.PI * 2)) * rays + rays * 8) % rays);
            if (band % 2) continue;
            p.add(x, y, warm, 0.32 * show * (1 - d));
          }
        p.glow(cx, cy, 90, GOLD[1], 0.55 * show, 0.7);
      }
      // 烟花：先一颗往上冲的亮点，到了炸开
      for (const f of fireworks) {
        const u = t - f.at;
        if (u < -0.22 || u > 1.1) continue;
        if (u < 0) {
          const k = 1 + u / 0.22;
          const y = s.h + (f.y - s.h) * k;
          p.dot(f.x, y, WHITE);
          p.dot(f.x, y + 1, f.pal[3], 0.6);
          p.light(f.x, y, f.pal[4], 0.6);
          continue;
        }
        if (u < 0.1) p.glow(f.x, f.y, 26, f.pal[5], 0.7 * (1 - u / 0.1));
        drawSparks(p, f.list, u, f.pal, 50);
      }
      // 彩纸：一片片往下飘，左右晃，翻面时变窄
      if (t > 0.35) {
        const u = t - 0.35;
        for (const q of paper) {
          const y = q.y + q.vy * u * 1.6;
          if (y < -2 || y > s.h) continue;
          const x = q.x + Math.sin(u * 3 + q.sway) * 6;
          const flip = Math.abs(Math.sin(u * 7 + q.sway)) > 0.5;
          p.rect(x, y, flip ? 2 : 1, 2, q.c, 1 - between(t, dur - 0.35, dur));
        }
      }
      bigWord(p, s.word, cx, cy, t - 0.1, dur - 0.1, 4, GOLD, INK);
    },
  };
}

// ---------- 技能：这家脚下一圈魔法阵（两圈刻度、一个六芒星，反着转），一缕缕光点往上飘，头顶一块像素牌子写技能名 ----------

function ability(s: FxSpec): PixelFx {
  const rnd = rng(s.seed ?? 41);
  const ramp = rampOf(s.color, 7);
  const motes = Array.from({ length: 30 }, () => ({ x: (rnd() - 0.5) * 70, at: rnd() * 1.1, sp: 30 + rnd() * 40, ph: rnd() * Math.PI * 2 }));
  const dur = 1.9;
  return {
    dur,
    draw(p, t) {
      const open = ease(between(t, 0, 0.3)) * (1 - between(t, dur - 0.35, dur));
      const R = 40 * open;
      const sq = 0.42;
      if (R > 2) {
        p.glow(s.x, s.y, R * 1.4, ramp[5], 0.35 * open, sq);
        p.ring(s.x, s.y, R, 2, ramp[5], 1, sq);
        p.ring(s.x, s.y, R - 6, 1, ramp[4], 1, sq);
        // 外圈一圈刻度点，转着
        for (let i = 0; i < 24; i++) {
          const a = t * 1.2 + (i / 24) * Math.PI * 2;
          p.dot(s.x + Math.cos(a) * (R - 3), s.y + Math.sin(a) * (R - 3) * sq, i % 3 ? ramp[4] : WHITE);
        }
        // 六芒星：两个三角，反着转
        for (const [dir, c] of [[1, ramp[5]], [-1, ramp[4]]] as const) {
          const pts: [number, number][] = [0, 1, 2].map((k) => {
            const a = dir * t * 0.8 + (k / 3) * Math.PI * 2 + (dir < 0 ? Math.PI : 0);
            return [s.x + Math.cos(a) * (R - 8), s.y + Math.sin(a) * (R - 8) * sq];
          });
          for (let k = 0; k < 3; k++) p.line(pts[k][0], pts[k][1], pts[(k + 1) % 3][0], pts[(k + 1) % 3][1], c);
        }
      }
      // 光点：从阵里往上飘，左右晃，越高越淡
      for (const m of motes) {
        const u = t - m.at;
        if (u < 0 || u > 0.9) continue;
        const y = s.y - u * m.sp;
        const x = s.x + m.x * open + Math.sin(u * 6 + m.ph) * 3;
        const k = u / 0.9;
        p.dot(x, y, at(ramp, 1 - k * 0.6), 1 - k);
        p.light(x, y, ramp[5], 0.4 * (1 - k));
      }
      // 技能名的牌子：深色底、角色色的边，四角缺一格
      if (t > 0.15 && t < dur - 0.1) {
        const k = 1;
        const blink = t > dur - 0.35 && Math.floor(t * 16) % 2 === 0;
        if (!blink) {
          const yTop = s.y - 64;
          const size = drawSize(s.word, k);
          const bw = size.w + 12;
          const bh = size.h + 8;
          const bx = Math.round(s.x - bw / 2);
          const by = Math.round(yTop - bh / 2);
          p.rect(bx + 1, by, bw - 2, bh, ramp[4]);
          p.rect(bx, by + 1, bw, bh - 2, ramp[4]);
          p.rect(bx + 1, by + 1, bw - 2, bh - 2, INK);
          p.rect(bx + 2, by + 2, bw - 4, 1, ramp[2]);
          drawText(p, s.word, s.x, yTop, { k, fill: [WHITE], edge: INK });
        }
      }
    },
  };
}

// 字画出来多大（只量不画）
function drawSize(word: string, k: number): { w: number; h: number } {
  const probe = { rect() {}, dot() {} } as unknown as Painter;
  return drawText(probe, word, 0, 0, { k, fill: [WHITE], edge: INK });
}

export function makePixelFx(s: FxSpec): PixelFx {
  if (s.kind === 'riichi') return riichi(s);
  if (s.kind === 'kan') return kan(s);
  if (s.kind === 'win') return win(s);
  if (s.kind === 'ability') return ability(s);
  return call(s);
}

// 鹤田姬子拿到钥匙那一局的配牌节奏（3D、2.5D、2D 共用）。
// 别人照常发牌；她的牌不跟着发，等别人发完，再一张一张裹着火从正上方的天上竖着砸进她手里。
// 不是从左到右挨个落，而是东一张西一张错落着落（比如第 4 张、第 11 张、第 2 张……）：前后两张在手里隔得开，
// 间隔有长有短；最后一张砸下来最重，砸之前稍微停一下，整个画面一震。
// 顺序和间隔由种子定（beatSeed：每一局不一样，3D 和 2D 算出来一样）。时间都是秒，从她这一段开始算。

// 她这一整段（节奏、每张砸下来、理完牌烧过去的火，3D 的 himekoFx.ts、2D 的 himeko2d.ts 都照这个）放快多少倍
export const HIMEKO_SPEED = 1.1;
const fast = (sec: number) => sec / HIMEKO_SPEED;

export const HIMEKO_BEAT = {
  lead: fast(0.3), // 开始以后多久砸下第一张
  step: fast(0.16), // 平均每张隔多久
  jitter: 0.55, // 每个间隔在 step × (1 ± jitter) 之间
  apart: 3, // 前后两张在手里最好隔几张（实在排不开时至少隔 2 张）
  pause: fast(0.14), // 最后一张（重拍）之前多停多久
  settle: fast(0.55), // 最后一张砸下来以后停多久再理牌
};

export interface BeatHit {
  at: number; // 第几秒砸下来
  accent: 0 | 2; // 0 普通，2 最后一张（重拍）
}

function rng(seed: number): () => number {
  let r = seed >>> 0 || 1;
  return () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

// 这一局的种子：牌局的种子 + 第几局
export const beatSeed = (gameSeed: number, round: number): number => (gameSeed ^ Math.imul(round + 1, 0x9e3779b1)) >>> 0;

// 落下的先后：前后两张尽量隔 apart 张以上，排到最后没得挑时放宽；隔不到 2 张就换一种排法重来
function order(n: number, rnd: () => number): number[] {
  let best: number[] = [];
  let bestGap = -1;
  for (let attempt = 0; attempt < 40; attempt++) {
    const left = Array.from({ length: n }, (_, i) => i);
    const out: number[] = [];
    let gap = Infinity;
    while (left.length) {
      const prev = out[out.length - 1];
      let pool = left;
      for (let need = HIMEKO_BEAT.apart; prev !== undefined && need > 0; need--) {
        const ok = left.filter((i) => Math.abs(i - prev) >= need);
        if (ok.length) {
          pool = ok;
          break;
        }
      }
      const pick = pool[Math.floor(rnd() * pool.length)];
      if (prev !== undefined) gap = Math.min(gap, Math.abs(pick - prev));
      out.push(pick);
      left.splice(left.indexOf(pick), 1);
    }
    if (gap > bestGap) [best, bestGap] = [out, gap];
    if (gap >= 2) break;
  }
  return best;
}

interface Plan {
  at: number[]; // 手里从左到右第 i 张什么时候砸下来
  last: number; // 最后砸下来的是第几张
}

const plans = new Map<string, Plan>();

function plan(n: number, seed: number): Plan {
  const key = `${n}-${seed}`;
  const hit = plans.get(key);
  if (hit) return hit;
  const b = HIMEKO_BEAT;
  const rnd = rng(seed * 2654435761 + n);
  const seq = order(n, rnd);
  // 间隔有长有短，但加起来和匀速时一样长（配牌那一段总长不变）
  const gaps = Array.from({ length: Math.max(0, n - 2) }, () => 1 + b.jitter * (rnd() * 2 - 1));
  const sum = gaps.reduce((a, x) => a + x, 0) || 1;
  const at = new Array<number>(n).fill(b.lead);
  let t = b.lead;
  seq.forEach((i, k) => {
    if (k > 0) t += k === n - 1 ? b.step + b.pause : (gaps[k - 1] * b.step * gaps.length) / sum;
    at[i] = t;
  });
  const p = { at, last: seq[n - 1] ?? 0 };
  plans.set(key, p);
  return p;
}

// 一共 n 张（闲家 13，庄家 14）里第 i 张（按她手里从左到右）什么时候砸下来
export function beatHit(i: number, n: number, seed = 0): BeatHit {
  const p = plan(n, seed);
  return { at: p.at[i], accent: i === p.last ? 2 : 0 };
}

// 重拍（最后一张）的时刻
export const beatFinal = (n: number, seed = 0) => Math.max(...plan(n, seed).at);
// 整段配牌（不算火）多长：最后一张之后再停一下
export const beatLength = (n: number, seed = 0) => beatFinal(n, seed) + HIMEKO_BEAT.settle;

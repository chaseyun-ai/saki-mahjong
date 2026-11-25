import { describe, expect, it } from "vitest";
import {
  DENOMS,
  natural,
  pay,
  reconcile,
  settle,
  total,
  transfers,
  type Sticks,
} from "../src/ui/tenbou";
import { stickTimeline } from "../src/ui/resultFlow";

// 小的随机数（固定种子，每次一样）
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe("开局发的点棒", () => {
  it("25000 / 50000 / 100000 照真实配法，五种都有", () => {
    expect(natural(25000)).toEqual([1, 2, 4, 1, 5]);
    expect(natural(50000)).toEqual([2, 4, 9, 1, 5]);
    expect(natural(100000)).toEqual([7, 4, 9, 1, 5]);
  });

  it("什么点数都正好凑得上，没有负的", () => {
    for (let s = 100; s <= 150000; s += 100) {
      const h = natural(s);
      expect(total(h)).toBe(s);
      expect(h.every((n) => n >= 0 && Number.isInteger(n))).toBe(true);
    }
    expect(natural(0)).toEqual([0, 0, 0, 0, 0]);
    expect(natural(-3000)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("付钱找零", () => {
  const full = natural(25000);

  it("放铳 3900：递一根 5000，对方找回 1000 和 100", () => {
    expect(pay(full, full, 3900)).toEqual({
      give: [0, 1, 0, 0, 0],
      back: [0, 0, 1, 0, 1],
      short: 0,
    });
  });

  it("正好有零的就直接付，不找零", () => {
    expect(pay(full, full, 2000)).toEqual({
      give: [0, 0, 2, 0, 0],
      back: [0, 0, 0, 0, 0],
      short: 0,
    });
    expect(pay(full, full, 1500)).toEqual({
      give: [0, 0, 1, 1, 0],
      back: [0, 0, 0, 0, 0],
      short: 0,
    });
  });

  it("满贯 8000：递 10000，找回两根 1000", () => {
    expect(pay(full, full, 8000)).toEqual({
      give: [1, 0, 0, 0, 0],
      back: [0, 0, 2, 0, 0],
      short: 0,
    });
  });

  it("手里没零的、对方也找得开：递大的找零", () => {
    const p = pay([1, 0, 0, 0, 0], full, 2600);
    expect(p.give).toEqual([1, 0, 0, 0, 0]);
    expect(total(p.back)).toBe(7400);
  });

  it("手里的棒不够：全给出去，欠着的记下来", () => {
    expect(pay([0, 0, 1, 1, 0], full, 3900)).toEqual({
      give: [0, 0, 1, 1, 0],
      back: [0, 0, 0, 0, 0],
      short: 2400,
    });
  });

  it("随便什么手、什么点数：付出去减找回来正好是要付的，不会拿出手里没有的棒", () => {
    const r = rng(7);
    for (let i = 0; i < 400; i++) {
      const a = natural(Math.round(r() * 600) * 100 + 1000);
      const b = natural(Math.round(r() * 600) * 100 + 1000);
      const pts = Math.round(r() * 180) * 100 + 100;
      const p = pay(a, b, pts);
      p.give.forEach((n, k) => expect(n).toBeLessThanOrEqual(a[k]));
      if (p.short) continue;
      expect(total(p.give) - total(p.back)).toBe(pts);
      p.back.forEach((n, k) => expect(n).toBeLessThanOrEqual(b[k]));
    }
  });
});

describe("谁付给谁", () => {
  it("自摸：三家各付，桌上的立直棒单独一笔归和牌的人", () => {
    expect(transfers([-2100, -4100, 9300, -2100], 2)).toEqual([
      { from: -1, to: 2, pts: 1000 },
      { from: 0, to: 2, pts: 2100 },
      { from: 1, to: 2, pts: 4100 },
      { from: 3, to: 2, pts: 2100 },
    ]);
  });

  it("一炮双响：放铳的人分别付给两家，供托归头跳", () => {
    expect(transfers([-15900, 4900, 0, 12000], 1)).toEqual([
      { from: -1, to: 1, pts: 1000 },
      { from: 0, to: 1, pts: 3900 },
      { from: 0, to: 3, pts: 12000 },
    ]);
  });

  it("荒牌流局两家听两家没听：各付给自己下家那边最近的听牌家 1500", () => {
    expect(transfers([1500, -1500, 1500, -1500], null)).toEqual([
      { from: 1, to: 2, pts: 1500 },
      { from: 3, to: 0, pts: 1500 },
    ]);
    expect(transfers([-1500, -1500, 1500, 1500], null)).toEqual([
      { from: 0, to: 2, pts: 1500 },
      { from: 1, to: 3, pts: 1500 },
    ]);
  });
});

describe("一局的点棒账", () => {
  it("走完以后每家手里的棒正好是结算后的点数", () => {
    const cases: [number[], number[], number | null][] = [
      [[25000, 25000, 25000, 25000], [-2100, -4100, 9300, -2100], 2],
      [[24000, 30000, 27000, 17000], [0, -7700, 0, 9700], 3],
      [[33000, 21000, 26000, 20000], [-15900, 4900, 0, 12000], 1],
      [[25000, 25000, 25000, 25000], [1500, -1500, 1500, -1500], null],
      [[26000, 24000, 28000, 22000], [1000, 1000, -3000, 1000], null],
    ];
    for (const [before, deltas, pot] of cases) {
      const start = before.map(natural);
      const { moves, after } = settle(start, deltas, pot);
      after.forEach((h, s) => expect(total(h)).toBe(before[s] + deltas[s]));
      expect(moves.length).toBeGreaterThan(0);
    }
  });

  it("立直扣的 1000：从手里正好拿掉一根 1000 点棒", () => {
    expect(reconcile([1, 2, 4, 1, 5], 24000)).toEqual([1, 2, 3, 1, 5]);
    // 手里没有 1000 了：拿一根 5000 去换零
    const h = reconcile([1, 2, 0, 1, 5], 21000);
    expect(total(h)).toBe(21000);
    // 多出来的点照大的补
    expect(reconcile([1, 2, 4, 1, 5], 31000)).toEqual([1, 3, 5, 1, 5]);
    expect(reconcile([1, 2, 4, 1, 5], -800)).toEqual([0, 0, 0, 0, 0]);
  });

  it("一盘打下来棒一直对得上点数", () => {
    const r = rng(11);
    let hold: Sticks[] = [0, 1, 2, 3].map(() => natural(25000));
    let score = [25000, 25000, 25000, 25000];
    for (let round = 0; round < 60; round++) {
      // 随便一家自摸或者荣和
      const w = Math.floor(r() * 4);
      const deltas = [0, 0, 0, 0];
      if (r() < 0.5) {
        const from = (w + 1 + Math.floor(r() * 3)) % 4;
        const pts = [1000, 2000, 3900, 5200, 7700, 8000, 12000][
          Math.floor(r() * 7)
        ];
        deltas[from] -= pts;
        deltas[w] += pts;
      } else
        for (let o = 0; o < 4; o++)
          if (o !== w) {
            deltas[o] -= 1300;
            deltas[w] += 1300;
          }
      const before = score;
      score = score.map((s, i) => s + deltas[i]);
      if (score.some((s) => s < 0)) break;
      const start = hold.map((h, s) => reconcile(h, before[s]));
      const { after } = settle(start, deltas, w);
      after.forEach((h, s) => expect(total(h)).toBe(score[s]));
      hold = after;
    }
  });
});

describe("点棒飞的时间表", () => {
  it("一笔一笔来，找零在这一笔落地以后才飞回去", () => {
    const start = [0, 1, 2, 3].map(() => natural(25000));
    const { moves } = settle(start, [-2100, -4100, 9300, -2100], 2);
    const { beats, end } = stickTimeline(moves);
    for (let i = 1; i < beats.length; i++)
      expect(beats[i].start).toBeGreaterThanOrEqual(beats[i - 1].land - 1);
    expect(end).toBeGreaterThanOrEqual(beats[beats.length - 1].land);
    expect(DENOMS.length).toBe(5);
  });
});

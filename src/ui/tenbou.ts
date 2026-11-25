// 点棒：每家手里有几根 10000 / 5000 / 1000 / 500 / 100，结算时像付钱找零一样递过去、找回来
//
// 只管「棒」，不管点数怎么算：点数还是 Game 算好的 deltas，这里只决定这些点用哪几根棒付、对方找回哪几根。

// 面额从大到小；手里的棒就是五个数（每种几根）
export const DENOMS = [10000, 5000, 1000, 500, 100] as const;
export type Sticks = number[];

const U = [100, 50, 10, 5, 1]; // 按 100 点一份算
const units = (pts: number) => Math.round(pts / 100);

export const none = (): Sticks => [0, 0, 0, 0, 0];
export const total = (h: Sticks): number =>
  h.reduce((a, n, i) => a + n * DENOMS[i], 0);
export const count = (h: Sticks): number => h.reduce((a, n) => a + n, 0);
const add = (a: Sticks, b: Sticks): Sticks => a.map((n, i) => n + b[i]);
const sub = (a: Sticks, b: Sticks): Sticks => a.map((n, i) => n - b[i]);

// 能凑出来就尽量用大的（从桌外换来的、补给的棒）
export function greedy(pts: number): Sticks {
  let u = Math.max(0, units(pts));
  return U.map((v) => {
    const n = Math.floor(u / v);
    u -= n * v;
    return n;
  });
}

// 开局发的棒：照真实配法。25000 点是 1 根 10000、2 根 5000、4 根 1000、1 根 500、5 根 100（Mリーグ 一样），
// 零钱（500、100）固定一千点，1000 点棒每 25000 配 4 根（最多 9 根，留着立直用），5000 每 25000 配 2 根（最多 4 根），
// 剩下的都是 10000。50000 → 2/4/9/1/5，100000 → 7/4/9/1/5。点数不是整千、很少的时候也照这个意思凑。
export function natural(score: number): Sticks {
  let u = units(score);
  if (u <= 0) return none();
  // 百位那几份 + 一千点零钱（够的话）
  let small = u % 10;
  if (u >= small + 10) small += 10;
  const n500 = small >= 10 ? Math.floor((small - 5) / 5) : small >= 5 ? 1 : 0;
  const n100 = small - n500 * 5;
  u -= small;
  const scale = score / 25000;
  let n1000 = Math.min(u / 10, Math.min(9, Math.max(4, Math.round(4 * scale))));
  u -= n1000 * 10;
  let n5000 = Math.min(
    Math.floor(u / 50),
    Math.min(4, Math.max(1, Math.round(2 * scale))),
  );
  u -= n5000 * 50;
  const n10000 = Math.floor(u / 100);
  u -= n10000 * 100;
  if (u >= 50) {
    n5000++;
    u -= 50;
  }
  n1000 += u / 10;
  return [n10000, n5000, n1000, n500, n100];
}

// 最少几根凑出正好 v 份（每种最多 have[i] 根）；凑不出是 null
function exact(have: Sticks, v: number): Sticks | null {
  if (v < 0) return null;
  if (v === 0) return none();
  // best[x]：凑出 x 份最少的那一手（一根根当成单独的东西放进去，从大到小）
  let best: (Sticks | null)[] = Array(v + 1).fill(null);
  best[0] = none();
  for (let i = 0; i < 5; i++)
    for (let k = 0; k < have[i]; k++) {
      let moved = false;
      for (let x = v; x >= U[i]; x--) {
        const from = best[x - U[i]];
        if (!from) continue;
        const cur = best[x];
        if (!cur || count(from) + 1 < count(cur)) {
          const next = from.slice();
          next[i]++;
          best[x] = next;
          moved = true;
        }
      }
      if (!moved) break; // 这种棒再多放一根也没用
    }
  return best[v];
}

export interface Payment {
  give: Sticks; // 付的人递过去的
  back: Sticks; // 收的人找回来的
  short: number; // 付的人手里的棒不够，欠着的点
  loose?: boolean; // 两边手里的棒怎么都找不开（只好跟桌外换）
}

// 付 pts 点：付的人从手里挑几根（够数、而且拿掉最小那根就不够了），收的人从自己手里找零。
// 挑「递过去 + 找回来」根数最少的那种；把自己最后一根 1000 点棒用掉（立直没得用）的算贵一点；
// 一样多就挑递过去根数少的（掏一根大的让对方找，像现实里那样），再一样就挑找零少的。
export function pay(payer: Sticks, recv: Sticks, pts: number): Payment {
  const need = units(pts);
  if (need <= 0) return { give: none(), back: none(), short: 0 };
  const have = units(total(payer));
  if (have <= need)
    return { give: payer.slice(), back: none(), short: (need - have) * 100 };
  // 找零最多不到最小那根，先把收的人 0..99 份怎么找都算好
  const change: (Sticks | null)[] = [];
  const changeOf = (v: number) =>
    change[v] === undefined ? (change[v] = exact(recv, v)) : change[v];
  const lim = U.map((v, i) => Math.min(payer[i], Math.ceil(need / v)));
  let best: {
    give: Sticks;
    back: Sticks;
    cost: number;
    n: number;
    over: number;
  } | null = null;
  let loose: Sticks | null = null; // 找不开时的退路：多付得最少的
  let looseOver = Infinity;
  const g = none();
  const walk = (i: number, sum: number) => {
    if (i === 5) {
      if (sum < need) return;
      const smallest = [4, 3, 2, 1, 0].find((k) => g[k] > 0)!;
      if (sum - U[smallest] >= need) return;
      const over = sum - need;
      if (over < looseOver) {
        looseOver = over;
        loose = g.slice();
      }
      const back = changeOf(over);
      if (!back) return;
      let cost = count(g) + count(back);
      // 用掉最后一根 1000（自己的，或者找零时对方的）
      if (payer[2] > 0 && payer[2] - g[2] === 0) cost += 1.5;
      if (recv[2] > 0 && recv[2] - back[2] + g[2] === 0) cost += 1.5;
      const n = count(g);
      if (
        !best ||
        cost < best.cost ||
        (cost === best.cost &&
          (n < best.n || (n === best.n && over < best.over)))
      )
        best = { give: g.slice(), back, cost, n, over };
      return;
    }
    for (let k = 0; k <= lim[i]; k++) {
      g[i] = k;
      walk(i + 1, sum + k * U[i]);
    }
    g[i] = 0;
  };
  walk(0, 0);
  if (best)
    return {
      give: (best as { give: Sticks }).give,
      back: (best as { back: Sticks }).back,
      short: 0,
    };
  // 对方找不开（手里没零的）：先照最少多付的递过去，找零照大的凑（到时候再跟桌外换）
  return {
    give: loose ?? payer.slice(),
    back: greedy(looseOver === Infinity ? 0 : looseOver * 100),
    short: 0,
    loose: true,
  };
}

// 拿掉 pts 点：先看能不能正好拿出几根（立直扣的 1000），不行就拿一根大的、跟桌外换零回来；加点就照大的补
export function reconcile(h: Sticks, score: number): Sticks {
  const target = units(score);
  if (target <= 0) return none();
  const diff = units(total(h)) - target;
  if (diff === 0) return h.slice();
  if (diff < 0) return add(h, greedy(-diff * 100));
  if (diff <= 2000) {
    const out = exact(h, diff);
    if (out) return sub(h, out);
  }
  const p = pay(h, [99, 99, 99, 99, 99], diff * 100);
  const left = add(sub(h, p.give), p.back);
  return units(total(left)) === target && left.every((n) => n >= 0)
    ? left
    : natural(score);
}

export interface Transfer {
  from: number; // -1 是桌上的立直棒（供托）
  to: number;
  pts: number;
}

// 谁付给谁多少：四家加起来多出来的是桌上的立直棒，归 potSeat（头跳那家）；
// 剩下的付的人按自己下家、对家、上家的顺序付给收的人（荒牌流局两家听两家没听：各付给离自己近的那家 1500）
export function transfers(
  deltas: number[],
  potSeat: number | null,
): Transfer[] {
  const d = deltas.slice();
  const out: Transfer[] = [];
  const pot = d.reduce((a, b) => a + b, 0);
  if (pot > 0 && potSeat !== null) {
    d[potSeat] -= pot;
    out.push({ from: -1, to: potSeat, pts: pot });
  }
  const owe = d.map((x) => Math.max(0, -x));
  const due = d.map((x) => Math.max(0, x));
  for (let p = 0; p < 4; p++)
    for (let k = 1; k < 4 && owe[p] > 0; k++) {
      const t = (p + k) % 4;
      const pts = Math.min(owe[p], due[t]);
      if (pts <= 0) continue;
      out.push({ from: p, to: t, pts });
      owe[p] -= pts;
      due[t] -= pts;
    }
  return out;
}

export interface StickMove extends Transfer, Payment {
  // 这一笔前后两家手里的棒（付的人、收的人；供托那笔付的人是空的）。找不开的时候两家先跟桌外换成好找的配法，
  // pre 就是换完的样子；post 是这一笔走完的样子
  pre: [Sticks, Sticks];
  post: [Sticks, Sticks];
}

// 这一局的点棒一笔笔怎么走：start 是每家这一局结算前手里的棒，返回每一笔和结算后每家手里的棒
export function settle(
  start: Sticks[],
  deltas: number[],
  potSeat: number | null,
): { moves: StickMove[]; after: Sticks[] } {
  const h = start.map((x) => x.slice());
  const moves: StickMove[] = [];
  // 供托一笔先走（从桌子中间来，不用找零），付点的按顺序一笔笔走
  for (const t of transfers(deltas, potSeat)) {
    if (t.from < 0) {
      const give =
        units(t.pts) % 10 === 0
          ? [0, 0, units(t.pts) / 10, 0, 0]
          : greedy(t.pts);
      const pre = h[t.to].slice();
      h[t.to] = add(h[t.to], give);
      moves.push({
        ...t,
        give,
        back: none(),
        short: 0,
        pre: [none(), pre],
        post: [none(), h[t.to].slice()],
      });
      continue;
    }
    const want = [total(h[t.from]) - t.pts, total(h[t.to]) + t.pts];
    let p = pay(h[t.from], h[t.to], t.pts);
    if (p.loose) {
      // 找不开：两家先把手里的棒换成照开局配法的样子（零的多）再付
      h[t.from] = natural(total(h[t.from]));
      h[t.to] = natural(total(h[t.to]));
      p = pay(h[t.from], h[t.to], t.pts);
    }
    const pre: [Sticks, Sticks] = [h[t.from].slice(), h[t.to].slice()];
    h[t.from] = add(sub(h[t.from], p.give), p.back);
    h[t.to] = sub(add(h[t.to], p.give), p.back);
    if (p.loose || h.some((x) => x.some((n) => n < 0))) {
      h[t.from] = reconcile(
        h[t.from].map((n) => Math.max(0, n)),
        want[0],
      );
      h[t.to] = reconcile(
        h[t.to].map((n) => Math.max(0, n)),
        want[1],
      );
    }
    moves.push({ ...t, ...p, pre, post: [h[t.from].slice(), h[t.to].slice()] });
  }
  return { moves, after: h };
}

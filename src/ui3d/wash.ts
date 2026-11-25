// 手搓洗牌（原木）牌是怎么被推着走的：牌摊在中间那块（仪表盘）外面的一圈方形的地方，四家各两只手，
// 一把一把地推：往中间推、往回带、往旁边抹；手边的一片牌跟着手走（离手近的走得远，边上的只蹭一下），
// 推过去的牌再把那边的牌挤开。不是整堆绕着中间转圈。
// 每一把怎么推在洗之前就排好（记在每张牌的 pushes 里），3D 牌桌（shuffle.ts）和 2D 牌桌（app.ts 的 shuffle2d）都照这个演。
// 这里的长度以一张牌的宽度为 1，时间是秒；坐标 x 向右、z 朝自己（屏幕下方），原点在中间那块的中心

// 一只手隔多久推一把；一把推多久（牌被推出去、滑一下停住）；手够得到多远的牌；一把最少、最多推多远
const STROKE_EVERY = 0.28;
const STROKE_TIME = 0.26;
const REACH = 3.1;
const STROKE_MIN = 2.4;
const STROKE_MAX = 4.6;
// 两张牌挨得比这近就互相挤开一点（牌是 1 × 1.36 的，朝哪边的都有）
const GAP = 1.15;

// 被手推的一下：从什么时候起（t）、滑多久（dur），挪多少（dx、dz）、转多少（dyaw，弧度），
// 中途骑到别的牌上再滑下来的（hop，0 到 1，抬多高由演的那边定）
export interface Push {
  t: number;
  dur: number;
  dx: number;
  dz: number;
  dyaw: number;
  hop: number;
}

// 一张被洗的牌：推完现在排到的最后一下以后在哪（ex、ez），离中间那块至少多远（m，每张不一样，
// 免得挤到中间那块边上的排成一条线），被推的每一下（pushes，一下一下加上去）
export interface Washed {
  ex: number;
  ez: number;
  m: number;
  pushes: Push[];
}

// 牌摊的那一圈：中间那块外面（横向离中心至少 inX、或者纵向至少 inZ），到码牌山的那条线里面（横向至多 outX、纵向至多 outZ）
export interface WashArea {
  inX: number;
  inZ: number;
  outX: number;
  outZ: number;
}

const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// 把 (x, y) 收进牌摊的那一圈：压到中间那块上的往外挤（往出去近的那边，再多 m），出圈的拉回来
export function keepIn<T extends { x: number; y: number }>(v: T, a: WashArea, m = 0): T {
  const ix = a.inX + m;
  const iz = a.inZ + m;
  if (Math.abs(v.x) < ix && Math.abs(v.y) < iz) {
    if (ix - Math.abs(v.x) <= iz - Math.abs(v.y)) v.x = (v.x < 0 ? -1 : 1) * ix;
    else v.y = (v.y < 0 ? -1 : 1) * iz;
  }
  v.x = clamp(v.x, -a.outX, a.outX);
  v.y = clamp(v.y, -a.outZ, a.outZ);
  return v;
}

// 牌摊的那一圈里随便一处
export function randomSpot(a: WashArea): { x: number; y: number } {
  for (let tries = 0; tries < 20; tries++) {
    const x = (Math.random() * 2 - 1) * a.outX;
    const y = (Math.random() * 2 - 1) * a.outZ;
    if (Math.abs(x) >= a.inX || Math.abs(y) >= a.inZ) return { x, y };
  }
  return keepIn({ x: 0, y: a.outZ * (Math.random() < 0.5 ? -1 : 1) }, a);
}

// 挤在一起的牌互相让开一点（n 遍），让完都还在牌摊的那一圈里。只挪「排到最后在哪」（ex、ez）
export function spread(ps: Washed[], a: WashArea, n: number): void {
  const v = { x: 0, y: 0 };
  for (let it = 0; it < n; it++) {
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      for (let j = i + 1; j < ps.length; j++) {
        const q = ps[j];
        let dx = q.ex - p.ex;
        let dz = q.ez - p.ez;
        const d2 = dx * dx + dz * dz;
        if (d2 >= GAP * GAP) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-3) {
          const ang = Math.random() * Math.PI * 2;
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1;
        }
        const k = ((GAP - d) * 0.3) / d;
        p.ex -= dx * k;
        p.ez -= dz * k;
        q.ex += dx * k;
        q.ez += dz * k;
      }
    }
    for (const p of ps) {
      v.x = p.ex;
      v.y = p.ez;
      keepIn(v, a, p.m);
      p.ex = v.x;
      p.ez = v.y;
    }
  }
}

// 排一段洗牌（s 到 e）：每只手隔 STROKE_EVERY 推一把，从自己跟前这一侧被推得最少的那张牌下手
// （这样角上、边上的牌也都洗得到），往自己跟前另一处推过去
export function wash(ps: Washed[], a: WashArea, s: number, e: number): void {
  // 先排好哪只手什么时候推（同一家两只手、四家之间错开），再照时间一把一把算
  const turns: { t: number; seat: number; side: number }[] = [];
  for (let seat = 0; seat < 4; seat++) {
    for (const side of [-1, 1]) {
      for (let t = s + Math.random() * 0.1 + (side > 0 ? STROKE_EVERY / 2 : 0); t + STROKE_TIME * 0.6 < e; t += STROKE_EVERY) turns.push({ t, seat, side });
    }
  }
  turns.sort((p, q) => p.t - q.t);
  const bx = new Float32Array(ps.length);
  const bz = new Float32Array(ps.length);
  const hit = new Float32Array(ps.length);
  // 每张牌到现在一共被推了多远
  const moved = new Float32Array(ps.length);
  const mid = { x: 0, y: 0 };
  for (const { t, seat, side } of turns) {
    // 这一家朝外的方向（f）和它右手边（r）；它跟前从中间那块（lo）到码牌山的线（hi），左右最远到 wide
    const fx = seat === 1 ? 1 : seat === 3 ? -1 : 0;
    const fz = seat === 0 ? 1 : seat === 2 ? -1 : 0;
    const [rx, rz] = [-fz, fx];
    const [lo, hi, wide] = fx ? [a.inX, a.outX, a.outZ] : [a.inZ, a.outZ, a.outX];
    const span = hi - lo;
    // 手从哪下去：这一家跟前（前后 v 比左右 |u| 远的那一片）、这只手这一侧，被推得最少的那张牌旁边；那一片没牌就随便一处
    let u0 = side * Math.random() * wide;
    let v0 = lo + span * Math.random();
    let least = Infinity;
    ps.forEach((p, i) => {
      const u = p.ex * rx + p.ez * rz;
      const v = p.ex * fx + p.ez * fz;
      if (v < Math.abs(u) - 1 || u * side < -1.5) return;
      const score = moved[i] + Math.random() * 1.2;
      if (score >= least) return;
      least = score;
      u0 = u + (Math.random() - 0.5) * 0.8;
      v0 = v + (Math.random() - 0.5) * 0.8;
    });
    // 往哪推：这一家跟前随便另一处（往中间推、往回带、往旁边抹都有，洗完牌还是摊得满桌都是，不往一处堆）；太短、太长的重来
    let [u1, v1] = [u0, v0];
    for (let tries = 0; tries < 12; tries++) {
      v1 = lo + span * Math.random();
      u1 = clamp(u0 + (Math.random() - 0.5) * 8, -wide, wide);
      const d = Math.hypot(u1 - u0, v1 - v0);
      if (d >= STROKE_MIN && d <= STROKE_MAX) break;
    }
    const sx = fx * v0 + rx * u0;
    const sz = fz * v0 + rz * u0;
    const dx = fx * v1 + rx * u1 - sx;
    const dz = fz * v1 + rz * u1 - sz;
    const len = Math.hypot(dx, dz) || 1;
    ps.forEach((p, i) => {
      bx[i] = p.ex;
      bz[i] = p.ez;
      hit[i] = 0;
      const d = Math.hypot(p.ex - sx, p.ez - sz);
      if (d >= REACH) return;
      const w = smooth(1 - d / REACH);
      hit[i] = w;
      // 跟着手走多少，再往旁边偏一点
      const carry = w * (0.7 + Math.random() * 0.5);
      const drift = (Math.random() - 0.5) * 1.6 * w;
      p.ex += dx * carry + (-dz / len) * drift;
      p.ez += dz * carry + (dx / len) * drift;
    });
    // 推过去的牌把那边的牌挤开
    spread(ps, a, 3);
    ps.forEach((p, i) => {
      // 斜着穿过中间那块一角的：只走一半
      mid.x = (bx[i] + p.ex) / 2;
      mid.y = (bz[i] + p.ez) / 2;
      if (Math.abs(mid.x) < a.inX - 0.15 && Math.abs(mid.y) < a.inZ - 0.15) {
        keepIn(mid, a, p.m);
        p.ex = mid.x;
        p.ez = mid.y;
      }
      const mx = p.ex - bx[i];
      const mz = p.ez - bz[i];
      const far = Math.hypot(mx, mz);
      // 只蹭了一点点的当没动（放回去）
      if (far < 0.04) {
        p.ex = bx[i];
        p.ez = bz[i];
        return;
      }
      moved[i] += far;
      const w = hit[i];
      p.pushes.push({
        // 边上的牌是被里面的牌挤着走的，晚一点动
        t: t + (1 - w) * 0.07,
        dur: STROKE_TIME * (0.9 + Math.random() * 0.45),
        dx: mx,
        dz: mz,
        dyaw: (Math.random() - 0.5) * (0.5 + 2.1 * w),
        // 推得狠的有时候骑到别的牌上再滑下来
        hop: w > 0.45 && Math.random() < 0.3 ? 0.4 + Math.random() * 0.6 : 0,
      });
    });
  }
}

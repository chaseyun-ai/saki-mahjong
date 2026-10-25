import type { Game } from './game';

// 把牌局复制一份（怜的演算用）：复制品有自己的牌山、手牌、能力状态和随机数，怎么打都碰不到原来的牌局。
// 深拷贝：Map、Set、数组、带类的对象（牌山、随机数）都复制，函数（能力）共用
function cloneDeep<T>(v: T, seen = new Map<unknown, unknown>()): T {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v) as T;
  let out: unknown;
  if (Array.isArray(v)) {
    const a: unknown[] = [];
    seen.set(v, a);
    for (const x of v) a.push(cloneDeep(x, seen));
    out = a;
  } else if (v instanceof Map) {
    const m = new Map();
    seen.set(v, m);
    for (const [k, x] of v) m.set(cloneDeep(k, seen), cloneDeep(x, seen));
    out = m;
  } else if (v instanceof Set) {
    const s = new Set();
    seen.set(v, s);
    for (const x of v) s.add(cloneDeep(x, seen));
    out = s;
  } else {
    const o = Object.create(Object.getPrototypeOf(v)) as Record<string, unknown>;
    seen.set(v, o);
    for (const k of Object.keys(v)) o[k] = cloneDeep((v as Record<string, unknown>)[k], seen);
    out = o;
  }
  return out as T;
}

export function cloneGame(g: Game): Game {
  // 事件记录只会往后加、不会改，复制品拿一份浅拷贝就够了（一整场的记录很长，深拷贝太慢）
  const events = g.events;
  g.events = [];
  let c: Game;
  try {
    c = cloneDeep(g);
  } finally {
    g.events = events;
  }
  c.events = events.slice();
  // 复制品不通知界面
  (c as unknown as { eventListeners: unknown[] }).eventListeners = [];
  return c;
}

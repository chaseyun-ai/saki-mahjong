import type { Character } from '../../src/abilities/characters';
import type { Ability, DrawRule } from '../../src/abilities/types';
import { chooseAction } from '../../src/ai/ai';
import { Game } from '../../src/engine/game';
import { Rng } from '../../src/engine/rng';
import { TILE_COUNT, TileId } from '../../src/engine/tiles';

// 能力大乱斗：从角色池里任选四个坐下，打完整场，每一步都检查：
// - 牌总数还是 136 张，没有重复
// - 被锁住的牌（能力预定的）位置没被换
// - 控场能力定的规矩：只要还有别的牌可换，摸到的牌就不违反（先定的规矩优先）
// - 摸牌的规矩只在摸牌那一刻有效，不会漏到别的时候
// - 不报错，整场能打完，点数守恒

export interface BrawlStats {
  games: number;
  rounds: number;
  draws: number;
  wins: number;
  abilityEvents: Map<string, number>;
  ruleChecks: number;
  problems: string[];
}

function tilesInPlay(g: Game): TileId[] {
  const all = [...g.wall.allTiles()];
  // 加杠等别人抢杠时，那张牌既不在手里也还没进副露
  if (g.kakanInfo) all.push(g.kakanInfo.tile);
  for (const p of g.players) {
    all.push(...p.hand);
    p.melds.forEach((m) => all.push(...m.tiles));
    p.discards.forEach((d) => {
      if (!d.called) all.push(d.tile);
    });
  }
  return all;
}

export function combos<T>(pool: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (pool.length < k) return [];
  const [head, ...rest] = pool;
  return [...combos(rest, k - 1).map((c) => [head, ...c]), ...combos(rest, k)];
}

// 角色多了以后全部组合打不完：挑一部分，保证任意两个人都同桌过，再按顺序补到 limit 个
export function sampleCombos<T>(pool: T[], k: number, limit: number): T[][] {
  const all = combos(pool, k);
  if (all.length <= limit) return all;
  const order = new Rng(20240611).shuffle(all.map((_, i) => i));
  const met = new Set<string>();
  const pairs = (c: T[]) => c.flatMap((a, i) => c.slice(i + 1).map((b) => `${pool.indexOf(a)}-${pool.indexOf(b)}`));
  const picked: number[] = [];
  for (const i of order) {
    if (pairs(all[i]).some((p) => !met.has(p))) {
      picked.push(i);
      pairs(all[i]).forEach((p) => met.add(p));
    }
  }
  for (const i of order) if (picked.length < limit && !picked.includes(i)) picked.push(i);
  return picked.sort((a, b) => a - b).map((i) => all[i]);
}

export function playBrawl(chars: Character[], seed: number, stats: BrawlStats): void {
  // 座位也打乱，结果不能靠谁坐哪
  const seats = new Rng(seed * 7919).shuffle([...chars]);
  // 记下控场能力给这一次摸牌定的规矩，摸牌时对账
  let rules: DrawRule[] = [];
  let lockedBefore: Set<TileId> | null = null;
  // 只记正式牌局的：怜的演算在复制品上也会走一遍摸牌流程
  let real: Game | null = null;
  const wrap = (a: Ability | null): Ability | null => {
    if (!a?.beforeAnyDraw) return a;
    const inner = a.beforeAnyDraw.bind(a);
    return {
      ...a,
      beforeAnyDraw(g, seat, drawer, rinshan) {
        const mine = g === real;
        if (mine && !lockedBefore) lockedBefore = new Set(g.wall.locked);
        const r = inner(g, seat, drawer, rinshan);
        if (r && mine && g.binds(seat, drawer)) rules.push(r);
        return r;
      },
    };
  };
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.name, ability: wrap(c.ability) })) });
  real = g;
  // 第一局庄家的第一张在建牌局时就摸了，那时还没开始对账
  rules = [];
  lockedBefore = null;
  const tag = `[${seats.map((c) => c.id).join(',')} 种子 ${seed}]`;
  const problem = (msg: string) => {
    if (stats.problems.length < 50) stats.problems.push(`${tag} ${g.roundLabel()} ${msg}`);
  };
  const lockPos = new Map<TileId, { pos: number; who: string }>();

  g.onEvent((e) => {
    if (e.type === 'roundStart') lockPos.clear();
    if (e.type === 'ability') stats.abilityEvents.set(e.ability, (stats.abilityEvents.get(e.ability) ?? 0) + 1);
    if (e.type === 'roundEnd') {
      stats.rounds++;
      stats.wins += e.result.wins.length;
    }
    if (e.type !== 'draw') return;
    stats.draws++;
    const got = g.players[e.seat].drawn!;
    const was = lockedBefore;
    const rs = rules;
    rules = [];
    lockedBefore = null;
    // 天使和挡得住一半的规矩（挡掉哪条是随机的），不对账
    if (rs.length === 0 || was?.has(got) || (g.active(e.seat)?.resist?.(g, e.seat) ?? 0) > 0) return;
    // 还能换的牌：没锁住、还在牌山（岭上摸牌时也算岭上牌）里
    const pool = [...g.wall.live, ...(g.rinshanDraw ? g.wall.rinshan : [])].filter((t) => !g.wall.locked.has(t));
    for (let n = rs.length; n > 0; n--) {
      const deny = (t: TileId) => rs.slice(0, n).some((r) => r.deny(t));
      if (!pool.some((t) => !deny(t))) continue;
      stats.ruleChecks++;
      if (deny(got)) problem(`座位 ${e.seat} 摸到了被规矩禁止的牌 ${got}（${rs.map((r) => r.text).join('、')}）`);
      return;
    }
  });

  let steps = 0;
  while (g.phase !== 'gameEnd') {
    if (++steps > 20000) {
      problem('对局没有结束');
      return;
    }
    if (g.phase === 'roundEnd') {
      const total = g.players.reduce((s, p) => s + p.score, 0) + g.riichiSticks * 1000;
      if (total !== 100000) problem(`点数不守恒：${total}`);
      g.nextRound();
      continue;
    }
    const seat = g.waitingSeats()[0];
    try {
      g.act(seat, chooseAction(g, seat, seats[seat].ai));
    } catch (err) {
      problem(`报错：${(err as Error).message}`);
      return;
    }
    if (g.wall.deny) problem('摸牌的规矩漏到了摸牌以外');
    if (g.phase !== 'turn' && g.phase !== 'calls') continue;
    const tiles = tilesInPlay(g);
    if (tiles.length !== TILE_COUNT || new Set(tiles).size !== TILE_COUNT) problem(`牌数不对：${tiles.length} 张，${new Set(tiles).size} 种`);
    // 锁住的牌：从摸牌起点数第几张，锁住以后不能变
    // 解开过的锁不算：能力的主人可以改主意（比如衣换了听牌重新安排海底），换了一批人锁就从新位置算起
    const front = g.wall.frontDrawn;
    g.wall.live.forEach((t, k) => {
      if (!g.wall.locked.has(t)) return;
      const who = g.wall.locked.ownersOf(t).join();
      const was = lockPos.get(t);
      if (was === undefined || was.who !== who) lockPos.set(t, { pos: front + k, who });
      else if (was.pos !== front + k) problem(`锁住的牌 ${t} 被挪了：第 ${was.pos} 张 → 第 ${front + k} 张（${who}）`);
    });
    for (const t of [...lockPos.keys()]) if (!g.wall.locked.has(t)) lockPos.delete(t);
  }
  stats.games++;
}

export function newStats(): BrawlStats {
  return { games: 0, rounds: 0, draws: 0, wins: 0, abilityEvents: new Map(), ruleChecks: 0, problems: [] };
}

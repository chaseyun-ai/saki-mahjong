import { afterAll, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { PRIORITY } from '../src/abilities/types';
import { type DrawRec, type GameRec, nestedOutsideDraws, recordGame, uninstallRecorder } from './trace/recorder';

// 用记录器把每次摸牌从能力处理到取牌的全过程记下来，逐次核对（大星淡、石户霞、天江衣 + 轮换一人，郝慧宇也在轮换里）：
// - 牌守恒、公开的牌不变、锁住的牌不动
// - 处理次数有界：每个钩子一次摸牌只调一次，没有钩子套钩子，换牌次数有上限
// - 处理顺序固定：控场的人按优先级 → 摸牌人自己 → 对账 → 摸牌后
// - 同种牌互换不会被当成条件改变（摸牌时的同种互换只允许赤五和普通五之间）
// - 同一种子重放，记录逐字一致

const GAMES = Number(process.env.TRACE_GAMES ?? 8);
const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const OTHERS = ['saki', 'kuro', 'toki', 'nodoka', 'huiyu'];
const lineup = (seed: number) => ['awai', 'kasumi', 'koromo', OTHERS[seed % OTHERS.length]].map(byId);
const priorityOf = (id: string) => CHARACTERS.find((c) => c.id === id)?.ability?.priority ?? PRIORITY.self;

// 配牌阶段换牌的上限：淡摆配牌 13 + 转角 1 + 里宝 2 + 打坏三家各 100 步（再加清掉违反别人规矩的牌 13 张）；霞换三家配牌最多 39 张
const DEAL_SWAP_LIMIT = 13 + 1 + 2 + 3 * (100 + 13) + 39;

afterAll(uninstallRecorder);

function checkDraw(r: DrawRec, tag: string): string[] {
  const bad: string[] = [];
  const at = `${tag} ${r.round} 第 ${r.idx} 次摸牌`;
  if (!r.conserved) bad.push(`${at}：牌不守恒`);
  if (!r.publicSame) bad.push(`${at}：公开的牌变了`);
  if (!r.locksStay) bad.push(`${at}：锁住的牌被换了位置`);
  if (r.nested) bad.push(`${at}：钩子套钩子`);
  const counts = new Map<string, number>();
  for (const h of r.hooks) counts.set(h, (counts.get(h) ?? 0) + 1);
  for (const [h, n] of counts) if (n > 1) bad.push(`${at}：${h} 调了 ${n} 次`);
  // 顺序：beforeAnyDraw 按优先级 → beforeDraw → afterDraw
  const stage = (h: string) => (h.endsWith('beforeAnyDraw') ? 0 : h.endsWith('beforeDraw') ? 1 : h.endsWith('afterDraw') ? 2 : 3);
  const order = r.hooks.map((h) => stage(h) * 1000 + (stage(h) === 0 ? priorityOf(h.split('.')[0]) : 0));
  if (order.some((x, i) => i > 0 && x < order[i - 1])) bad.push(`${at}：钩子顺序乱了 ${r.hooks.join(' → ')}`);
  // 换牌次数：衣的海底 1 次 + 下一张 1 次（自己的能力和对账只会有一个换成）+ 摸牌后 1 次（淡的里宝）
  if (r.swaps.length > 3) bad.push(`${at}：换了 ${r.swaps.length} 次`);
  const headSwaps = r.swaps.filter((s) => s.by !== 'koromo.beforeAnyDraw' && !s.by.endsWith('afterDraw') && [s.a, s.b].some((p) => p === '牌山[0]' || p === '岭上[0]'));
  if (headSwaps.length > 1) bad.push(`${at}：下一张被换了 ${headSwaps.length} 次`);
  // 找牌来换的调用：控场的人各 1 次 + 自己的能力最多 2 次 + 对账最多每条规矩 1 次 + 摸牌后 1 次
  if (r.bringCalls > counts.size + 2 + r.rules.length) bad.push(`${at}：找牌调用 ${r.bringCalls} 次`);
  if (r.enforceTries > r.rules.length) bad.push(`${at}：对账试了 ${r.enforceTries} 次`);
  for (const s of r.swaps) if (s.sameKind && !s.redDiffers) bad.push(`${at}：${s.by} 把同一种牌换来换去 ${JSON.stringify(s)}`);
  const slots = r.swaps.flatMap((s) => [`${s.a}|${s.ta}`, `${s.b}|${s.tb}`]);
  if (new Set(slots).size !== slots.length) bad.push(`${at}：同一张牌在同一个位置被换了两次`);
  return bad;
}

describe('能力记录器', () => {
  const games: GameRec[] = [];
  for (let seed = 1; seed <= GAMES; seed++) games.push(recordGame(seed, lineup(seed)));

  it(`${GAMES} 场里每一次摸牌：守恒、公开牌不变、锁不动、次数有界、顺序固定`, () => {
    const bad: string[] = [];
    let draws = 0;
    let withRules = 0;
    for (const g of games) {
      for (const r of g.draws) {
        draws++;
        if (r.rules.length) withRules++;
        bad.push(...checkDraw(r, g.tag));
      }
    }
    console.log({ games: games.length, draws, withRules });
    expect(bad.slice(0, 20)).toEqual([]);
    expect(nestedOutsideDraws()).toBe(0);
    expect(withRules).toBeGreaterThan(draws / 4);
  }, 120000);

  it('配牌阶段：换牌次数有界，没有无意义的同种互换', () => {
    const bad: string[] = [];
    for (const g of games) {
      for (const d of g.deals) {
        if (d.swaps.length > DEAL_SWAP_LIMIT) bad.push(`${g.tag} ${d.round}：配牌换了 ${d.swaps.length} 次`);
        for (const s of d.swaps) if (s.sameKind && !s.redDiffers) bad.push(`${g.tag} ${d.round}：${s.by} 同种互换 ${JSON.stringify(s)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('能力处理都按记录的顺序发生：先定规矩，再自己的能力，再对账，最后取牌', () => {
    // 找一次有两条规矩、下一张违反规矩的摸牌，看记录里的先后
    const r = games.flatMap((g) => g.draws).find((x) => x.rules.length >= 2 && x.rules.some((y) => y.deniedHead));
    expect(r).toBeDefined();
    const text = r!.lines.join('\n');
    const lastRule = text.lastIndexOf('定下规矩');
    const end = text.indexOf('对账结束');
    const take = text.indexOf('取牌：');
    expect(lastRule).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(lastRule);
    expect(take).toBeGreaterThan(end);
    // 对账换来的牌就是摸到的牌
    const enforce = r!.swaps.filter((s) => s.by === '对账');
    if (enforce.length) expect([enforce[0].ta, enforce[0].tb]).toContain(r!.drawn);
  });

  it('同一种子重放两次，记录逐字一致', () => {
    const seed = 3;
    const a = recordGame(seed, lineup(seed));
    const b = recordGame(seed, lineup(seed));
    expect(a.draws.length).toBeGreaterThan(50);
    expect(b.draws.map((r) => r.lines.join('\n'))).toEqual(a.draws.map((r) => r.lines.join('\n')));
    expect(b.deals.map((d) => JSON.stringify(d.swaps))).toEqual(a.deals.map((d) => JSON.stringify(d.swaps)));
  }, 60000);
});

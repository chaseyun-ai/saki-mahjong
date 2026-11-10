import { describe, expect, it } from 'vitest';
import { AISLINN, aislinnBrushes, aislinnCanBrush, aislinnPlan, findSketch } from '../src/abilities/aislinn';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const PLAIN = ['aislinn', 'izumi', 'izumi', 'izumi'];

function newGame(seed: number, ids: string[], manual = false) {
  return new Game({ seed, format: 'south', players: ids.map((id, s) => ({ name: id, ability: byId(id).ability, manual: manual && s === 0 })) });
}

function step(g: Game, ids: string[]) {
  if (g.phase === 'roundEnd') {
    g.nextRound();
    return;
  }
  const s = g.waitingSeats()[0];
  g.act(s, chooseAction(g, s, byId(ids[s]).ai));
}

describe('爱丽丝', () => {
  it('配完牌就画出手绘板：画上的牌是一副完整的和牌，要摸的牌就是她接下来摸到的牌', () => {
    let painted = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = newGame(seed, PLAIN);
      const plan = aislinnPlan(g, 0);
      if (!plan) continue;
      painted++;
      expect(shanten(toCounts(plan.final), 0)).toBe(-1);
      expect(plan.final.at(-1)).toBe(plan.win);
      // 画上要摸的牌锁住（庄家的第一张建牌局时已经摸了）
      plan.draws.forEach((t, i) => {
        if (i >= plan.step && plan.needed[i]) expect(g.wall.locked.ownersOf(t)).toContain('aislinn');
      });
    }
    expect(painted).toBeGreaterThan(15);
  });

  it('牌山凑不出来时安排的牌最多 1 番（只有门清自摸、不立直）', () => {
    let arranged = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const g = newGame(seed, PLAIN);
      const plan = aislinnPlan(g, 0);
      if (!plan?.arranged) continue;
      arranged++;
      expect(plan.han).toBeLessThanOrEqual(AISLINN.maxHan);
    }
    expect(arranged).toBeGreaterThan(0);
  });

  it('没人鸣牌时照着画的打一定和得了（走到画上的自摸，或者先荣和）', () => {
    let done = 0;
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const ids = ['aislinn', 'izumi', 'izumi', 'izumi'];
      // 别人都不鸣：把对手的电脑换成只会摸切的
      const g = newGame(seed, ids);
      const plan = aislinnPlan(g, 0);
      if (!plan) continue;
      let guard = 0;
      while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++guard < 400) {
        const s = g.waitingSeats()[0];
        if (s === 0) g.act(0, chooseAction(g, 0, byId('aislinn').ai));
        else {
          const legal = g.legalActions(s);
          const pass = legal.find((a) => a.type === 'pass');
          const tsumogiri = legal.find((a) => a.type === 'discard' && !a.riichi && a.tile === g.players[s].drawn);
          g.act(s, pass ?? tsumogiri ?? legal.find((a) => a.type === 'discard')!);
        }
      }
      done++;
      const r = g.roundResult;
      // 照着画的打一定和得了：自摸，或者在那之前先荣和了别人打的牌
      if (r?.kind === 'win' && r.wins.some((w) => w.seat === 0)) wins++;
    }
    expect(done).toBeGreaterThan(20);
    expect(wins).toBe(done);
  });

  it('有人鸣牌手绘板就碎；碎了以后用画笔再画一次，画笔一场 3 支、不恢复', () => {
    const g = newGame(7, PLAIN, true);
    expect(aislinnBrushes(g, 0)).toBe(3);
    expect(aislinnPlan(g, 0)).not.toBeNull();
    // 模拟有人碰牌
    g.emit({ type: 'call', seat: 2, call: '碰' });
    expect(aislinnPlan(g, 0)).toBeNull();
    expect([...g.wall.locked].some((t) => g.wall.locked.ownersOf(t).includes('aislinn'))).toBe(false);
    expect(aislinnCanBrush(g, 0)).toBe(true);
    byId('aislinn').ability!.pressSkill!(g, 0);
    expect(aislinnBrushes(g, 0)).toBe(2);
    expect(aislinnPlan(g, 0)).not.toBeNull();
    // 画着的时候画笔按不了
    expect(aislinnCanBrush(g, 0)).toBe(false);
  });

  it('立直了也能画：只等一张和了牌', () => {
    const g = newGame(3, PLAIN);
    const p = g.players[0];
    p.riichi = true;
    const plan = findSketch(g, 0, g.nextDrawer());
    if (plan) {
      const extra = plan.final.filter((t) => !p.hand.includes(t));
      expect(extra).toEqual([plan.win]);
    }
  });

  it('整场电脑打：不报错', () => {
    for (const seed of [1, 2, 3]) {
      const ids = ['aislinn', 'awai', 'kuro', 'teru'];
      const g = newGame(seed, ids);
      let n = 0;
      while (g.phase !== 'gameEnd' && ++n < 20000) step(g, ids);
      expect(g.phase).toBe('gameEnd');
    }
  }, 60000);
});

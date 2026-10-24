import { afterEach, describe, expect, it } from 'vitest';
import { AWAI, awaiEnergy } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { kasumiSuit } from '../src/abilities/kasumi';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const saved = { ...AWAI };
afterEach(() => Object.assign(AWAI, saved));

function newGame(ids: string[], manual: number | null, seed = 7) {
  return new Game({ seed, players: ids.map((id, i) => ({ name: id, ability: byId(id).ability, manual: i === manual })) });
}
const circle = (g: Game, seat: number) => !!(g.abilityState[seat] as { circle?: boolean }).circle;
const restart = (g: Game) => (g as unknown as { startRound(): void }).startRound();

describe('大星淡的能量', () => {
  it('玩家操作时：不按就不开；按了下一局起每局扣 20；开着时关掉扣 30', () => {
    const g = newGame(['awai', 'saki', 'nodoka', 'kuro'], 0);
    expect(circle(g, 0)).toBe(false);
    expect(awaiEnergy(g, 0)).toEqual({ energy: 100, on: false });
    g.abilities[0]!.pressSkill!(g, 0);
    expect(awaiEnergy(g, 0)).toEqual({ energy: 100, on: true });
    restart(g);
    expect(circle(g, 0)).toBe(true);
    expect(awaiEnergy(g, 0).energy).toBe(80);
    restart(g);
    expect(awaiEnergy(g, 0).energy).toBe(60);
    g.abilities[0]!.pressSkill!(g, 0);
    expect(awaiEnergy(g, 0)).toEqual({ energy: 30, on: false });
    restart(g);
    expect(circle(g, 0)).toBe(false);
    expect(awaiEnergy(g, 0).energy).toBe(30);
    // 能量不够关掉时按钮不可用，按了也没用
    g.abilities[0]!.pressSkill!(g, 0);
    restart(g);
    expect(awaiEnergy(g, 0).energy).toBe(10);
    expect(g.abilities[0]!.skill!(g, 0)!.enabled).toBe(false);
    // 能量不够一局时自动关掉
    restart(g);
    expect(circle(g, 0)).toBe(false);
    expect(awaiEnergy(g, 0)).toEqual({ energy: 10, on: false });
  });

  it('电脑：领先时不开，落后时开', () => {
    Object.assign(AWAI, { aiLeadChance: 0 });
    const g = newGame(['awai', 'saki', 'nodoka', 'kuro'], null);
    // 开局平分算不上领先，会开
    expect(circle(g, 0)).toBe(true);
    g.abilities[0]!.pressSkill!(g, 0); // 关掉，看下一局的决定
    g.players[0].score = 40000;
    restart(g);
    expect(circle(g, 0)).toBe(false);
    g.players[0].score = 10000;
    restart(g);
    expect(circle(g, 0)).toBe(true);
  });
});

describe('石户霞的请神按钮', () => {
  it('玩家操作时不自动请神；落后时按了，下一局请神，之后整场都在', () => {
    const g = newGame(['kasumi', 'saki', 'nodoka', 'kuro'], 0);
    g.players[0].score = 10000;
    restart(g);
    expect(kasumiSuit(g, 0)).toBeNull();
    g.players[0].score = 40000;
    expect(g.abilities[0]!.skill!(g, 0)!.enabled).toBe(false);
    g.players[0].score = 10000;
    g.abilities[0]!.pressSkill!(g, 0);
    restart(g);
    expect(kasumiSuit(g, 0)).not.toBeNull();
    g.players[0].score = 40000;
    restart(g);
    expect(kasumiSuit(g, 0)).not.toBeNull();
    expect(g.abilities[0]!.skill!(g, 0)!.enabled).toBe(false);
  });

  it('电脑的霞照旧一落后就请神', () => {
    const g = newGame(['kasumi', 'saki', 'nodoka', 'kuro'], null);
    g.players[0].score = 10000;
    restart(g);
    expect(kasumiSuit(g, 0)).not.toBeNull();
  });
});

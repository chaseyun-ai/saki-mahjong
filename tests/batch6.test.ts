import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { dangerKinds } from '../src/abilities/hiroe';
import { RYUUKA, ryuukaMugoku, ryuukaPillow } from '../src/abilities/ryuuka';
import { SERA } from '../src/abilities/sera';
import { SUMIRE, sumireAimedAt, sumireTarget } from '../src/abilities/sumire';
import { teruWinValue } from '../src/abilities/teru';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], setup: (g: Game) => void, opts: { format?: 'east' | 'south' | 'team'; allies?: string[][] } = {}) {
  const seats = ids.map(byId);
  const g = new Game({ seed, format: opts.format ?? 'east', allies: opts.allies, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  setup(g);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  expect(g.phase).toBe('gameEnd');
  return g;
}

describe('新角色', () => {
  it('费用和学校：泉 1 费没有能力，堇 2 费，夕、龙华 3 费', () => {
    expect(byId('izumi')).toMatchObject({ cost: 1, ability: null, school: '千里山女子' });
    expect(byId('sumire')).toMatchObject({ cost: 2, school: '白糸台高中' });
    expect(byId('sera')).toMatchObject({ cost: 3, school: '千里山女子' });
    expect(byId('ryuuka')).toMatchObject({ cost: 3, school: '千里山女子' });
  });
});

describe('清水谷龙华', () => {
  it('不管和不和怜同队都有膝枕（一场最多 4 次），无极天一场最多 3 次；先见只在膝枕的局开着', () => {
    for (let seed = 1; seed <= 4; seed++) {
      for (const withToki of [true, false]) {
        const ids = ['ryuuka', 'saki', 'kuro', 'hiroe'];
        const allies = [withToki ? ['ryuuka', 'toki', 'izumi'] : ['ryuuka', 'izumi'], [], [], []];
        let pillow = 0;
        let mugoku = 0;
        play(
          seed,
          ids,
          (g) =>
            g.onEvent((e) => {
              if (e.type === 'ability' && e.seat === 0 && e.text === '怜的膝枕') pillow++;
              if (e.type === 'ability' && e.seat === 0 && e.text === '无极天') mugoku++;
              if (e.type === 'draw') expect(g.abilities[0]!.foresightOn!(g, 0)).toBe(ryuukaPillow(g, 0));
            }),
          { format: 'team', allies },
        );
        expect(pillow).toBeGreaterThan(0);
        expect(pillow).toBeLessThanOrEqual(RYUUKA.pillowUses);
        expect(mugoku).toBeGreaterThan(0);
        expect(mugoku).toBeLessThanOrEqual(RYUUKA.mugokuUses);
      }
    }
  }, 120000);

  it('无极天的局：摸牌更常是进张；电脑的龙华不打会放铳的牌', () => {
    const n = { on: 0, onGood: 0, off: 0, offGood: 0, checked: 0 };
    for (let seed = 1; seed <= 24; seed++) {
      play(
        seed,
        ['ryuuka', 'saki', 'kuro', 'hiroe'],
        (g) => {
          let before = 99;
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat !== 0 || g.rinshanDraw) return;
            const p = g.players[0];
            const after = shanten(toCounts(p.hand), p.melds.length);
            const prev = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
            before = prev;
            if (before <= 0) return;
            if (ryuukaMugoku(g, 0)) {
              n.on++;
              n.onGood += after < before ? 1 : 0;
            } else {
              n.off++;
              n.offGood += after < before ? 1 : 0;
            }
            if (!ryuukaMugoku(g, 0) || p.riichi) return;
            const danger = dangerKinds(g, 0);
            if (!danger.size || p.hand.every((t) => danger.has(kindOf(t)))) return;
            const a = chooseAction(g, 0, byId('ryuuka').ai);
            if (a.type !== 'discard') return;
            n.checked++;
            expect(danger.has(kindOf(a.tile))).toBe(false);
          });
        },
        { format: 'team' },
      );
    }
    expect(n.on).toBeGreaterThan(50);
    expect(n.onGood / n.on).toBeGreaterThan(n.offGood / n.off + 0.1);
  }, 120000);
});

describe('弘世堇', () => {
  it('每局瞄准领先的那家；电脑的堇牌山还多时不和别人打的牌', () => {
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['sumire', 'saki', 'kuro', 'mako'], (g) =>
        g.onEvent((e) => {
          if (e.type === 'roundStart') {
            const t = sumireTarget(g, 0)!;
            expect(t).not.toBe(0);
            const top = Math.max(...[1, 2, 3].map((s) => g.players[s].score));
            expect(g.players[t].score).toBe(top);
          }
          if (e.type === 'roundEnd') {
            for (const w of e.result.wins) {
              if (w.seat !== 0 || w.from === null) continue;
              wins++;
              if (g.wall.remaining > SUMIRE.anyRon) expect(w.from).toBe(sumireTarget(g, 0));
            }
          }
        }),
      );
    }
    expect(wins).toBeGreaterThan(0);
  }, 120000);

  it('被瞄准的洋榎、照看得出她听什么，不打给她', () => {
    let checked = 0;
    for (let seed = 1; seed <= 16; seed++) {
      for (const reader of ['hiroe', 'teru']) {
        play(seed, ['sumire', reader, 'kuro', 'mako'], (g) =>
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat !== 1 || g.players[1].riichi) return;
            const aimed = sumireAimedAt(g, 1);
            if (!aimed.size || g.players[1].hand.every((t) => aimed.has(kindOf(t)))) return;
            const a = chooseAction(g, 1, byId(reader).ai);
            if (a.type !== 'discard') return;
            checked++;
            expect(aimed.has(kindOf(a.tile))).toBe(false);
          }),
        );
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 240000);
});

describe('江口夕', () => {
  it('配牌里的宝牌、役牌比别人多；电脑的夕牌山还多时不和满贯以下的牌，听牌能立直就立直', () => {
    let mine = 0;
    let others = 0;
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['sera', 'saki', 'kuro', 'mako'], (g) => {
        g.onEvent((e) => {
          if (e.type === 'roundStart') {
            const kuro = g.players.findIndex((p) => p.name === 'kuro');
            // 玄的宝牌在时别人拿不到宝牌，只数役牌
            const yaku = (s: number) => g.players[s].hand.filter((t) => kindOf(t) >= 31 || kindOf(t) === g.seatWind(s) || kindOf(t) === 27 + g.roundWind).length;
            mine += yaku(0);
            others += [1, 2, 3].filter((s) => s !== kuro).reduce((n, s) => n + yaku(s), 0) / 2;
          }
          if (e.type === 'roundEnd') {
            for (const w of e.result.wins) {
              if (w.seat !== 0) continue;
              wins++;
              const pay = teruWinValue(w.result, w.from === null, g.dealer === 0);
              if (g.wall.remaining > SERA.holdLate) expect(pay).toBeGreaterThanOrEqual(g.dealer === 0 ? SERA.mangan * 1.5 : SERA.mangan);
            }
          }
          if (e.type === 'discard' && e.seat === 0 && !e.riichi && !g.players[0].riichi) {
            // 打完以后听牌、还能立直（门清、点数够）时，夕一定立直
            const p = g.players[0];
            const closed = p.melds.every((m) => m.type === 'ankan');
            if (closed && p.score >= 1000 && g.wall.remaining >= 4 && g.waits(0).length && g.canWin(0)) {
              const left = g.waits(0).some((k) => 4 - g.players.flatMap((q) => [...q.discards.map((d) => d.tile), ...q.melds.flatMap((m) => m.tiles)]).concat(p.hand).filter((t) => kindOf(t) === k).length > 0);
              if (left) expect(p.riichi || p.riichiPending).toBe(true);
            }
          }
        });
      });
    }
    expect(mine).toBeGreaterThan(others);
    expect(wins).toBeGreaterThan(0);
  }, 120000);
});

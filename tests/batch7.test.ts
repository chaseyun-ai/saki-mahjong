import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { KANA, kanaAbility } from '../src/abilities/kana';
import { KAORI, kaoriAbility, kaoriYakuman } from '../src/abilities/kaori';
import { KINUE, kinueAbility } from '../src/abilities/kinue';
import { HIROKO_NOTES, hirokoBias } from '../src/abilities/hiroko';
import { yumiAbility } from '../src/abilities/yumi';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten, waitingKinds } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';
import type { Ability } from '../src/abilities/types';
import { APPEARANCE, SCHOOLS, membersOf } from '../src/ui/schools';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function game(seed: number, at: number, ability: Ability | null, scores?: number[]) {
  return new Game({ seed, format: 'east', scores, players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, ability: i === at ? ability : null })) });
}

describe('风越、鹤贺、千里山、新道寺、姬松的新人', () => {
  it('角色表：学校、能力、费用', () => {
    const want: [string, string, string | null][] = [
      ['miharu', '风越女子', null],
      ['seika', '风越女子', null],
      ['sumiyo', '风越女子', null],
      ['kana', '风越女子', 'kana'],
      ['mutsuki', '鹤贺学园', null],
      ['kaori', '鹤贺学园', 'kaori'],
      ['satomi', '鹤贺学园', null],
      ['yumi', '鹤贺学园', 'yumi'],
      ['hiroko', '千里山女子', null],
      ['mieko', '新道寺女子', null],
      ['hitomi', '新道寺女子', null],
      ['yuuko', '姬松高中', null],
      ['kinue', '姬松高中', 'kinue'],
    ];
    for (const [id, school, ability] of want) {
      expect(byId(id).school).toBe(school);
      expect(byId(id).ability?.id ?? null).toBe(ability);
      expect(byId(id).cost).toBeGreaterThanOrEqual(1);
    }
    expect(byId('hiroko').ai.scout).toBe(true);
    expect(byId('hiroko').note).toBeTruthy();
  });

  it('选人页按原作出场顺序：学校按比赛先后，学校里先锋到大将', () => {
    expect(SCHOOLS.map((s) => s.short)).toEqual(['清澄', '龙门渊', '风越', '鹤贺', '阿知贺', '千里山', '新道寺', '白糸台', '永水', '宫守', '姬松', '临海', '有珠山']);
    expect(membersOf('风越女子').map((c) => c.name)).toEqual(['福路美穗子', '吉留未春', '文堂星夏', '深堀纯代', '池田华菜']);
    expect(membersOf('鹤贺学园').map((c) => c.name)).toEqual(['津山睦月', '妹尾佳织', '蒲原智美', '东横桃子', '加治木由美']);
    expect(membersOf('千里山女子').map((c) => c.name)).toEqual(['园城寺怜', '二条泉', '江口夕', '船久保浩子', '清水谷龙华']);
    expect(membersOf('新道寺女子').map((c) => c.name)).toEqual(['花田煌', '安河内美子', '江崎仁美', '白水哩', '鹤田姬子']);
    expect(membersOf('姬松高中').map((c) => c.name)).toEqual(['上重漫', '真濑由子', '爱宕洋榎', '爱宕娟慧', '末原恭子']);
    expect(membersOf('清澄高中').map((c) => c.id)).toEqual(['yuuki', 'mako', 'hisa', 'nodoka', 'saki']);
    // 每个学校都写全了，没有角色漏在 lineup 外面
    for (const s of SCHOOLS) expect(new Set(membersOf(s.name).map((c) => c.id))).toEqual(new Set(s.lineup));
    expect(APPEARANCE.length).toBe(CHARACTERS.length);
    expect(APPEARANCE[0].id).toBe('yuuki');
  });

  it('浩子的资料本写到了每一种能力', () => {
    for (const c of CHARACTERS) if (c.ability) expect(HIROKO_NOTES[c.ability.id], c.id).toBeTruthy();
  });
});

describe('池田华菜', () => {
  // 只打一局：听牌前每次摸牌是有效进张（向听前进）的比例
  const rate = (score: number) => {
    let useful = 0;
    let draws = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const g = game(seed, 0, kanaAbility, [score, 25000, 25000, 50000 - score]);
      g.onEvent((e) => {
        if (e.type !== 'draw' || e.seat !== 0) return;
        const p = g.players[0];
        const before = toCounts(p.hand.filter((t) => t !== p.drawn));
        const sh = shanten(before, p.melds.length);
        if (sh <= 0) return;
        draws++;
        before[kindOf(p.drawn!)]++;
        if (shanten(before, p.melds.length) < sh) useful++;
      });
      let steps = 0;
      while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++steps < 2000) {
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, byId(s === 0 ? 'kana' : 'izumi').ai));
      }
    }
    return useful / draws;
  };

  it('点数低于 10000 时进张变顺，高的时候和普通人一样', () => {
    const low = rate(8000);
    const high = rate(25000);
    expect(low).toBeGreaterThan(high + KANA.luck * 0.3);
    expect(kanaAbility.badge!(game(1, 0, kanaAbility, [8000, 30000, 30000, 32000]), 0)).toBe('背水');
    expect(kanaAbility.badge!(game(1, 0, kanaAbility, [25000, 25000, 25000, 25000]), 0)).toBeNull();
  }, 60000);
});

describe('妹尾佳织', () => {
  it('新手运：配牌是役满听牌，和出来一定是役满；电脑只摸切', () => {
    const old = KAORI.chance;
    KAORI.chance = 1;
    try {
      let dealt = 0;
      let yakuman = 0;
      let wins = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const g = game(seed, 1, kaoriAbility);
        const name = kaoriYakuman(g, 1);
        if (!name) continue;
        dealt++;
        const hand = g.players[1].hand;
        expect(waitingKinds(toCounts(hand), 0).length).toBeGreaterThan(0);
        let steps = 0;
        while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++steps < 2000) {
          const s = g.waitingSeats()[0];
          g.act(s, chooseAction(g, s, byId(s === 1 ? 'kaori' : 'izumi').ai));
          // 一直还听着
          if (g.players[1].hand.length % 3 === 1) expect(waitingKinds(toCounts(g.players[1].hand), g.players[1].melds.length).length).toBeGreaterThan(0);
        }
        expect(g.players[1].melds.length).toBe(0);
        const win = g.roundResult?.wins.find((w) => w.seat === 1);
        if (win) {
          wins++;
          if (win.result.yaku.some((y) => y.han >= 13)) yakuman++;
        }
      }
      expect(dealt).toBeGreaterThan(18);
      expect(wins).toBeGreaterThan(0);
      expect(yakuman).toBe(wins);
    } finally {
      KAORI.chance = old;
    }
  }, 60000);
});

describe('加治木由美', () => {
  it('2 费，常态顺 5%', () => {
    expect(byId('yumi').cost).toBe(2);
    expect(yumiAbility.beforeDeal).toBeTruthy();
    expect(yumiAbility.beforeDraw).toBeTruthy();
  });
});

describe('爱宕娟慧', () => {
  it('手里有一筒时更容易摸到一筒', () => {
    const count = (ab: Ability | null) => {
      let draws = 0;
      let pin1 = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const g = game(seed, 0, ab);
        let steps = 0;
        g.onEvent((e) => {
          if (e.type !== 'draw' || e.seat !== 0) return;
          const p = g.players[0];
          const before = p.hand.filter((t) => t !== p.drawn);
          if (!before.some((t) => kindOf(t) === KINUE.kind)) return;
          // 只数没听牌、牌山里还有一筒（或者摸到的就是）的时候
          if (waitingKinds(toCounts(before), p.melds.length).length) return;
          if (kindOf(p.drawn!) !== KINUE.kind && !g.wall.live.some((t) => kindOf(t) === KINUE.kind)) return;
          draws++;
          if (kindOf(p.drawn!) === KINUE.kind) pin1++;
        });
        while (g.phase !== 'gameEnd' && ++steps < 20000) {
          if (g.phase === 'roundEnd') {
            g.nextRound();
            continue;
          }
          const s = g.waitingSeats()[0];
          g.act(s, chooseAction(g, s, byId(s === 0 ? 'kinue' : 'izumi').ai));
        }
      }
      return pin1 / draws;
    };
    const base = count(null);
    const kinue = count(kinueAbility);
    expect(kinue).toBeGreaterThan(base + KINUE.pull * 0.6);
  }, 120000);
});

describe('船久保浩子', () => {
  it('防守：知道灼听四、六到九饼', () => {
    const g = new Game({ seed: 3, format: 'east', players: [0, 1, 2, 3].map((i) => ({ name: `p${i}`, ability: i === 1 ? CHARACTERS.find((c) => c.id === 'arata')!.ability : null })) });
    expect(hirokoBias(g, 0, 1, 15)).toBeGreaterThan(0);
    expect(hirokoBias(g, 0, 1, 10)).toBe(0);
    expect(hirokoBias(g, 0, 2, 15)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { HIROKO_NOTES } from '../src/abilities/hiroko';
import { MYEONGHWA, myeonghwaAbility, myeonghwaComing, myeonghwaCut, myeonghwaSinging, myeonghwaSong, myeonghwaWinds } from '../src/abilities/myeonghwa';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { EAST, NORTH, SOUTH, WEST, kindOf, parseKinds, type TileId } from '../src/engine/tiles';
import { SCHOOLS } from '../src/ui/schools';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const isWind = (t: number) => kindOf(t) >= EAST && kindOf(t) <= NORTH;
const newGame = (seed: number, ids: string[]) => new Game({ seed, format: 'south', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });

// 把这一家的手牌换成指定的牌：缺的从牌山、王牌、还没摆过牌的人手里换（不凭空造牌），张数要和现在的手牌一样
const fixed = new WeakMap<Game, Set<number>>();
function setHand(g: Game, seat: number, s: string): boolean {
  const want = parseKinds(s);
  const p = g.players[seat];
  expect(want.length).toBe(p.hand.length);
  const done = fixed.get(g) ?? new Set<number>();
  fixed.set(g, done);
  done.add(seat);
  const rest = [...p.hand];
  const keep: TileId[] = [];
  const need: number[] = [];
  for (const k of want) {
    const i = rest.findIndex((t) => kindOf(t) === k);
    if (i >= 0) keep.push(rest.splice(i, 1)[0]);
    else need.push(k);
  }
  const sources = [g.wall.live, g.wall.rinshan, g.wall.uraIndicators, ...g.players.filter((q) => !done.has(q.seat)).map((q) => q.hand)];
  for (const k of need) {
    const src = sources.find((a) => a.some((t) => kindOf(t) === k));
    if (!src) return false;
    const j = src.findIndex((t) => kindOf(t) === k);
    keep.push(src[j]);
    src[j] = rest.pop()!;
  }
  p.hand = keep;
  if (p.drawn !== null) p.drawn = keep[keep.length - 1];
  return true;
}

// 电脑打到轮到 seat 出牌（摸完牌）为止。这一局先结束了返回 false
function until(g: Game, ids: string[], seat: number): boolean {
  let n = 0;
  while (!(g.phase === 'turn' && g.turn === seat && g.players[seat].drawn !== null)) {
    if (g.phase === 'roundEnd' || g.phase === 'gameEnd' || ++n > 400) return false;
    if (g.phase === 'predeal') {
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
  return true;
}

// 电脑把一场打完。each：每一步之前调（停在发牌前时返回 true 表示自己处理了）
function play(g: Game, ids: string[], onPreDeal?: () => void): void {
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 60000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      onPreDeal?.();
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, byId(ids[s]).ai));
  }
  expect(g.phase).toBe('gameEnd');
}

describe('雀明华：登记', () => {
  it('4 费，在临海女子的名单里，浩子的资料本里有她', () => {
    const c = byId('myeonghwa');
    expect(c.cost).toBe(4);
    expect(c.school).toBe('临海女子');
    expect(c.ability).toBe(myeonghwaAbility);
    expect(SCHOOLS.find((s) => s.name === '临海女子')!.lineup).toContain('myeonghwa');
    expect(HIROKO_NOTES.myeonghwa).toBeTruthy();
  });
});

describe('雀明华：风', () => {
  it('每一局配牌都有自风暗刻和一张场风；场风的第二张开局几巡之内摸到；南场配牌多一对客风，成对的风有时摸成暗刻', async () => {
    let rounds = 0;
    let south = 0;
    let grew = 0;
    let came = 0;
    let long = 0;
    let paired = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ids = ['izumi', 'izumi', 'izumi', 'izumi'];
      const seat = seed % 4;
      ids[seat] = 'myeonghwa';
      const g = newGame(seed, ids);
      let draws = 0;
      const check = () => {
        const { seat: sw, round, guest } = myeonghwaWinds(g, seat);
        const hand = g.players[seat].hand;
        const label = `种子 ${seed} ${g.roundLabel()} 客风`;
        if (g.roundWind === 0) expect(guest, label).toBe(null);
        else {
          expect(guest === null || guest === sw || guest === EAST + g.roundWind, label).toBe(false);
          expect(hand.filter((t) => kindOf(t) === guest).length, label).toBeGreaterThanOrEqual(MYEONGHWA.guestWind);
          south++;
        }
        came = 0;
        expect(hand.filter((t) => kindOf(t) === sw).length, `种子 ${seed} ${g.roundLabel()} 自风`).toBeGreaterThanOrEqual(3);
        if (round !== null) expect(hand.filter((t) => kindOf(t) === round).length, `种子 ${seed} ${g.roundLabel()} 场风`).toBeGreaterThanOrEqual(1);
        rounds++;
        draws = 0;
      };
      g.onEvent((e) => {
        if (e.type === 'roundStart') check();
        if (e.type === 'draw' && e.seat === seat) draws++;
        if (e.type === 'ability' && e.ability === 'myeonghwa' && e.text === '风来') came++;
        if (e.type !== 'roundEnd') return;
        // 一局里风来了不止一次：除了场风的第二张，还有一对摸成了暗刻
        if (g.roundWind >= 1 && came >= 2) grew++;
        const { round } = myeonghwaWinds(g, seat);
        if (round === null || draws < MYEONGHWA.roundWithin) return;
        long++;
        const p = g.players[seat];
        const seen = [...p.hand, ...p.melds.flatMap((m) => m.tiles), ...p.discards.map((d) => d.tile)].filter((t) => kindOf(t) === round).length;
        if (seen >= 2) paired++;
      });
      // 第一局在构造时就发了牌
      check();
      play(g, ids);
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(rounds).toBeGreaterThan(80);
    expect(south).toBeGreaterThan(20);
    expect(grew).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(20);
    // 别人先拿走三张的局凑不成，极少
    expect(paired / long).toBeGreaterThan(0.9);
  }, 120000);

  it('自风就是场风的局只要那一副暗刻', () => {
    const g = newGame(3, ['myeonghwa', 'izumi', 'izumi', 'izumi']);
    // 东一局坐庄：自风、场风都是东
    expect(g.dealer).toBe(0);
    expect(myeonghwaWinds(g, 0)).toEqual({ seat: EAST, round: null, guest: null });
    expect(myeonghwaWinds(g, 1).round).toBe(EAST);
  });
});

describe('雀明华：歌', () => {
  it('电脑一场最多开两次嗓，第二次在南场；她和牌升一段，别人和牌就停', async () => {
    let opened = 0;
    let twice = 0;
    let stopped = 0;
    let rose = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ids = seed % 2 ? ['izumi', 'myeonghwa', 'izumi', 'izumi'] : ['yuuki', 'saki', 'myeonghwa', 'kuro'];
      const seat = ids.indexOf('myeonghwa');
      const g = newGame(seed, ids);
      let mine = 0;
      let before = myeonghwaSong(g, seat);
      g.onEvent((e) => {
        if (e.type === 'ability' && e.ability === 'myeonghwa' && e.text === '开嗓') {
          mine++;
          if (mine === 2) expect(g.roundWind, `种子 ${seed} 第二次开嗓`).toBeGreaterThanOrEqual(1);
        }
        if (e.type === 'ability' && e.ability === 'myeonghwa' && e.text === '歌停了') stopped++;
        if (e.type === 'roundStart') before = myeonghwaSong(g, seat);
        if (e.type !== 'roundEnd') return;
        const now = myeonghwaSong(g, seat);
        const won = e.result.kind === 'win' && e.result.wins.some((w) => w.seat === seat);
        const lost = e.result.kind === 'win' && !won;
        const label = `种子 ${seed} ${g.roundLabel()}`;
        if (before === 0) expect(now, label).toBe(0);
        else if (won) {
          expect(now, label).toBe(Math.min(MYEONGHWA.songMax, before + 1));
          if (now > before) rose++;
        } else if (lost) expect(now, label).toBe(0);
        else expect(now, label).toBe(before);
      });
      if (myeonghwaSong(g, seat) > 0) mine++;
      play(g, ids);
      expect(mine, `种子 ${seed}`).toBeLessThanOrEqual(MYEONGHWA.songs);
      if (mine === 2) twice++;
      opened += mine;
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(opened).toBeGreaterThan(6);
    expect(twice).toBeGreaterThan(0);
    expect(stopped).toBeGreaterThan(3);
    expect(rose).toBeGreaterThan(0);
  }, 120000);

  it('玩家发牌前选了才唱；一场两次，第二次要进了南场、歌停着', () => {
    let twice = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const ids = ['izumi', 'myeonghwa', 'izumi', 'izumi'];
      const g = newGame(seed, ids);
      g.manual[1] = true;
      let asked = 0;
      let picked = 0;
      play(g, ids, () => {
        asked++;
        const song = myeonghwaAbility.preDeal!(g, 1).find((o) => o.id === 'song')!;
        const label = `种子 ${seed} ${g.roundLabel()}`;
        // 第一局不唱（没选就不唱）；之后能唱就唱
        if (asked === 1) expect(song.enabled, label).toBe(true);
        if (picked === 1) expect(song.enabled, label).toBe(myeonghwaSong(g, 1) === 0 && g.roundWind >= 1);
        if (picked >= 2) expect(song.enabled, label).toBe(false);
        if (asked >= 2 && song.enabled) {
          myeonghwaAbility.setPreDeal!(g, 1, ['song']);
          picked++;
        } else myeonghwaAbility.setPreDeal!(g, 1, []);
      });
      const texts = g.events.filter((e) => e.type === 'ability' && e.ability === 'myeonghwa').map((e) => (e as { text: string }).text);
      expect(texts.filter((t) => t === '开嗓').length, `种子 ${seed}`).toBe(picked);
      expect(picked).toBeGreaterThanOrEqual(1);
      if (picked === 2) twice++;
    }
    expect(twice).toBeGreaterThan(0);
  }, 120000);
});

describe('雀明华：断风', () => {
  it('选了一家：那一家这一局配牌里没有风牌、也摸不到；她的歌这一局不起作用，自己的风牌照收；不限次数', () => {
    let cuts = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const ids = ['izumi', 'myeonghwa', 'izumi', 'izumi'];
      const g = newGame(seed, ids);
      g.manual[1] = true;
      let asked = 0;
      let cutting = false;
      let sangAt = -1;
      g.onEvent((e) => {
        if (e.type === 'roundStart') {
          const label = `种子 ${seed} ${g.roundLabel()}`;
          expect(myeonghwaCut(g, 1), label).toBe(cutting ? 3 : null);
          if (!cutting) return;
          expect(myeonghwaSinging(g, 1), label).toBe(0);
          if (g.round === sangAt) expect(myeonghwaSong(g, 1), label).toBe(1);
          expect(g.players[3].hand.filter(isWind).length, `${label} 配牌`).toBe(0);
          expect(g.players[1].hand.filter((t) => kindOf(t) === g.seatWind(1)).length, `${label} 自风`).toBeGreaterThanOrEqual(3);
          cuts++;
        }
        // 岭上牌、牌山最后一张（没有别的牌可换）除外
        if (e.type === 'draw' && e.seat === 3 && cutting && g.wall.live.length > 0 && g.players[3].melds.every((m) => !m.type.includes('kan')))
          expect(isWind(g.players[3].drawn!), `种子 ${seed} 摸牌`).toBe(false);
      });
      play(g, ids, () => {
        asked++;
        const opts = myeonghwaAbility.preDeal!(g, 1);
        // 每一局都选得了
        expect(opts.find((o) => o.id === 'cut@2')!.enabled).toBe(true);
        // 第二、第三局连着断风（对家是 seat 3），第二局同时开嗓：歌开起来了，但这一局不起作用
        cutting = asked === 2 || asked === 3;
        myeonghwaAbility.setPreDeal!(g, 1, cutting ? (asked === 2 ? ['song', 'cut@2'] : ['cut@2']) : []);
        if (asked === 2) sangAt = g.round + 1;
      });
    }
    expect(cuts).toBeGreaterThanOrEqual(8);
  }, 60000);

  it('电脑：初美坐北家的局对她断风，那一局初美配牌里没有风牌', async () => {
    let cuts = 0;
    let norths = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const ids = ['myeonghwa', 'izumi', 'hatsumi', 'izumi'];
      const g = newGame(seed, ids);
      const check = () => {
        const north = g.seatWind(2) === NORTH;
        // 不限次数：初美坐北家的局都用，那一局不开嗓
        expect(myeonghwaCut(g, 0), `种子 ${seed} ${g.roundLabel()}`).toBe(north ? 2 : null);
        if (north) {
          expect(myeonghwaSinging(g, 0), `种子 ${seed} ${g.roundLabel()}`).toBe(0);
          expect(g.players[2].hand.filter(isWind).length, `种子 ${seed} ${g.roundLabel()}`).toBe(0);
          cuts++;
          norths++;
        }
      };
      g.onEvent((e) => e.type === 'roundStart' && check());
      check();
      play(g, ids);
      await new Promise((r) => setTimeout(r, 0));
    }
    // 有几场她坐庄连和把人击飞了，初美没轮到北家
    expect(norths).toBeGreaterThan(3);
    expect(cuts).toBe(norths);
  }, 120000);
});

describe('雀明华：电脑的打法', () => {
  it('没人立直、没人鸣满两副时不拆自风暗刻（拆了向听更少的除外；有人逼得紧时照样拿它当安全牌）', async () => {
    let held = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const ids = ['izumi', 'izumi', 'izumi', 'izumi'];
      const me = seed % 4;
      ids[me] = 'myeonghwa';
      const g = newGame(seed, ids);
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 60000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        if ((g.phase as string) === 'predeal') {
          g.deal();
          continue;
        }
        const s = g.waitingSeats()[0];
        const a = chooseAction(g, s, byId(ids[s]).ai);
        if (s === me && g.phase === 'turn' && a.type === 'discard' && !g.players.some((q) => q.seat !== me && (q.riichi || q.melds.length >= 2))) {
          const p = g.players[me];
          const sw = g.seatWind(me);
          const c = new Array(34).fill(0);
          p.hand.forEach((t) => c[kindOf(t)]++);
          if (c[sw] === 3) {
            held++;
            if (kindOf(a.tile) === sw) {
              const sh = (k: number) => {
                c[k]--;
                const v = shanten(c, p.melds.length);
                c[k]++;
                return v;
              };
              const other = Math.min(...[...new Set(p.hand.map(kindOf))].filter((k) => k !== sw).map(sh));
              expect(sh(sw), `种子 ${seed} ${g.roundLabel()} 拆了自风暗刻`).toBeLessThan(other);
            }
          }
        }
        g.act(s, a);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(held).toBeGreaterThan(200);
  }, 120000);

  // 东一局，明华坐南家（自风南、场风东），轮到她第一次出牌。场风的第二张还没来（第 6 次摸牌来）
  const TABLE = ['izumi', 'myeonghwa', 'izumi', 'izumi'];
  function myTurn(seed: number, hand: string, prep?: (g: Game) => void): Game | null {
    const g = newGame(seed, TABLE);
    if (!until(g, TABLE, 1)) return null;
    const st = g.abilityState[1] as { roundCame?: boolean; roundAt?: number };
    st.roundCame = false;
    st.roundAt = 6;
    prep?.(g);
    return setHand(g, 1, hand) ? g : null;
  }
  // 不失误时打哪张
  const discarded = (g: Game, id: string) => {
    const a = chooseAction(g, 1, { ...byId(id).ai, mistakeRate: 0 });
    expect(a.type).toBe('discard');
    return a.type === 'discard' ? kindOf(a.tile) : -1;
  };

  it('场风的第二张还没来：单张场风当对子算，不打（一般的打法会打掉）；听的就是要来的场风时听它', () => {
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      // 23m 67m 34p 89s 55s、南南南、单张东：一般的打法多半打孤张的东；她留着东（摸来就是一对役牌），先打 89s 的边张
      const g = myTurn(seed, '2367m34p89s55s2221z');
      if (!g) continue;
      n++;
      expect(myeonghwaComing(g, 1)).toBe(EAST);
      expect(discarded(g, 'myeonghwa')).not.toBe(EAST);
      // 234m 567m 3456p、南南南、单张东：一般的打法多半打东听 3p、6p；她打 3p 或 6p 单骑东（东一定会来），立直
      const h = myTurn(seed, '234m567m3456p2221z');
      if (!h) continue;
      expect(discarded(h, 'myeonghwa')).not.toBe(EAST);
      const riichi = chooseAction(h, 1, { ...byId('myeonghwa').ai, mistakeRate: 0 });
      expect(riichi.type === 'discard' && riichi.riichi).toBe(true);
    }
    expect(n).toBeGreaterThanOrEqual(4);
    // 东已经来过了：不再当对子算
    const g = myTurn(1, '2367m34p89s55s2221z', (x) => ((x.abilityState[1] as { roundCame?: boolean }).roundCame = true))!;
    expect(myeonghwaComing(g, 1)).toBeNull();
  });

  it('南场：成对的客风会摸成第三张，听这一对和数牌的对碰（一般的打法听两面）', () => {
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      // 南一局（她坐南家，自风南就是场风），收的客风是西：55m 6m 234p 678s 西西 南南南
      const g = myTurn(seed, '56m5m234p678s33z222z', (x) => {
        x.roundWind = 1;
        const st = x.abilityState[1] as { roundCame?: boolean; guest?: number };
        st.guest = WEST;
        st.roundCame = true;
      });
      if (!g) continue;
      n++;
      expect(myeonghwaWinds(g, 1)).toEqual({ seat: SOUTH, round: null, guest: WEST });
      // 一般的打法打 5m 听 4m、7m（西西做雀头）；她打 6m 听西、5m 的对碰
      expect(discarded(g, 'izumi')).toBe(4);
      expect(discarded(g, 'myeonghwa')).toBe(5);
    }
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it('风牌多、数牌集中在万子：同样向听先打别的花色（往混一色做）', () => {
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const g = myTurn(seed, '1256789m34p11222z');
      if (!g) continue;
      n++;
      // 一般的打法拆 12m 的边张留 34p 的两面；她拆 34p
      expect(discarded(g, 'izumi')).toBeLessThan(9);
      expect(Math.floor(discarded(g, 'myeonghwa') / 9)).toBe(1);
    }
    expect(n).toBeGreaterThanOrEqual(4);
  });

  it('不唱的局门前为主：离听牌还远时庄家打的东风不碰；唱着歌就碰', () => {
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const song of [0, 1]) {
        const g = newGame(seed, TABLE);
        if (!until(g, TABLE, 0)) continue;
        const st = g.abilityState[1] as { roundCame?: boolean; song?: number };
        st.roundCame = true;
        st.song = song;
        // 她：23m 67m 1p 5p 3s 9s 东东 南南南（三向听，碰了东两向听）；庄家打东
        if (!setHand(g, 1, '23m67m15p39s11222z') || !setHand(g, 0, '19m19p19s12345677z')) continue;
        const east = g.players[0].hand.find((t) => kindOf(t) === EAST)!;
        g.act(0, g.legalActions(0).find((a) => a.type === 'discard' && !a.riichi && a.tile === east)!);
        expect(g.phase).toBe('calls');
        n++;
        expect(myeonghwaSinging(g, 1)).toBe(song);
        expect(chooseAction(g, 1, byId('izumi').ai).type).toBe('pon');
        expect(chooseAction(g, 1, byId('myeonghwa').ai).type).toBe(song ? 'pon' : 'pass');
      }
    }
    expect(n).toBeGreaterThanOrEqual(8);
  });

  it('整场打下来：没人立直时，第二张场风还没来就不打单张场风（打了以后真的更快的除外）', async () => {
    let held = 0;
    let cut = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const ids = ['izumi', 'izumi', 'izumi', 'izumi'];
      const me = seed % 4;
      ids[me] = 'myeonghwa';
      const g = newGame(seed, ids);
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 60000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        if ((g.phase as string) === 'predeal') {
          g.deal();
          continue;
        }
        const s = g.waitingSeats()[0];
        const a = chooseAction(g, s, byId(ids[s]).ai);
        const round = s === me ? myeonghwaComing(g, me) : null;
        if (round !== null && g.phase === 'turn' && a.type === 'discard' && !g.players.some((q) => q.riichi)) {
          const p = g.players[me];
          const c = new Array(34).fill(0);
          p.hand.forEach((t) => c[kindOf(t)]++);
          if (c[round] === 1) {
            held++;
            if (kindOf(a.tile) === round) {
              cut++;
              const sh = (k: number) => {
                c[k]--;
                const v = shanten(c, p.melds.length);
                c[k]++;
                return v;
              };
              const other = Math.min(...[...new Set(p.hand.map(kindOf))].filter((k) => k !== round).map(sh));
              expect(sh(round), `种子 ${seed} ${g.roundLabel()} 打了单张场风`).toBeLessThan(other);
            }
          }
        }
        g.act(s, a);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(held).toBeGreaterThan(150);
    expect(cut).toBeLessThan(held / 10);
  }, 120000);
});

describe('雀明华：整场', () => {
  it('和各种能力同桌打得完', async () => {
    const tables = [
      ['hatsumi', 'myeonghwa', 'kuro', 'awai'],
      ['teru', 'koromo', 'myeonghwa', 'kasumi'],
      ['myeonghwa', 'sawaya', 'nelly', 'shizuno'],
      ['toyone', 'satoha', 'huiyu', 'myeonghwa'],
    ];
    for (let seed = 1; seed <= 8; seed++) {
      const ids = tables[seed % tables.length];
      play(newGame(seed * 31, ids), ids);
      await new Promise((r) => setTimeout(r, 0));
    }
  }, 180000);
});

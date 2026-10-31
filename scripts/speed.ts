// 听牌速度：每个角色每局第几巡听牌（打完牌以后向听 0）、和了率、立直率；涅莉按运势分、丰音按六曜分
// 用法：npx vite-node scripts/speed.ts [场数] [east|south] [起始种子]，FORCE=角色 id 让这个角色每场都上桌
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';
import { nellyPool, nellyTier } from '../src/abilities/nelly';
import { toyoneMode } from '../src/abilities/toyone';

const games = Number(process.argv[2] ?? 300);
const format = (process.argv[3] as any) ?? 'east';
const from = Number(process.argv[4] ?? 1);
type S = { start: number; rounds: number; tenpai: number; turnSum: number; by8: number; wins: number; riichi: number };
const mk = (): S => ({ start: 0, rounds: 0, tenpai: 0, turnSum: 0, by8: 0, wins: 0, riichi: 0 });
const stats = new Map<string, S>();
const get = (k: string) => (stats.has(k) ? stats.get(k)! : (stats.set(k, mk()), stats.get(k)!));

for (let seed = from; seed < from + games; seed++) {
  // FORCE=角色 id：这个角色每场都上桌（座位随机）
  const force = process.env.FORCE ? CHARACTERS.find((c) => c.id === process.env.FORCE) : undefined;
  const order = new Rng(seed * 31).shuffle(CHARACTERS.filter((c) => c !== force)).slice(0, force ? 3 : 4);
  if (force) order.splice(seed % 4, 0, force);
  const g = new Game({ seed, format, players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  let first: (number | null)[] = [null, null, null, null];
  let start = [0, 0, 0, 0];
  let keys: string[][] = [[], [], [], []];
  const tag = () => {
    keys = order.map((c, s) => {
      const k = [c.name];
      if (c.id === 'nelly') k.push(`涅莉 押${nellyTier(g, s)} 剩${nellyPool(g, s)}`);
      return k;
    });
  };
  tag();
  let tagged = false;
  g.onEvent((e) => {
    if (e.type === 'roundStart') { first = [null, null, null, null]; tagged = false; }
    if (e.type !== 'roundEnd') return;
    for (let s = 0; s < 4; s++) {
      const ks = [...keys[s]];
      if (order[s].id === 'toyone') ks.push(`丰音 ${toyoneMode(g, s) ?? '无'}`);
      for (const k of ks) {
        const st = get(k);
        st.rounds++;
        st.start += start[s];
        if (first[s] !== null) { st.tenpai++; st.turnSum += first[s]!; if (first[s]! <= 8) st.by8++; }
        if (e.result.wins.some((w) => w.seat === s)) st.wins++;
        if (g.players[s].riichi) st.riichi++;
      }
    }
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    if (!tagged && g.phase === 'turn') { tag(); tagged = true; start = g.players.map((p) => shanten(toCounts(p.hand.length === 14 ? p.hand.slice(0, 13) : p.hand), 0)); }
    const seat = g.waitingSeats()[0];
    g.act(seat, chooseAction(g, seat, order[seat].ai));
    for (let s = 0; s < 4; s++) {
      const p = g.players[s];
      if (first[s] === null && p.hand.length % 3 === 1 && shanten(toCounts(p.hand), p.melds.length) <= 0) first[s] = p.discards.length;
    }
  }
}
const rows = [...stats.entries()].sort((a, b) => a[0].localeCompare(b[0]));
console.log('角色\t配牌向听\t局数\t听牌率\t平均听牌巡\t8巡内听牌\t和了率\t立直率');
for (const [k, s] of rows) console.log([k, (s.start / s.rounds).toFixed(2), s.rounds, (s.tenpai / s.rounds * 100).toFixed(1) + '%', (s.turnSum / Math.max(1, s.tenpai)).toFixed(2), (s.by8 / s.rounds * 100).toFixed(1) + '%', (s.wins / s.rounds * 100).toFixed(1) + '%', (s.riichi / s.rounds * 100).toFixed(1) + '%'].join('\t'));

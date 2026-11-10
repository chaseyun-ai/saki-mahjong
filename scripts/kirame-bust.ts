// 花田煌被击飞排查：她和指定的三个人同桌打很多场，记下每一次她小于 0 的那一局
// 用法：npx vite-node scripts/kirame-bust.ts [场数] [别的三个人，逗号分开] [格式] [花田煌开局点数，别人 25000]
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';

const games = Number(process.argv[2] ?? 200);
const others = (process.argv[3] ?? 'yuuki,aislinn,saki').split(',');
const format = (process.argv[4] ?? 'east') as 'east' | 'south' | 'team';
const start = Number(process.argv[5] ?? 25000);
const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 排查用：每次摸牌记下摸到的牌、摸之前谁锁着它、花田煌的规矩当时拦不拦它
const G = Game.prototype as any;
const origDraw = G.drawFor;
let lastDraw: any = null;
G.drawFor = function (seat: number, rinshan: boolean) {
  const w = this.wall;
  const next = rinshan ? w.rinshan[0] : w.live[0];
  const pre = next === undefined ? [] : w.locked.ownersOf(next);
  const bust = this.bustRules(seat, rinshan);
  origDraw.call(this, seat, rinshan);
  const p = this.players[seat];
  const t = p.drawn;
  if (t === null || t === undefined) return;
  const preLocks = t === next ? pre : ['(换过)'];
  // 摸到以后再算一遍：拦不拦（摸完牌手里已经有这张，退回去算）
  p.hand.pop();
  const ws = this.wall;
  const denied = bust.filter((r: any) => r.deny(t)).map((r: any) => r.seat);
  p.hand.push(t);
  lastDraw = { seat, rinshan, tile: t, preLocks, denied, nextBefore: next, ura: ws.uraIndicators.slice(0, ws.doraRevealed).map(kindOf), dora: ws.visibleDoraIndicators().map(kindOf) };
};
let busts = 0;
let rounds = 0;
let swaps = 0;
let caps = 0;
const causes = new Map<string, number>();
for (let n = 1; n <= games; n++) {
  // 花田煌轮流坐四个位置
  const ids = [...others];
  ids.splice(n % 4, 0, 'kirame');
  const k = ids.indexOf('kirame');
  const seats = ids.map(byId);
  const scores = ids.map((id) => (id === 'kirame' ? start : 25000));
  const g = new Game({ seed: 7000 + n, format, scores, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 40000) {
    if (g.phase === 'roundEnd') {
      rounds++;
      const r = g.roundResult!;
      if (g.players[k].score < 0) {
        busts++;
        const w = r.wins.map((w) => `${ids[w.seat]}${w.from === null ? '自摸' : `荣和(放铳:${ids[w.from]})`} ${w.result.han}番${w.result.fu}符 ${w.result.yaku.map((y) => y.name ?? y).join('/')}`).join('; ');
        const key = r.kind === 'win' ? r.wins.map((w) => `${ids[w.seat]}${w.from === null ? '自摸' : w.from === k ? '荣和煌' : '荣和别人'}`).join('+') : r.kind;
        causes.set(key, (causes.get(key) ?? 0) + 1);
        const evs = g.events.filter((e) => e.type === 'ability').slice(-6).map((e: any) => `${ids[e.seat]}:${e.ability}`).join(',');
        if (r.wins.some((w) => w.from === null)) console.log('   最后一次摸牌', JSON.stringify(lastDraw), '结算时宝牌', r.wins.map((w) => JSON.stringify({ ura: w.uraIndicators.map(kindOf), dora: g.wall.visibleDoraIndicators().map(kindOf), han: w.result.han, dora_: w.result.dora, ura_: w.result.ura, aka: w.result.aka })).join(';'));
        console.log(`#${n} 煌坐${k} ${g.roundLabel?.() ?? ''} 煌 ${g.players[k].score - r.deltas[k]} → ${g.players[k].score}  ${r.kind} ${w} deltas=${r.deltas.join('/')} 最近能力=${evs}`);
      }
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  for (const e of g.events) if (e.type === 'ability' && e.seat === k) (e as { target?: number }).target === undefined ? caps++ : swaps++;
}
console.log(`${games} 场 ${rounds} 局，煌被击飞 ${busts} 次；她换牌 ${swaps} 次，结算兜底 ${caps} 次`);
console.log(Object.fromEntries(causes));

// 龙门渊透华的治水：多少场能进治水、第几局进，治水前后每局鸣牌几次、别人自摸率多少
// 用法：npx vite-node scripts/toka.ts [场数] [east|south]
import { CHARACTERS } from '../src/abilities/characters';
import { tokaChisui } from '../src/abilities/toka';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';

const games = Number(process.argv[2] ?? 300);
const format = (process.argv[3] as 'east' | 'south') ?? 'south';
const me = CHARACTERS.find((c) => c.id === 'toka')!;
const half = () => ({ rounds: 0, calls: 0, otherTsumo: 0, otherRon: 0, mine: 0 });
const calm = half();
const plain = half();
let entered = 0;
let enterRound = 0;
let roundsTotal = 0;
for (let seed = 1; seed <= games; seed++) {
  const rng = new Rng(seed * 977);
  const others = rng.shuffle(CHARACTERS.filter((c) => c.id !== me.id)).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format, players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  let first: number | null = null;
  let calls = 0;
  g.onEvent((e) => {
    if (e.type === 'roundStart') calls = 0;
    if (e.type === 'call') calls++;
    if (e.type !== 'roundEnd') return;
    roundsTotal++;
    const on = tokaChisui(g, mine);
    if (on && first === null) first = g.round;
    const b = on ? calm : plain;
    b.rounds++;
    b.calls += calls;
    for (const w of e.result.wins) {
      if (w.seat === mine) b.mine++;
      else if (w.from === null) b.otherTsumo++;
      else b.otherRon++;
    }
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  if (first !== null) {
    entered++;
    enterRound += first;
  }
}
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
const line = (name: string, b: ReturnType<typeof half>) =>
  `${name}：${b.rounds} 局，每局鸣牌 ${(b.calls / Math.max(1, b.rounds)).toFixed(2)} 次，别人每家自摸率 ${pct(b.otherTsumo / 3, b.rounds)}、荣和率 ${pct(b.otherRon / 3, b.rounds)}，透华和了率 ${pct(b.mine, b.rounds)}`;
console.log(`${games} 场 ${format}，共 ${roundsTotal} 局。进入治水的场 ${pct(entered, games)}，平均在第 ${(enterRound / Math.max(1, entered)).toFixed(1)} 局进入`);
console.log(line('常态', plain));
console.log(line('治水', calm));

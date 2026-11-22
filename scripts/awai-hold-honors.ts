// 留字牌（AWAI.starsHold）对别家起手字牌的影响：npx vite-node scripts/awai-hold-honors.ts [场数] [对手：random|plain] [hold：0|1]
// 数每一局开局时别家 13 张配牌里有几张字牌，和她自己的；淡当成玩家的淡（能量给够），不按星符汇聚，不发字牌手
import { AWAI } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { kindOf } from '../src/engine/tiles';

const games = Number(process.argv[2] ?? 100);
const pool = process.argv[3] ?? 'random';
AWAI.starsHold = process.argv[4] === '1';
AWAI.starsDeal = 0;
AWAI.aiSkills = false;
AWAI.energyMax = 1000000;
AWAI.energyStart = [1000000, 1000000];
const me = CHARACTERS.find((c) => c.id === 'awai')!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const hist: Record<number, number> = {};
let rounds = 0, other = 0, mineH = 0, zero = 0;
for (let seed = 1; seed <= games; seed++) {
  const rng = new Rng(seed * 977);
  const others = pool === 'plain' ? [plain, plain, plain] : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'awai')).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability, manual: c === me })) });
  const count = () => {
    rounds++;
    for (let s = 0; s < 4; s++) {
      const n = g.players[s].hand.slice(0, 13).filter((t) => kindOf(t) >= 27).length;
      if (s === mine) { mineH += n; continue; }
      other += n;
      hist[n] = (hist[n] ?? 0) + 1;
      if (n === 0) zero++;
    }
  };
  g.onEvent((e) => { if (e.type === 'roundStart') count(); });
  count();
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
}
console.log(`hold ${AWAI.starsHold}，对手 ${pool}，${games} 场 ${rounds} 局：别家每人起手字牌平均 ${(other / rounds / 3).toFixed(2)} 张，一张字牌都没有的 ${((100 * zero) / rounds / 3).toFixed(1)}%；淡自己 ${(mineH / rounds).toFixed(2)} 张`);
console.log('别家起手字牌张数分布', JSON.stringify(Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, ((100 * v) / rounds / 3).toFixed(1) + '%']))));

// 薄墨初美配牌里东、北各几张对强度的影响：每场都让她上桌（另外三家随机），比较 HATSUMI.dealEach = 2 和 1
// 用法：npx vite-node scripts/hatsumi-deal.ts [场数] [east|south]
import { CHARACTERS } from '../src/abilities/characters';
import { HATSUMI } from '../src/abilities/hatsumi';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { NORTH } from '../src/engine/tiles';

const games = Number(process.argv[2] ?? 200);
const format = (process.argv[3] as 'east' | 'south') ?? 'south';
const me = CHARACTERS.find((c) => c.id === 'hatsumi')!;
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;

function run(each: number) {
  HATSUMI.dealEach = each;
  let rankSum = 0, first = 0, rounds = 0, wins = 0;
  const north = { rounds: 0, wins: 0, yakuman: 0, suushii: 0, opened: 0 };
  for (let seed = 1; seed <= games; seed++) {
    const rng = new Rng(seed * 977);
    const others = rng.shuffle(CHARACTERS.filter((c) => c.id !== me.id)).slice(0, 3);
    const order = rng.shuffle([me, ...others]);
    const mine = order.indexOf(me);
    const g = new Game({ seed, format, players: order.map((c) => ({ name: c.name, ability: c.ability })) });
    let opened = false;
    g.onEvent((e) => {
      if (e.type === 'ability' && e.seat === mine && e.text === '里鬼门') opened = true;
      if (e.type !== 'roundEnd') return;
      rounds++;
      const isNorth = g.seatWind(mine) === NORTH;
      if (isNorth) {
        north.rounds++;
        if (opened) north.opened++;
      }
      opened = false;
      for (const w of e.result.wins) {
        if (w.seat !== mine) continue;
        wins++;
        if (!isNorth) continue;
        north.wins++;
        if (w.result.yakuman > 0) north.yakuman++;
        if (w.result.yaku.some((y) => y.name.includes('四喜'))) north.suushii++;
      }
    });
    while (g.phase !== 'gameEnd') {
      if (g.phase === 'roundEnd') { g.nextRound(); continue; }
      const s = g.waitingSeats()[0];
      g.act(s, chooseAction(g, s, order[s].ai));
    }
    const rank = g.ranking().indexOf(mine);
    rankSum += rank + 1;
    if (rank === 0) first++;
  }
  console.log(`东北各 ${each} 张：${games} 场 平均顺位 ${(rankSum / games).toFixed(2)}，一位率 ${pct(first, games)}，和了率 ${pct(wins, rounds)}；北家 ${north.rounds} 局：鸣出东北 ${pct(north.opened, north.rounds)}，和了率 ${pct(north.wins, north.rounds)}，役满率 ${pct(north.yakuman, north.rounds)}（其中四喜 ${north.suushii} 次）`);
}

run(2);
run(1);

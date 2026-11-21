// 大星淡天听（双立直）的配牌里有什么：开局宝牌、赤宝牌，字牌的刻子和对子：
// npx vite-node scripts/awai-deal.ts [场数] [对手：random|plain|a,b,c] [版本：new|classic] [起始种子]
// 只数天听的局（字牌手的局另外数个数）。配牌是开局发的 13 张（庄家的第 14 张算第一张摸牌，不在里面）
import { awaiKanUraHit } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { doraFromIndicator, isRed, kindLabel, kindOf, toCounts } from '../src/engine/tiles';

const games = Number(process.argv[2] ?? 100);
const pool = process.argv[3] ?? 'random';
const classic = process.argv[4] === 'classic';
const from = Number(process.argv[5] ?? 1);
const me = CHARACTERS.find((c) => c.id === 'awai')!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const S = {
  rounds: 0, deals: 0, broken: 0, tenpai: 0, stars: 0,
  dora: 0, doraTiles: 0, red: 0, redTiles: 0, either: 0,
  trip: 0, tripValue: 0, pair: 0, pairValue: 0, both: 0, anyHonor: 0, honorTiles: 0,
  wins: 0, winDora: 0, winAka: 0, winUra: 0, winWithDora: 0, combo: 0, comboDora: 0,
};
const tripKinds: Record<string, number> = {};
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const others = pool === 'plain' ? [plain, plain, plain] : pool.includes(',') ? pool.split(',').map((x) => CHARACTERS.find((c) => c.id === x)!) : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'awai')).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability, startForm: c === me && classic })) });
  let tenpaiRound = false;
  // 天听的配牌发下来了（别人的能力可能又把它换掉：还听着牌的才算双立直的配牌）
  const dealt = () => {
    tenpaiRound = true;
    S.deals++;
    const hand = g.players[mine].hand.slice(0, 13);
    const c = toCounts(hand);
    if (shanten(c) > 0) { S.broken++; return; }
    S.tenpai++;
    const dora = doraFromIndicator(kindOf(g.wall.doraIndicators[0]));
    const reds = hand.filter(isRed).length;
    if (c[dora] > 0) { S.dora++; S.doraTiles += c[dora]; }
    if (reds > 0) { S.red++; S.redTiles += reds; }
    if (c[dora] > 0 || reds > 0) S.either++;
    const value = (k: number) => k >= 31 || k === g.seatWind(mine) || k === 27 + g.roundWind;
    const honors = [27, 28, 29, 30, 31, 32, 33];
    const trips = honors.filter((k) => c[k] >= 3);
    const pairs = honors.filter((k) => c[k] === 2);
    if (trips.length) { S.trip++; if (trips.some(value)) S.tripValue++; for (const k of trips) tripKinds[kindLabel(k)] = (tripKinds[kindLabel(k)] ?? 0) + 1; }
    if (pairs.length) { S.pair++; if (pairs.some(value)) S.pairValue++; }
    if (trips.length && pairs.length) S.both++;
    const n = honors.reduce((x, k) => x + c[k], 0);
    if (n > 0) S.anyHonor++;
    S.honorTiles += n;
    if (process.env.ODD && (c[dora] > 0 || reds > 0 || (process.env.ODD === '2' && trips.length && pairs.length))) {
      console.log(`  种子 ${seed} ${g.roundLabel()} 对手 ${others.map((x) => x.id).join()}：${[...hand].sort((a, b) => a - b).map((t) => kindLabel(kindOf(t)) + (isRed(t) ? '赤' : '')).join(' ')}｜宝牌 ${kindLabel(dora)}`);
    }
  };
  g.onEvent((e) => {
    if (e.type === 'roundStart') { S.rounds++; tenpaiRound = false; return; }
    if (e.type === 'ability' && e.seat === mine && e.ability === 'awai' && e.text === '字牌手') S.stars++;
    if (e.type === 'ability' && e.seat === mine && e.ability === 'awai' && e.text === '天听') return dealt();
    if (e.type !== 'roundEnd' || !tenpaiRound) return;
    const w = e.result.wins.find((x) => x.seat === mine);
    if (!w) return;
    const r = w.result;
    S.wins++;
    S.winDora += r.dora;
    S.winAka += r.aka;
    S.winUra += r.ura;
    if (r.dora + r.aka > 0) S.winWithDora++;
    if (awaiKanUraHit(g, mine)) { S.combo++; if (r.dora + r.aka > 0) S.comboDora++; }
  });
  // 第一局在 new Game 里就发完了，上面的监听收不到
  S.rounds++;
  if (me.ability?.noTenhou?.(g, mine)) dealt();
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
}
const pc = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
console.log(`${classic ? '初版' : '重做版'}，对手 ${pool}，${games} 场 ${S.rounds} 局：发了天听配牌 ${S.deals} 局，被别人的能力换得不听了 ${S.broken} 局，剩下 ${S.tenpai} 局是双立直的配牌；字牌手 ${S.stars} 局`);
console.log(`配牌里有开局宝牌 ${S.dora} 局（${pc(S.dora, S.tenpai)}，共 ${S.doraTiles} 张）；有赤宝牌 ${S.red} 局（${pc(S.red, S.tenpai)}，共 ${S.redTiles} 张）；两样有一样 ${S.either} 局（${pc(S.either, S.tenpai)}）`);
console.log(`配牌里有字牌 ${S.anyHonor} 局（${pc(S.anyHonor, S.tenpai)}），平均 ${(S.honorTiles / Math.max(1, S.tenpai)).toFixed(2)} 张`);
console.log(`字牌刻子 ${S.trip} 局（${pc(S.trip, S.tenpai)}，其中役牌 ${S.tripValue}）；字牌对子 ${S.pair} 局（${pc(S.pair, S.tenpai)}，其中役牌 ${S.pairValue}）；刻子对子都有 ${S.both} 局（${pc(S.both, S.tenpai)}）`);
console.log('字牌刻子是哪几种', JSON.stringify(tripKinds));
console.log(`天听的局她和了 ${S.wins} 次：和牌里有宝牌或赤宝牌的 ${S.winWithDora} 次（${pc(S.winWithDora, S.wins)}），平均宝牌 ${(S.winDora / Math.max(1, S.wins)).toFixed(2)} 赤 ${(S.winAka / Math.max(1, S.wins)).toFixed(2)} 里 ${(S.winUra / Math.max(1, S.wins)).toFixed(2)}；其中连招 ${S.combo} 次，有宝牌或赤宝牌的 ${S.comboDora} 次`);

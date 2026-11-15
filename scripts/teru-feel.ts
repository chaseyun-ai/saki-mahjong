// 宫永照的“手感”统计：每场她都上桌，南风战，座位随机。每一局输出一行记录（连和到第几次、结果、打点、第几巡、压制次数、别人立直几次……）。
// 用法：npx vite-node scripts/teru-feel.ts [场数] [对手：random|plain|三个角色 id 用逗号隔开] [起始种子] > out.json
// 环境变量：TERU_JSON 临时改 TERU 的参数（比如 {"build":false}）；WHO=izumi 把照换成别人当对照组
// 输出 { rows: 每一局一条, games: 每一场一条 }，多个进程分段跑完把 rows、games 拼起来再统计
import { CHARACTERS } from '../src/abilities/characters';
import { TERU, teruLadder, teruWinValue } from '../src/abilities/teru';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

if (process.env.TERU_JSON) Object.assign(TERU, JSON.parse(process.env.TERU_JSON));
const games = Number(process.argv[2] ?? 50);
const pool = process.argv[3] ?? 'random';
const from = Number(process.argv[4] ?? 1);
const who = process.env.WHO ?? 'teru';
const me = CHARACTERS.find((c) => c.id === who)!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const rows: unknown[] = [];
const gamesOut: unknown[] = [];
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const others = pool === 'plain' ? [plain, plain, plain] : pool.includes(',') ? pool.split(',').map(byId) : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'teru')).slice(0, 3);
  const order = rng.shuffle([CHARACTERS.find((c) => c.id === 'teru')!, ...others]).map((c) => (c.id === 'teru' ? me : c));
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  let round = 1, myDiscards = 0, press = 0, passes = 0, oppRiichi = 0, myRiichiTurn = 0, myTenpaiTurn = 0;
  let dealSh = shanten(toCounts(g.players[mine].hand));
  const reset = () => { myDiscards = 0; press = 0; passes = 0; oppRiichi = 0; myRiichiTurn = 0; myTenpaiTurn = 0; };
  g.onEvent((e) => {
    if (e.type === 'roundStart') { round++; reset(); dealSh = shanten(toCounts(g.players[mine].hand)); }
    if (e.type === 'discard') {
      if (e.seat === mine) {
        myDiscards++;
        if (e.riichi) myRiichiTurn = myDiscards;
        if (!myTenpaiTurn && shanten(toCounts(g.players[mine].hand), g.players[mine].melds.length) === 0) myTenpaiTurn = myDiscards;
      } else if (e.riichi) oppRiichi++;
    }
    if (e.type === 'ability' && e.seat === mine && e.text === '压制') press++;
    if (e.type !== 'roundEnd') return;
    const r = e.result;
    if (r.kind === 'abortive') return;
    const win = r.wins.find((w) => w.seat === mine);
    const lad = who === 'teru' ? teruLadder(g, mine) : { level: 0, last: 0, kiki: 0 };
    const row: Record<string, unknown> = { seed, round, L: lad.level, last: lad.last, kiki: lad.kiki, dealer: g.dealer === mine ? 1 : 0, press, passes, oppRiichi, dealSh, tenpaiTurn: myTenpaiTurn, riichiTurn: myRiichiTurn,
      oppTenpai: r.tenpai ? r.tenpai.filter((t: boolean, s: number) => t && s !== mine).length : -1, myTenpai: r.tenpai ? (r.tenpai[mine] ? 1 : 0) : -1,
      oppOpen: g.players.filter((x, s) => s !== mine && x.melds.some((m) => m.type !== 'ankan')).length, wallLeft: g.wall.remaining };
    if (win) {
      const tsumo = win.from === null;
      const value = teruWinValue(win.result, tsumo, g.dealer === mine);
      Object.assign(row, { res: tsumo ? 'T' : 'R', value, norm: value / (g.dealer === mine ? 1.5 : 1), turn: Math.max(1, myDiscards + (tsumo ? 1 : 0)), riichi: g.players[mine].riichi ? 1 : 0, open: win.melds.some((m) => m.type !== 'ankan') ? 1 : 0,
        han: win.result.han, fu: win.result.fu, dora: win.result.dora + win.result.aka + win.result.ura, yaku: win.result.yaku.map((y) => y.name) });
    } else if (r.kind === 'win') {
      const w = r.wins[0];
      Object.assign(row, { res: 'O', dealIn: r.wins.some((x) => x.from === mine) ? 1 : 0, oTsumo: w.from === null ? 1 : 0, oDelta: r.deltas[w.seat], oId: order[w.seat].id, oRiichi: g.players[w.seat].riichi ? 1 : 0, myRiichi: g.players[mine].riichi ? 1 : 0, myMelds: g.players[mine].melds.length, turn: myDiscards, oDora: w.result.dora + w.result.aka + w.result.ura });
    } else Object.assign(row, { res: 'D', turn: myDiscards });
    rows.push(row);
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    const a = chooseAction(g, s, order[s].ai);
    if (s === mine && a.type !== 'tsumo' && a.type !== 'ron' && g.legalActions(s).some((x) => x.type === 'tsumo' || x.type === 'ron')) passes++;
    g.act(s, a);
  }
  gamesOut.push({ seed, rank: g.ranking().indexOf(mine) + 1, score: g.players[mine].score, rounds: round, opp: order.filter((c) => c !== me).map((c) => c.id), bust: g.players.some((x) => x.score < 0) ? 1 : 0 });
}
console.log(JSON.stringify({ rows, games: gamesOut }));

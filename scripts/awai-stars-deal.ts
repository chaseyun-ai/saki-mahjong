// 从天听的配牌（不是字牌手）按星符汇聚，做成大七星的有几成，按配牌里的字牌分组：
// npx vite-node scripts/awai-stars-deal.ts [场数] [对手：random|plain|a,b,c] [starsFate，默认用现在的；1 是不掷] [起始种子]
// 她当成玩家的淡，不发字牌手，能量给够，每一局第一次轮到自己就按星符汇聚，别的主动技能不按。
// 配牌是开局发的 13 张；天听的配牌里字牌只会是那个暗刻、那个对子
import { AWAI, awaiCanUse } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';

const games = Number(process.argv[2] ?? 100);
const pool = process.argv[3] ?? 'random';
if (process.argv[4] !== undefined && process.argv[4] !== '-') AWAI.starsFate = Number(process.argv[4]);
const from = Number(process.argv[5] ?? 1);
AWAI.starsDeal = 0;
AWAI.aiSkills = false;
AWAI.energyMax = 1000000;
AWAI.energyStart = [1000000, 1000000];
const me = CHARACTERS.find((c) => c.id === 'awai')!;
const plain = CHARACTERS.find((c) => c.id === 'izumi')!;
type Row = { n: number; yakuman: number; small: number; other: number; dealIn: number; draw: number; turns: number[]; got: number[] };
const rows: Record<string, Row> = {};
const row = (k: string) => (rows[k] ??= { n: 0, yakuman: 0, small: 0, other: 0, dealIn: 0, draw: 0, turns: [], got: [] });
const honorsIn = (hand: number[]) => hand.filter((t) => kindOf(t) >= 27).length;
// 大七星凑到几张了（每种字牌最多算两张）
const have = (hand: number[]) => {
  const c = toCounts(hand);
  let n = 0;
  for (let k = 27; k < 34; k++) n += Math.min(2, c[k]);
  return n;
};
let rounds = 0;
let skipped = 0;
for (let seed = from; seed < from + games; seed++) {
  const rng = new Rng(seed * 977);
  const others = pool === 'plain' ? [plain, plain, plain] : pool.includes(',') ? pool.split(',').map((x) => CHARACTERS.find((c) => c.id === x)!) : rng.shuffle(CHARACTERS.filter((c) => c.id !== 'awai')).slice(0, 3);
  const order = rng.shuffle([me, ...others]);
  const mine = order.indexOf(me);
  const g = new Game({ seed, format: 'south', players: order.map((c) => ({ name: c.name, ability: c.ability, manual: c === me })) });
  let group: string | null = null; // 这一局配牌算哪一组（没按、配牌被别人换得不听了是 null）
  let pressed = false;
  let fresh = true; // 这一局的配牌还没看
  const classify = (): string | null => {
    const hand = g.players[mine].hand;
    const dealt = hand.length > 13 ? hand.slice(0, 13) : hand;
    const c = toCounts(dealt);
    if (!me.ability?.noTenhou?.(g, mine) || shanten(c) > 0) return null;
    const hs = [27, 28, 29, 30, 31, 32, 33];
    const trip = hs.some((k) => c[k] >= 3);
    const pair = hs.some((k) => c[k] === 2);
    if (honorsIn(dealt) === 0) return '没有字牌';
    if (trip && pair) return '字牌刻子＋字牌对子';
    if (trip) return '只有字牌刻子';
    if (pair) return '只有字牌对子';
    return '别的';
  };
  g.onEvent((e) => {
    if (e.type === 'roundStart') { fresh = true; pressed = false; group = null; return; }
    if (e.type !== 'roundEnd') return;
    rounds++;
    if (!pressed || group === null) { skipped++; return; }
    const r = row(group);
    r.n++;
    r.got.push(have(g.players[mine].hand));
    const w = e.result.wins.find((x) => x.seat === mine);
    if (w?.result.yakuman) { r.yakuman++; r.turns.push(g.players[mine].discards.length + 1); }
    else if (w) r.small++;
    else if (e.result.kind === 'win') { r.other++; if (e.result.wins.some((x) => x.from === mine)) r.dealIn++; }
    else r.draw++;
  });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 100000) {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    if (s === mine && !pressed && g.phase === 'turn' && g.turn === mine && g.players[mine].discards.length === 0) {
      if (fresh) { group = classify(); fresh = false; }
      if (group !== null && awaiCanUse(g, mine, 'stars')) {
        g.abilities[mine]!.pressSkill!(g, mine, 'stars');
        pressed = true;
      }
    }
    g.act(s, chooseAction(g, s, order[s].ai));
  }
}
const pc = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
console.log(`starsFate ${AWAI.starsFate}，对手 ${pool}，${games} 场 ${rounds} 局（没按或配牌不听的 ${skipped} 局）`);
for (const k of ['没有字牌', '只有字牌对子', '只有字牌刻子', '字牌刻子＋字牌对子', '别的']) {
  const r = rows[k];
  if (!r) continue;
  console.log(`${k}：${r.n} 局，大七星 ${r.yakuman}（${pc(r.yakuman, r.n)}，平均第 ${avg(r.turns)} 巡）；别的和了 ${pc(r.small, r.n)}；别人先和 ${pc(r.other, r.n)}（她放铳 ${pc(r.dealIn, r.n)}）；流局 ${pc(r.draw, r.n)}；结束时大七星凑到平均 ${avg(r.got)} 张`);
}

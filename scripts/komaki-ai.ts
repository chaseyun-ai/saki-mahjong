// 电脑的神代小莳会不会用附身的神：每位神各打若干场（同桌三个 2 费以下的对手，她整场睡着、神不换），
// 数她的和了、放铳、立直、鸣牌、开杠，还有每位神“该做没做”的事。
// 用法：npx vite-node scripts/komaki-ai.ts [每位神几场] [只看哪位神]
// 输出每位神一行 JSON：
//   rounds 局数，rank 平均顺位，ev 每局平均得失点，win 和了率，tsumo 自摸占和了的几成，dealIn 放铳率，pts 平均打点，riichi 每局立直率，open 每局鸣牌率，kans 每局开杠数
//   skipKan 能杠没杠的次数，brokeTrip 拆暗刻的次数，lockedKan 立直以后摸到第四张却杠不了的次数（木花咲耶姬）
//   dama 门清听牌没立直的次数，opened 鸣了牌（立不了直）的局数（建御雷神、琼琼杵尊）
//   noYaku 流局时听牌却没役的局数（须佐之男碰了没役的牌）
//   offSuit 打出主花色、手里却还留着别的花色数牌的次数，flush 和了里染手占几成（稻荷神）
import { CHARACTERS } from '../src/abilities/characters';
import { KOMAKI_GODS, komakiGod, type GodId } from '../src/abilities/komaki';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { isHonor, kindOf, suitOf, toCounts } from '../src/engine/tiles';

const per = Number(process.argv[2] ?? 40);
const only = process.argv[3] as GodId | undefined;
const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const IDS = (process.env.KOMAKI_TABLE ?? 'komaki,mako,ako,izumi').split(',');
const ME = IDS.indexOf('komaki');

function seedsFor(god: GodId, n: number): number[] {
  const out: number[] = [];
  for (let seed = 1; out.length < n && seed < 20000; seed++) {
    const g = new Game({ seed, format: 'south', players: IDS.map((id) => ({ name: id, ability: byId(id).ability })) });
    if (komakiGod(g, ME, 1) === god) out.push(seed);
  }
  return out;
}

for (const { id: god } of KOMAKI_GODS) {
  if (god === 'uzume' || (only && only !== god)) continue;
  const s = { rounds: 0, wins: 0, tsumo: 0, dealIns: 0, pts: 0, riichi: 0, open: 0, kans: 0, skipKan: 0, brokeTrip: 0, lockedKan: 0, dama: 0, opened: 0, noYaku: 0, offSuit: 0, flush: 0, rinshan: 0, ippatsu: 0, tenpaiDraw: 0, draws: 0, delta: 0, games: 0, rank: 0, abort: 0 };
  for (const seed of seedsFor(god, per)) {
    const g = new Game({ seed, format: 'south', players: IDS.map((id) => ({ name: id, ability: byId(id).ability })) });
    let riichied = false;
    let called = false;
    g.onEvent((e) => {
      if (e.type === 'roundStart') {
        riichied = false;
        called = false;
      }
      if (e.type === 'discard' && e.seat === ME && e.riichi) riichied = true;
      if (e.type === 'call' && e.seat === ME) {
        if (e.call.includes('杠')) s.kans++;
        if (!e.call.includes('暗杠')) called = true;
      }
      if (e.type !== 'roundEnd') return;
      s.rounds++;
      s.delta += e.result.deltas[ME];
      if (e.result.kind === 'abortive') s.abort++;
      if (riichied) s.riichi++;
      if (called) s.open++;
      const p = g.players[ME];
      for (const w of e.result.wins) {
        if (w.seat === ME) {
          s.wins++;
          if (w.from === null) s.tsumo++;
          s.pts += e.result.deltas[ME];
          if (w.result.yaku.some((y) => /混一色|清一色/.test(y.name))) s.flush++;
          if (w.result.yaku.some((y) => /岭上/.test(y.name))) s.rinshan++;
          if (w.result.yaku.some((y) => /一发/.test(y.name))) s.ippatsu++;
        }
        if (w.from === ME) s.dealIns++;
      }
      if (e.result.kind === 'exhaustive') {
        s.draws++;
        if (e.result.tenpai[ME]) {
          s.tenpaiDraw++;
          const waits = g.waits(ME);
          if (!waits.some((k) => g.winResult(ME, k * 4 + 1, false, false))) s.noYaku++;
        }
      }
      void p;
    });
    let steps = 0;
    while (g.phase !== 'gameEnd' && ++steps < 100000) {
      if (g.phase === 'roundEnd') {
        g.nextRound();
        continue;
      }
      const seat = g.waitingSeats()[0];
      const legal = g.legalActions(seat);
      const a = chooseAction(g, seat, byId(IDS[seat]).ai);
      if (seat === ME && komakiGod(g, ME) === god) {
        const p = g.players[ME];
        const counts = toCounts(p.hand);
        const kan = legal.some((x) => x.type === 'ankan' || x.type === 'kakan' || x.type === 'daiminkan');
        if (kan && !a.type.endsWith('kan') && a.type !== 'tsumo' && a.type !== 'ron') s.skipKan++;
        if (a.type === 'discard' && counts[kindOf(a.tile)] >= 3) s.brokeTrip++;
        if (g.phase === 'turn' && p.riichi && p.drawn !== null && counts[kindOf(p.drawn)] === 4 && !legal.some((x) => x.type === 'ankan')) s.lockedKan++;
        if (a.type === 'discard' && !a.riichi && !p.riichi && legal.some((x) => x.type === 'discard' && x.riichi) && shanten(toCounts(p.hand.filter((t) => t !== a.tile)), p.melds.length) === 0) s.dama++;
        if ((a.type === 'pon' || a.type === 'chi' || a.type === 'daiminkan') && p.melds.every((m) => m.type === 'ankan')) s.opened++;
        if (a.type === 'discard' && !isHonor(kindOf(a.tile))) {
          const n = [0, 0, 0];
          for (const t of p.hand) if (!isHonor(kindOf(t))) n[suitOf(kindOf(t))]++;
          const main = n.indexOf(Math.max(...n));
          if (suitOf(kindOf(a.tile)) === main && n.some((x, i) => i !== main && x > 0)) s.offSuit++;
        }
      }
      g.act(seat, a);
    }
    s.games++;
    s.rank += g.ranking().indexOf(ME) + 1;
  }
  const r = (x: number, d = s.rounds) => (d ? Math.round((x / d) * 1000) / 1000 : 0);
  console.log(
    JSON.stringify({
      god,
      rounds: s.rounds,
      rank: r(s.rank, s.games),
      ev: Math.round(s.delta / Math.max(1, s.rounds)),
      win: r(s.wins),
      tsumo: r(s.tsumo, s.wins),
      dealIn: r(s.dealIns),
      pts: s.wins ? Math.round(s.pts / s.wins) : 0,
      riichi: r(s.riichi),
      open: r(s.open),
      kans: r(s.kans),
      rinshan: r(s.rinshan, s.wins),
      ippatsu: r(s.ippatsu, s.wins),
      flush: r(s.flush, s.wins),
      skipKan: s.skipKan,
      brokeTrip: s.brokeTrip,
      lockedKan: s.lockedKan,
      dama: s.dama,
      opened: s.opened,
      noYaku: s.noYaku,
      tenpaiDraw: s.tenpaiDraw,
      draws: s.draws,
      abort: s.abort,
      offSuit: s.offSuit,
    }),
  );
}

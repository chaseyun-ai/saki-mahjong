// 决赛大将战：淡、涅莉、稳乃、咲同桌，随机座位打半庄，统计顺位、和了、能力互动
// 用法：npx vite-node scripts/final.ts [场数] [开局点数]
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { nellyTier } from '../src/abilities/nelly';

const games = Number(process.argv[2] ?? 500);
const start = Number(process.argv[3] ?? 25000); // 团体赛大将上场按 100000 算
const ids = ['awai', 'nelly', 'shizuno', 'saki'];
const chars = ids.map((id) => CHARACTERS.find((c) => c.id === id)!);
const mk = () => ({ rank: 0, first: 0, last: 0, wins: 0, tsumo: 0, pts: 0, dealIns: 0, score: 0, rounds: 0, ranks: [0, 0, 0, 0], ura: 0, yakuman: 0, sanbai: 0 });
const S: Record<string, ReturnType<typeof mk>> = Object.fromEntries(ids.map((id) => [id, mk()]));
const ev: Record<string, Map<string, number>> = Object.fromEntries(ids.map((id) => [id, new Map()]));
const X = { dr: 0, drWin: 0, drUra: 0, drUraN: 0, drKan: 0, drKanWin: 0, kanUra4: 0, kanUraSum: 0, kanUraN: 0, awaiStolenByMinkan: 0, sakiRinshan: 0, sakiBand: 0, sakiAbsDev: 0, sakiTop: 0, mistGames: 0, nellyBetRounds: 0, nellyBetWins: 0, uraOthersRiichi: 0, uraOthersN: 0, bet: [0, 0, 0, 0], betWin: [0, 0, 0, 0], betPts: [0, 0, 0, 0], tobi: 0, rounds: 0, draws: 0, gameRounds: 0, awaiTenpaiDeal: 0 };
const t0 = Date.now();
for (let seed = 1; seed <= games; seed++) {
  const rng = new Rng(seed * 7919 + 13);
  const order = rng.shuffle([...chars]);
  const seatOf = (id: string) => order.findIndex((c) => c.id === id);
  const aw = seatOf('awai'), ne = seatOf('nelly'), sh = seatOf('shizuno'), sk = seatOf('saki');
  const g = new Game({ seed: seed * 31 + 7, format: 'south', startScore: start, players: order.map((c) => ({ name: c.name, ability: c.ability })) });
  let firstDiscard = new Set<number>(); let awaiDR = false; let awaiKanUra = false; let nellyBet = false; let mist = false; let betTier = 0;
  g.onEvent((e: any) => {
    if (e.type === 'discard' && firstDiscard.size === 0) { const t = nellyTier(g, ne); if (t > 0) { nellyBet = true; X.bet[t]++; betTier = t; } }
    if (e.type === 'roundStart') { betTier = 0; firstDiscard = new Set(); awaiDR = false; awaiKanUra = false; nellyBet = false; }
    if (e.type === 'discard') {
      if (e.seat === aw && !firstDiscard.has(aw) && e.riichi) { awaiDR = true; X.dr++; }
      firstDiscard.add(e.seat);
    }
    if (e.type === 'call' && e.call === '杠' && e.seat !== aw && g.lastDiscard?.seat === aw) X.awaiStolenByMinkan++;
    if (e.type === 'ability') {
      const id = order[e.seat].id; const m = ev[id]; m.set(e.text, (m.get(e.text) ?? 0) + 1);
      if (id === 'awai' && e.text === '杠里') { awaiKanUra = true; X.drKan++; }
      if (id === 'awai' && e.text === '天听') X.awaiTenpaiDeal++;
      if (id === 'shizuno' && e.text === '深山') mist = true;
    }
    if (e.type !== 'roundEnd') return;
    X.rounds++; if (e.result.kind !== 'win') X.draws++;
    if (nellyBet) X.nellyBetRounds++;
    for (let s = 0; s < 4; s++) S[order[s].id].rounds++;
    for (const w of e.result.wins) {
      const id = order[w.seat].id; const st = S[id];
      st.wins++; if (w.from === null) st.tsumo++; st.pts += w.result.ron || 0; st.ura += w.result.ura;
      if (w.result.yakuman) st.yakuman++; else if (w.result.han >= 11) st.sanbai++;
      if (w.from !== null) S[order[w.from].id].dealIns++;
      if (w.seat === aw && awaiDR) { X.drWin++; X.drUra += w.result.ura; X.drUraN++; if (awaiKanUra) { X.drKanWin++; X.kanUraSum += w.result.ura; X.kanUraN++; if (w.result.ura >= 4) X.kanUra4++; } }
      if (w.seat === sk && w.result.yaku.some((y: any) => y.name === '岭上开花')) X.sakiRinshan++;
      if (w.seat === ne && nellyBet) { X.nellyBetWins++; X.betWin[betTier]++; X.betPts[betTier] += e.result.deltas[ne]; }
      if (w.seat !== aw && w.result.yaku.some((y: any) => y.name.includes('立直'))) { X.uraOthersRiichi += w.result.ura; X.uraOthersN++; }
    }
    // 打点：用这一局的得分变化（含本场、供托）
    for (const w of e.result.wins) S[order[w.seat].id].pts += e.result.deltas[w.seat] - (w.result.ron || 0);
  });
  while (g.phase !== 'gameEnd') {
    if (g.phase === 'roundEnd') { g.nextRound(); continue; }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
  if (mist) X.mistGames++;
  if (g.players.some((p) => p.score < 0)) X.tobi++;
  const rk = g.ranking();
  rk.forEach((seat, i) => { const st = S[order[seat].id]; st.rank += i + 1; st.ranks[i]++; if (i === 0) st.first++; if (i === 3) st.last++; st.score += g.players[seat].score; });
  const sc = g.players[sk].score; X.sakiAbsDev += Math.abs(sc - 30000); if (Math.abs(sc - 30000) <= 500) X.sakiBand++;
}
const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;
console.log(`${games} 场半庄，${X.rounds} 局（流局 ${pct(X.draws, X.rounds)}），${Math.round((Date.now() - t0) / 1000)} 秒`);
for (const c of chars) {
  const s = S[c.id];
  console.log(`${c.name.padEnd(8)} 顺位 ${(s.rank / games).toFixed(2)} | 一位 ${pct(s.first, games)} 二 ${pct(s.ranks[1], games)} 三 ${pct(s.ranks[2], games)} 四 ${pct(s.last, games)} | 终局均分 ${Math.round(s.score / games)} | 和了率 ${pct(s.wins, s.rounds)} 自摸占 ${pct(s.tsumo, s.wins)} | 平均打点 ${Math.round(s.pts / Math.max(1, s.wins))} | 放铳 ${pct(s.dealIns, s.rounds)} | 三倍满 ${s.sanbai} 役满 ${s.yakuman}`);
}
console.log(`淡：天听 ${X.awaiTenpaiDeal} 局，双立直 ${X.dr} 次（${pct(X.dr, X.rounds)} 的局），双立直后和 ${X.drWin}（${pct(X.drWin, X.dr)}），平均里宝 ${(X.drUra / Math.max(1, X.drUraN)).toFixed(2)}；杠里 ${X.drKan} 次，杠里后和 ${X.drKanWin}（${pct(X.drKanWin, X.drKan)}），杠里和牌平均里宝 ${(X.kanUraSum / Math.max(1, X.kanUraN)).toFixed(2)}，中满 4 张以上 ${X.kanUra4}；别人大明杠淡的牌 ${X.awaiStolenByMinkan}`);
console.log(`别家立直和牌平均里宝 ${(X.uraOthersRiichi / Math.max(1, X.uraOthersN)).toFixed(2)}（${X.uraOthersN} 次）`);
console.log(`被击飞结束 ${pct(X.tobi, games)}，平均每场 ${(X.rounds / games).toFixed(1)} 局`);
console.log(`涅莉押注：` + [1, 2, 3].map((t) => `${t} 点 ${X.bet[t]} 局 和 ${pct(X.betWin[t], X.bet[t])} 均得 ${Math.round(X.betPts[t] / Math.max(1, X.betWin[t]))}`).join('；'));
console.log(`稳乃：起雾（满 6 标记）的半庄 ${pct(X.mistGames, games)}`);
console.log(`咲：岭上开花 ${X.sakiRinshan} 次（占她和了 ${pct(X.sakiRinshan, S.saki.wins)}），终局在 29500–30500 ${X.sakiBand} 场（${pct(X.sakiBand, games)}），平均离 30000 ${Math.round(X.sakiAbsDev / games)}`);
console.log(`涅莉：押运势 ${X.nellyBetRounds} 局，其中和了 ${X.nellyBetWins}（${pct(X.nellyBetWins, X.nellyBetRounds)}）`);
for (const c of chars) console.log(`${c.name} 能力事件`, Object.fromEntries(ev[c.id]));

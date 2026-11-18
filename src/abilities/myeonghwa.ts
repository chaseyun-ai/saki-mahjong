import type { Game, RoundResult } from '../engine/game';
import { EAST, NORTH, TileId, kindOf } from '../engine/tiles';
import { luckyDeal, luckyDraw } from './luck';
import { PRIORITY, type Ability, type PreDealOption } from './types';

// 雀明华（临海女子）：风神。欧洲联赛排名第一，风牌往她那里聚，唱起歌来牌越来越好。照决赛的全力版做。
// - 风（被动）：每一局配牌里必定有自风暗刻（一番到手），外加一张场风；场风的第二张开局几巡之内一定摸到，凑成一对。
//   自风就是场风的局（东场坐庄、南场坐南家）只有那一副暗刻，是双风（两番）。
//   南场多收一种客风：配牌再带一对，场风、这种客风在手里成对时有机会摸成暗刻。
//   第四种风不给（原作里说她南场收四风，但实际很少收到第四种），只能自己摸到
// - 歌（一场两次，发牌前开嗓）：唱着的局配牌、进张更顺。她每和一局，歌升一段（最多三段），越唱越顺；
//   别人和牌，歌就停了。流局不升也不停。第二次要进了南场、歌停着才能开（原作：中场休息在大厅再唱一次带进后半场）。
//   原作里全国大赛只许她在局与局之间唱；决赛前半场她唱起来连和到南三局三本场，被憧和久联手截断
// - 断风（发牌前选一家，不限次数）：这一局那一家配牌里没有风牌，摸牌也摸不到（岭上牌除外）。
//   代价是她分出了精力，这一局歌不起作用；自己的风牌照收（原作：决赛后半场每一局都对尧深用，只和了一次满贯）。
//   没了风牌的人手牌反而更快，所以只对靠风牌吃饭的人（初美）划算。原作只写了配牌，摸不到是为了对初美有用加的
// 电脑的明华：坐庄的局、东四局、进了南场开嗓，歌停了进了南场再开一次；唱着时不退向听就鸣（进攻），
// 不唱时门前为主（一向听以内才鸣）；初美坐北家的局对她断风。
// 打牌照她的风算（src/ai/ai.ts 的「雀明华」一节）：单张场风当对子、南场的风对子会长成暗刻、风牌多就做混一色
export const MYEONGHWA = {
  seatWind: 3, // 配牌里自风几张
  roundWind: 1, // 配牌里场风几张（自风就是场风时不另算）
  roundPair: 2, // 场风一共摸到几张（配牌里的也算）
  roundWithin: 6, // 场风的第二张：开局第几次摸牌之内来（哪一次随机）
  guestWind: 2, // 南场：配牌里客风几张（只收一种客风）
  windDraw: 0.15, // 南场：场风、收的那种客风在手里成对时，每次摸牌换成第三张的概率
  songs: 2, // 一场能开嗓几次（第二次要进了南场）
  songMax: 3, // 歌最多几段
  songDeal: [0, 0.03, 0.06, 0.09], // 唱到第几段时，配牌每一轮改良的概率
  songDraw: [0, 0.03, 0.06, 0.09], // 唱到第几段时，摸牌换成有效进张的概率
};

interface MyeonghwaGameState {
  song?: number; // 现在唱到第几段（0、没写是没在唱）
  songs?: number; // 这一场开过几次嗓
  wantSong?: boolean; // 玩家发牌前选了开嗓
  wantCut?: number | null; // 玩家发牌前选了对哪一家断风
}
interface MyeonghwaState {
  winds?: boolean; // 这一局有风牌的加护
  guest?: number; // 这一局收的客风（南场才有）
  song?: number; // 这一局歌唱到第几段（断风的局是 0）
  first?: boolean; // 这一局刚开嗓
  second?: boolean; // 这一次是一场里的第二次开嗓
  cut?: number; // 这一局对哪一家断风
  draws?: number; // 这一局摸了几次
  roundAt?: number; // 场风的第二张第几次摸牌来
  roundCame?: boolean; // 已经来了
}

const gameStateOf = (g: Game, seat: number) => g.abilityGameState[seat] as MyeonghwaGameState;
const stateOf = (g: Game, seat: number) => g.abilityState[seat] as MyeonghwaState;
const isWindTile = (t: TileId) => kindOf(t) >= EAST && kindOf(t) <= NORTH;
const REL = ['自己', '下家', '对家', '上家'];
const STAGE = ['', '一', '二', '三'];
const WIND_NAME = ['东', '南', '西', '北'];
const pct = (v: number) => `${Math.round(v * 100)}%`;

// 这一局她要的风：自风、场风（自风就是场风时没有）、南场收的那一种客风
export function myeonghwaWinds(g: Game, seat: number): { seat: number; round: number | null; guest: number | null } {
  const mine = g.seatWind(seat);
  const round = EAST + g.roundWind;
  const guest = g.abilities[seat]?.id === 'myeonghwa' ? (stateOf(g, seat).guest ?? null) : null;
  return { seat: mine, round: round === mine ? null : round, guest };
}

// 现在唱到第几段（没在唱是 0）。歌是唱给全桌听的，谁都看得见
export function myeonghwaSong(g: Game, seat: number): number {
  return g.abilities[seat]?.id === 'myeonghwa' ? (gameStateOf(g, seat).song ?? 0) : 0;
}

// 这一局歌起不起作用（被封印、断风的局不起作用）
export function myeonghwaSinging(g: Game, seat: number): number {
  return g.active(seat)?.id === 'myeonghwa' ? (stateOf(g, seat).song ?? 0) : 0;
}

// 这一局对哪一家断风（没有是 null）
export function myeonghwaCut(g: Game, seat: number): number | null {
  return g.abilities[seat]?.id === 'myeonghwa' ? (stateOf(g, seat).cut ?? null) : null;
}

// 现在能不能开嗓：歌停着、次数没用完，第二次要进了南场
export function myeonghwaCanSing(g: Game, seat: number): boolean {
  const gs = gameStateOf(g, seat);
  const used = gs.songs ?? 0;
  return !gs.song && used < MYEONGHWA.songs && (used === 0 || g.roundWind >= 1);
}

// 这一局的开嗓是不是一场里的第二次（画面上风大一点：从场外带进来的）
export function myeonghwaSecondSong(g: Game, seat: number): boolean {
  return g.abilities[seat]?.id === 'myeonghwa' && !!stateOf(g, seat).second;
}

// 手里有自风暗刻：役已经在手（电脑的她鸣牌用）
export function myeonghwaYaku(g: Game, seat: number): boolean {
  const k = g.seatWind(seat);
  const p = g.players[seat];
  return p.hand.filter((t) => kindOf(t) === k).length >= 3 || p.melds.some((m) => m.type !== 'chi' && kindOf(m.tiles[0]) === k);
}

// 电脑的她算牌用：场风的第二张这一局还会来（还没来、能力这一局起作用）就返回场风，不会来是 null。
// 来的时候手里不到两张就补一张（打掉了就只剩一张），手里已经成对就不来了
export function myeonghwaComing(g: Game, seat: number): number | null {
  if (g.active(seat)?.id !== 'myeonghwa' || g.quelled(seat)) return null;
  const st = stateOf(g, seat);
  if (!st.winds || st.roundCame) return null;
  return myeonghwaWinds(g, seat).round;
}

// 电脑的她算牌用：南场在手里成对时会摸成暗刻的风（场风、收的那种客风）。东场、能力这一局不起作用时没有
export function myeonghwaGrowing(g: Game, seat: number): number[] {
  if (g.roundWind < 1 || g.active(seat)?.id !== 'myeonghwa' || g.quelled(seat) || !stateOf(g, seat).winds) return [];
  const { guest } = myeonghwaWinds(g, seat);
  return [EAST + g.roundWind, guest].filter((k): k is number => k !== null);
}

// 电脑：初美坐北家的局对她断风
function aiCutTarget(g: Game, seat: number): number | null {
  for (let s = 0; s < 4; s++) {
    if (s === seat || g.abilities[s]?.id !== 'hatsumi' || g.seatWind(s) !== NORTH) continue;
    if (g.binds(seat, s)) return s;
  }
  return null;
}

// 电脑：第一次在坐庄的局、东四局、进了南场开嗓；歌停了以后进了南场再开一次（能不能开由 myeonghwaCanSing 管）
const aiSings = (g: Game, seat: number) => (gameStateOf(g, seat).songs ?? 0) > 0 || g.dealer === seat || g.roundNumber >= 3 || g.roundWind >= 1;

export const myeonghwaAbility: Ability = {
  id: 'myeonghwa',
  name: '风神',
  description: `风：每一局配牌必定有自风暗刻和一张场风，场风的第二张开局 ${MYEONGHWA.roundWithin} 巡之内摸到（自风就是场风的局是双风暗刻）；南场多收一种客风，配牌带一对，成对的场风、客风有 ${pct(MYEONGHWA.windDraw)} 摸成暗刻。歌（一场 ${MYEONGHWA.songs} 次，发牌前开嗓，第二次要进了南场）：配牌、进张更顺（${pct(MYEONGHWA.songDraw[1])}），她每和一局升一段（${pct(MYEONGHWA.songDraw[2])}、${pct(MYEONGHWA.songDraw[3])}），别人和牌就停。断风（发牌前选一家）：这一局那一家没有风牌；这一局她的歌不起作用。`,
  priority: PRIORITY.myeonghwa,

  dealRules(g, seat) {
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    st.draws = 0;
    // 断风：这一局盯着一家
    let cut = g.manual[seat] ? (gs.wantCut ?? null) : aiCutTarget(g, seat);
    if (cut !== null && (cut === seat || !g.binds(seat, cut))) cut = null;
    gs.wantCut = null;
    // 开嗓
    if (myeonghwaCanSing(g, seat) && (g.manual[seat] ? gs.wantSong : aiSings(g, seat) && cut === null)) {
      gs.songs = (gs.songs ?? 0) + 1;
      gs.song = 1;
      st.first = true;
      st.second = gs.songs > 1;
    }
    gs.wantSong = false;
    st.winds = true;
    st.roundAt = 1 + g.rng.int(MYEONGHWA.roundWithin);
    // 断风的局分出了精力，歌不起作用
    st.song = cut === null ? (gs.song ?? 0) : 0;
    const mine = g.seatWind(seat);
    const round = EAST + g.roundWind === mine ? null : EAST + g.roundWind;
    // 南场多收一种客风（哪一种随机）
    if (g.roundWind >= 1 && MYEONGHWA.guestWind > 0) {
      const guests = [EAST, EAST + 1, EAST + 2, NORTH].filter((k) => k !== mine && k !== EAST + g.roundWind);
      st.guest = guests[g.rng.int(guests.length)];
    }
    const guest = st.guest ?? null;
    const lack = (hand: TileId[], k: number | null, n: number) => (k === null ? 0 : Math.max(0, n - hand.filter((t) => kindOf(t) === k).length));
    const missing = (hand: TileId[]) => lack(hand, mine, MYEONGHWA.seatWind) + lack(hand, round, MYEONGHWA.roundWind) + lack(hand, guest, MYEONGHWA.guestWind);
    const rules = [{ seat, ability: 'myeonghwa', text: '风神', target: seat, bad: missing }];
    if (cut !== null) {
      st.cut = cut;
      rules.unshift({ seat, ability: 'myeonghwa', text: '断风', target: cut, bad: (hand: TileId[]) => hand.filter(isWindTile).length });
    }
    return rules;
  },

  beforeDeal(g, seat) {
    const st = stateOf(g, seat);
    const w = g.wall;
    const later = (j: number) => j >= 52;
    if (st.cut !== undefined) {
      // 那一家配牌里的风牌换到发完牌以后的牌山里（换不了的留着，无解降级）
      for (const i of g.dealIndices(st.cut)) {
        if (!isWindTile(w.live[i])) continue;
        const swap = () => w.bringToLive(i, (t) => !isWindTile(t), g.rng, later);
        if (!swap()) g.dealFallback(seat, swap);
      }
    }
    if (!st.winds) return;
    const mine = g.dealIndices(seat);
    const notMine = (j: number) => !mine.includes(j);
    const { seat: sw, round, guest } = myeonghwaWinds(g, seat);
    const want: [number, number][] = [[sw, MYEONGHWA.seatWind]];
    if (round !== null) want.push([round, MYEONGHWA.roundWind]);
    if (guest !== null) want.push([guest, MYEONGHWA.guestWind]);
    const keep = new Set(want.map(([k]) => k));
    // 岭上牌、里宝牌指示牌里也没有时：还没翻开的杠宝牌指示牌里有就换过来（两张都压在那里的局，不换凑不出暗刻）
    const fromKanDora = (slot: number, is: (t: TileId) => boolean) => {
      const j = w.doraIndicators.findIndex((t, i) => i >= w.doraRevealed && !w.locked.has(t) && is(t));
      if (j < 0) return false;
      [w.live[slot], w.doraIndicators[j]] = [w.doraIndicators[j], w.live[slot]];
      return true;
    };
    for (const [k, n] of want) {
      for (;;) {
        if (mine.filter((i) => kindOf(w.live[i]) === k).length >= n) break;
        // 换掉一张用不上的牌：别的字牌先换，再换数牌
        const slot = mine.find((i) => kindOf(w.live[i]) >= 27 && !keep.has(kindOf(w.live[i]))) ?? mine.find((i) => !keep.has(kindOf(w.live[i])));
        if (slot === undefined) break;
        const is = (t: TileId) => kindOf(t) === k;
        // 先从没发的牌里换，不够再从别人的配牌里换（Wall.guard 管着别人的规矩），再不够从没翻开的王牌里换
        if (!w.bringToLive(slot, is, g.rng, later) && !w.bringToLive(slot, is, g.rng, notMine) && !w.bringDeadToLive(slot, is, g.rng) && !fromKanDora(slot, is)) break;
      }
    }
    const song = st.song ?? 0;
    if (song > 0) luckyDeal(g, seat, MYEONGHWA.songDeal[song], 4, (t) => keep.has(kindOf(t)));
    // 场风的第二张：先留一张在牌山靠后的地方（别人摸不到那么深），到了那一巡再换到手边。
    // 牌山里没有就从别人的配牌、还没翻开的王牌里换一张过去；都没有就算了
    if (round !== null && MYEONGHWA.roundPair > MYEONGHWA.roundWind) {
      const is = (t: TileId) => kindOf(t) === round;
      const deep = (j: number) => j >= w.live.length - 30 && j < w.live.length - 4;
      if (!w.live.some((t, j) => deep(j) && is(t))) {
        const spots = w.live.map((_, j) => j).filter((j) => deep(j) && !w.locked.has(w.live[j]));
        const spot = spots.length ? spots[g.rng.int(spots.length)] : -1;
        if (spot >= 0 && !w.bringToLive(spot, is, g.rng, later) && !w.bringToLive(spot, is, g.rng, notMine)) w.bringDeadToLive(spot, is, g.rng);
      }
    }
  },

  onRoundStart(g, seat) {
    const st = stateOf(g, seat);
    if (st.cut !== undefined) g.emit({ type: 'ability', seat, ability: 'myeonghwa', text: '断风' });
    if (st.first) g.emit({ type: 'ability', seat, ability: 'myeonghwa', text: '开嗓' });
    else if ((st.song ?? 0) > 0) g.emit({ type: 'ability', seat, ability: 'myeonghwa', text: `歌·${STAGE[st.song!]}段` });
    if (st.winds) g.emit({ type: 'ability', seat, ability: 'myeonghwa', text: '起风' });
  },

  // 断风的那一家：这一局摸不到风牌（岭上牌除外）
  beforeAnyDraw(g, seat, drawer, rinshan) {
    const cut = stateOf(g, seat).cut;
    if (cut === undefined || drawer !== cut || rinshan) return;
    return { seat, ability: 'myeonghwa', text: '断风', deny: isWindTile };
  },

  beforeDraw(g, seat, rinshan) {
    const st = stateOf(g, seat);
    const draws = (st.draws = (st.draws ?? 0) + 1);
    if (!st.winds) return;
    const p = g.players[seat];
    const w = g.wall;
    // 场风的第二张：到了那一巡就来（牌山里没有了就等下一次）
    const { round, guest } = myeonghwaWinds(g, seat);
    if (round !== null && !rinshan && !st.roundCame && draws >= (st.roundAt ?? 1)) {
      const have = p.hand.filter((t) => kindOf(t) === round).length + (p.melds.some((m) => kindOf(m.tiles[0]) === round && m.type !== 'chi') ? 3 : 0);
      const is = (t: TileId) => kindOf(t) === round;
      if (have >= MYEONGHWA.roundPair) st.roundCame = true;
      else if (is(w.live[0]) || w.bringToLive(0, is, g.rng)) {
        st.roundCame = true;
        g.emit({ type: 'ability', seat, ability: 'myeonghwa', text: '风来' });
        return;
      }
    }
    // 南场：场风、收的那种客风在手里成对时，有机会摸成暗刻
    if (!rinshan && g.roundWind >= 1 && g.rng.chance(MYEONGHWA.windDraw)) {
      for (const k of [EAST + g.roundWind, guest]) {
        if (k === null || p.hand.filter((t) => kindOf(t) === k).length !== 2) continue;
        const is = (t: TileId) => kindOf(t) === k;
        if (is(w.live[0]) || w.bringToLive(0, is, g.rng)) {
          g.emit({ type: 'ability', seat, ability: 'myeonghwa', text: '风来' });
          return;
        }
      }
    }
    const song = st.song ?? 0;
    if (song > 0) luckyDraw(g, seat, rinshan, MYEONGHWA.songDraw[song]);
  },

  // 她和了：歌升一段。别人和了：歌停。被封印的局也照算（歌是唱出来的，不是牌山上的事）
  onRoundEnd(g, seat, result: RoundResult) {
    const gs = gameStateOf(g, seat);
    if (!gs.song || result.kind !== 'win') return;
    if (result.wins.some((x) => x.seat === seat)) {
      if (gs.song < MYEONGHWA.songMax) gs.song++;
      return;
    }
    gs.song = 0;
    g.emit({ type: 'ability', seat, ability: 'myeonghwa', text: '歌停了' });
  },

  preDeal(g, seat): PreDealOption[] {
    const gs = gameStateOf(g, seat);
    const out: PreDealOption[] = [];
    const used = gs.songs ?? 0;
    const can = myeonghwaCanSing(g, seat);
    out.push({
      id: 'song',
      name: '开嗓',
      desc: `从这一局唱起：配牌、进张更顺（${pct(MYEONGHWA.songDraw[1])}），每和一局升一段（最多三段，${pct(MYEONGHWA.songDraw[3])}）。别人和牌歌就停了`,
      enabled: can,
      picked: false,
      note: (gs.song ?? 0) > 0 ? `正在唱第${STAGE[gs.song!]}段` : used >= MYEONGHWA.songs ? `这一场已经唱过 ${MYEONGHWA.songs} 次` : used === 0 ? `一场 ${MYEONGHWA.songs} 次` : can ? '还能再唱一次' : '第二次要进了南场',
    });
    for (let rel = 1; rel < 4; rel++) {
      const target = (seat + rel) % 4;
      const reach = g.binds(seat, target);
      out.push({
        id: `cut@${rel}`,
        name: `断风·${REL[rel]}`,
        desc: `这一局${REL[rel]}（${g.players[target].name}）配牌里没有风牌、也摸不到。分出了精力，这一局歌不起作用`,
        enabled: reach,
        picked: false,
        note: reach ? '这一局歌不起作用' : '管不到',
        group: 'cut',
      });
    }
    return out;
  },

  setPreDeal(g, seat, picked) {
    const gs = gameStateOf(g, seat);
    gs.wantSong = picked.includes('song');
    const cut = picked.find((id) => id.startsWith('cut@'));
    gs.wantCut = cut ? (seat + Number(cut.slice(4))) % 4 : null;
  },

  skill(g, seat) {
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    const song = gs.song ?? 0;
    const meter = { value: song, max: MYEONGHWA.songMax, label: '歌' };
    if (st.cut !== undefined) return { label: '', note: `断风：盯着${g.players[st.cut].name}，这一局歌不起作用`, enabled: false, active: true, meter: song ? meter : undefined };
    if (song > 0) return { label: '', note: `歌 第${STAGE[song]}段：配牌、进张 +${pct(MYEONGHWA.songDraw[song])}${song < MYEONGHWA.songMax ? '，和牌升一段' : ''}，别人和牌就停`, enabled: false, active: true, meter };
    const used = gs.songs ?? 0;
    return { label: '', note: used >= MYEONGHWA.songs ? '歌停了，这一场不能再唱' : used > 0 ? '歌停了，进了南场发牌前可以再唱一次' : `还没开嗓（发牌前可以唱，一场 ${MYEONGHWA.songs} 次）`, enabled: false };
  },

  powered(g, seat) {
    return (stateOf(g, seat).song ?? 0) > 0;
  },

  badge(g, seat) {
    const st = stateOf(g, seat);
    if (st.cut !== undefined) return '断风';
    const song = gameStateOf(g, seat).song ?? 0;
    return song > 0 ? `歌·${STAGE[song]}段` : null;
  },

  insight(g, seat) {
    const gs = gameStateOf(g, seat);
    const st = stateOf(g, seat);
    const { seat: sw, round, guest } = myeonghwaWinds(g, seat);
    const out: string[] = [];
    out.push(`配牌有${WIND_NAME[sw - EAST]}风暗刻${round === null ? '（双风）' : `，${WIND_NAME[round - EAST]}风会摸成一对`}${guest === null ? '' : `，还带一对${WIND_NAME[guest - EAST]}风`}`);
    if (st.cut !== undefined) out.push(`这一局对${g.players[st.cut].name}断风，歌不起作用`);
    const song = gs.song ?? 0;
    const used = gs.songs ?? 0;
    out.push(song > 0 ? `歌唱到第${STAGE[song]}段：进张 +${pct(MYEONGHWA.songDraw[song])}，别人和牌就停` : used >= MYEONGHWA.songs ? '歌已经停了，唱不了了' : used > 0 ? '歌停了，进了南场还能再唱一次' : '还没开嗓');
    return out;
  },
};

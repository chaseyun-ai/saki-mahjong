import type { Game } from '../engine/game';

// 个人赛每一桌记下的和牌（赛事快报用）：后台真打的桌和玩家自己打的那一场都记。
// 只记和牌（流局不记），一局一人一条（一炮双响是两条）。下标都是这一桌 seats 的顺序

export interface HandEvent {
  round: string; // 「南 4 局」
  win: number; // 谁和的
  from: number; // 谁放铳；自摸是 -1
  gain: number; // 这一局和了的人进了多少点（含本场、立直棒）
  han: number;
  limit: string; // 满贯、跳满、倍满、三倍满、役满……；不到满贯是空串
  yaku: string[];
}

const WINDS = ['东', '南', '西', '北'];

// 开始记一局（Game 刚建好时调）：order[座位] 是这个座位坐的人在这一桌 seats 里第几个。返回的数组跟着牌局往里加
export function recordHands(g: Game, order: number[]): HandEvent[] {
  const out: HandEvent[] = [];
  g.onEvent((e) => {
    if (e.type !== 'roundEnd' || e.result.kind !== 'win') return;
    const round = `${WINDS[g.roundWind] ?? ''} ${g.roundNumber + 1} 局`;
    for (const w of e.result.wins) {
      out.push({
        round,
        win: order[w.seat],
        from: w.from === null ? -1 : order[w.from],
        gain: e.result.deltas[w.seat],
        han: w.result.han,
        limit: w.result.limitName,
        yaku: w.result.yaku.map((y) => y.name),
      });
    }
  });
  return out;
}

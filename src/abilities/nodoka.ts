import type { Game } from '../engine/game';
import type { Kind } from '../engine/tiles';
import { readOthers } from './hiroe';
import type { Ability } from './types';

// 原村和（清澄）：平时就是牌效最好的普通人，没有控场。
// 第二形态“天使和”：心里有个看不见的计数，从 start 开始；桌上每有一名比她强（费用比她高）的对手，
// 每过完一局（连庄的本场不算，同一局只算一次）就减一。减到 0 以后的下一局起，这一场一直是天使和：
// - 别人对她配牌、摸牌的影响减半：别人给她配牌、摸牌定的规矩，每一条有 resist 的概率不算；
//   别人调整配牌时，这一局有 resist 的概率碰不到她的配牌（absolute 的玄照样管得到她）
// - 专注对局：不再失误（电脑的和，见 src/ai/ai.ts）
// - 看得出别人会荣和 bigPay 点以上的铳牌，不打它们（玩家操作时指着这种牌会冒气泡，见 src/ui/app.ts）
// 被爽的蛇神威封印的那一局变不了天使

export const NODOKA = { start: 9, resist: 0.5, bigPay: 8000 };

// 每个角色的费用（characters.ts 填进来；这里直接 import 角色表会循环引用）
let costs: Record<string, number> = {};
export function setNodokaCosts(table: Record<string, number>): void {
  costs = table;
}
const costOf = (g: Game, s: number): number => costs[g.abilities[s]?.id ?? ''] ?? 0;

// 桌上比她强的对手有几个
export function nodokaStrong(g: Game, seat: number): number {
  const mine = costOf(g, seat);
  return [0, 1, 2, 3].filter((s) => s !== seat && costOf(g, s) > mine).length;
}

// 看不见的计数：开局 start，每过完一局减去比她强的人数（本场不算）
export function nodokaCounter(g: Game, seat: number): number {
  const now = g.roundWind * 4 + g.roundNumber;
  const done = new Set<number>();
  for (const e of g.events) if (e.type === 'roundStart' && e.slot !== undefined && e.slot < now) done.add(e.slot);
  return NODOKA.start - nodokaStrong(g, seat) * done.size;
}

// 这一局是不是天使和
export function nodokaAngel(g: Game, seat: number): boolean {
  return g.active(seat)?.id === 'nodoka' && nodokaCounter(g, seat) <= 0;
}

// 天使和看得出的大铳牌：打出去会被别人荣和 bigPay 点以上的牌种
export function angelDanger(g: Game, seat: number): Set<Kind> {
  const out = new Set<Kind>();
  for (const r of readOthers(g, seat)) r.ron.forEach((k, i) => r.pay[i] >= NODOKA.bigPay && out.add(k));
  return out;
}

const ANGEL = '天使和';

export const nodokaAbility: Ability = {
  id: 'nodoka',
  name: '天使和',
  description: '平时是不受场况影响的数字派。对局里遇到比自己强的人会越来越专注，到了某一局就变成天使和：别人对她配牌、摸牌的影响减半，不再失误，看得出 8000 点以上的铳牌',
  resist(g, seat) {
    return nodokaAngel(g, seat) ? NODOKA.resist : 0;
  },
  form(g, seat) {
    return nodokaAngel(g, seat) ? 'angel' : null;
  },
  onRoundStart(g, seat) {
    if (!nodokaAngel(g, seat)) return;
    // 变身的那一局放一次
    if (g.events.some((e) => e.type === 'ability' && e.seat === seat && e.text === ANGEL)) return;
    g.emit({ type: 'ability', seat, ability: 'nodoka', text: ANGEL });
  },
  badge(g, seat) {
    return nodokaAngel(g, seat) ? '天使' : null;
  },
  insight(g, seat) {
    return nodokaAngel(g, seat) ? ['天使和：别人对她配牌、摸牌的影响减半', '不再失误，看得出 8000 点以上的铳牌'] : ['还是平常的和：只靠牌效和防守'];
  },
};

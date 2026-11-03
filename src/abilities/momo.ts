import type { Game } from '../engine/game';
import { nodokaAngel } from './nodoka';
import type { Ability } from './types';

// 东横桃子（鹤贺）：隐身（ステルスモモ）。不动牌山，一张牌都不换。
// 前 MOMO.from - 1 巡和平常一样；第 MOMO.from 巡那张牌落进牌河的那一刻起，她的牌河和手牌在别人眼里慢慢淡掉，看不见她（像视线从她身上滑开）：
// - 她整条牌河（之前打的也算）和手牌在别人眼里直接消失，副露照旧摆着
// - 她打的牌谁也荣和不了、吃碰杠不了，也不因为没看见这张而振听
// - 她立没立直别人也不知道（之前立的也一样）：没有立直棒，点数、场上立直棒不显示那 1000 点，电脑当她没立直
// - 读牌的人（洋榎、照魔镜、无极天、憧的距离感……）也读不出她听什么，抓不住她的铳牌
// - 只有天使和的原村和看得见她（看得见牌河、立直，读得出她的铳牌）
// - 一局结束（有人和了、流局）全部亮出来；被爽的蛇神威封印的那一局隐身不了
// 电脑的桃子：隐身之前听牌先默听，等隐身的那一巡再立直（别人不知道她立直了）

export const MOMO = { from: 7 };

// 隐身了没有：第 7 巡打出牌的那一刻起（她已经打过 7 张）
export const momoStealthOn = (g: Game, seat: number) => g.active(seat)?.id === 'momo' && g.players[seat].discards.length >= MOMO.from;

// 这一张打出去就隐身了（第 7 巡或者更晚）
export const momoStealthNext = (g: Game, seat: number) => g.active(seat)?.id === 'momo' && g.players[seat].discards.length + 1 >= MOMO.from;

export const momoAbility: Ability = {
  id: 'momo',
  name: '隐身',
  description: `从第 ${MOMO.from} 巡起别人看不见她：那张牌落进牌河，她的牌河和手牌就慢慢淡掉，她打的牌没人荣和得了、吃碰不了；她立直别人也不知道，读牌的人也读不出她的铳牌。只有天使和的原村和看得见她`,
  stealth(g, _seat, viewer) {
    return nodokaAngel(g, viewer) ? null : MOMO.from;
  },
  badge(g, seat) {
    return momoStealthOn(g, seat) ? '隐身' : null;
  },
  insight(g, seat) {
    return momoStealthOn(g, seat) ? ['隐身中：她的牌河、手牌看不见，打的牌荣和不了，她立没立直也不知道', '只有天使和的原村和看得见她'] : [`还没隐身：第 ${MOMO.from} 巡起别人看不见她`];
  },
};

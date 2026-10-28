import type { Game } from '../engine/game';
import { nodokaAngel } from './nodoka';
import type { Ability } from './types';

// 东横桃子（鹤贺）：隐身（ステルスモモ）。不动牌山，一张牌都不换。
// 从她的第 MOMO.from 巡起，别人看不见她：
// - 她从这一巡起打的牌在别人眼里直接消失（牌河里没有），谁也荣和不了、吃碰杠不了，也不因为没看见这张而振听
// - 这一巡起的立直别人也不知道：立直棒、点数照旧（不显示那 1000 点），电脑当她没立直
// - 读牌的人（洋榎、照魔镜、无极天、憧的距离感……）也读不出她听什么，抓不住她的铳牌
// - 只有天使和的原村和看得见她（看得见牌河、立直，读得出她的铳牌）
// - 一局结束（有人和了、流局）全部亮出来；被爽的蛇神威封印的那一局隐身不了
// 电脑的桃子：隐身之前听牌先默听，等隐身以后再立直（别人不知道她立直了）

export const MOMO = { from: 7 };

// 从她打的第几张牌起（0 起算）别人看不见
const HIDE_FROM = MOMO.from - 1;

// 到第 7 巡了没有（她已经打过 6 张）
export const momoStealthOn = (g: Game, seat: number) => g.active(seat)?.id === 'momo' && g.players[seat].discards.length >= HIDE_FROM;

export const momoAbility: Ability = {
  id: 'momo',
  name: '隐身',
  description: `从第 ${MOMO.from} 巡起别人看不见她：她打的牌在牌河里直接消失，没人荣和得了、吃碰不了；她立直别人也不知道，读牌的人也读不出她的铳牌。只有天使和的原村和看得见她`,
  stealth(g, _seat, viewer) {
    return nodokaAngel(g, viewer) ? null : HIDE_FROM;
  },
  badge(g, seat) {
    return momoStealthOn(g, seat) ? '隐身' : null;
  },
  insight(g, seat) {
    return momoStealthOn(g, seat) ? ['隐身中：她打的牌看不见、荣和不了，她立没立直也不知道', '只有天使和的原村和看得见她'] : [`还没隐身：第 ${MOMO.from} 巡起别人看不见她`];
  },
};

// 鹤田姬子拿到钥匙那一局的配牌节奏（3D、2.5D、2D 共用）。
// 别人照常发牌；她的牌不跟着发，等别人发完，再从左到右一张接一张、匀速地裹着火从天上砸进她手里，
// 最后一张砸下来最重，整个画面一震。
// 时间都是秒，从她这一段开始算。

export const HIMEKO_BEAT = {
  lead: 0.3, // 开始以后多久砸下第一张
  step: 0.16, // 一张接一张，每张隔多久
  settle: 0.55, // 最后一张砸下来以后停多久再理牌
};

export interface BeatHit {
  at: number; // 第几秒砸下来
  accent: 0 | 2; // 0 普通，2 最后一张（重拍）
}

// 一共 n 张（闲家 13，庄家 14）里第 i 张（按她手里从左到右）什么时候砸下来
export function beatHit(i: number, n: number): BeatHit {
  const b = HIMEKO_BEAT;
  return { at: b.lead + i * b.step, accent: i === n - 1 ? 2 : 0 };
}

// 重拍（最后一张）的时刻
export const beatFinal = (n: number) => beatHit(n - 1, n).at;
// 整段配牌（不算火）多长：最后一张之后再停一下
export const beatLength = (n: number) => beatFinal(n) + HIMEKO_BEAT.settle;

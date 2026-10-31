import * as THREE from 'three';
import type { BoltStyle, Effects, TileBox } from './effects';

// 和牌特效皮肤。一套皮肤管下面几个时刻，没写的那个时刻就什么也不放：
//  dealIn       荣和时倒牌前，打在牌河里放铳的那张牌上（top 是从画面上方劈下来的起点）
//  ronClosed    门清（暗杠也算门清）荣和，牌倒完以后从和牌的人左手边第一张走到和的那张
//  tsumoClosed  门清自摸，同上
//  ronOpen      有鸣牌的荣和，at 是和牌的人手牌前面的桌面
//  tsumoOpen    有鸣牌的自摸，同上
// 倒完牌以后的几个返回要等多少秒再出结算（特效走完主要的部分）。加新皮肤就往 WIN_FX_SKINS 里添一项
export interface WinFxContext {
  fx: Effects;
  eye: THREE.Vector3; // 镜头位置，光带朝着镜头
}

export interface WinFxSkin {
  id: string;
  name: string;
  dealIn?(c: WinFxContext, tile: THREE.Vector3, top: THREE.Vector3): void;
  ronClosed?(c: WinFxContext, hand: TileBox[]): number;
  tsumoClosed?(c: WinFxContext, hand: TileBox[]): number;
  ronOpen?(c: WinFxContext, at: THREE.Vector3): number;
  tsumoOpen?(c: WinFxContext, at: THREE.Vector3): number;
}

const GOLD = '#ffd36b';

// 有鸣牌时先沿用原来的金色冲击波和闪光（去掉了光柱）
const burst = (c: WinFxContext, at: THREE.Vector3): number => {
  c.fx.ring(at, GOLD, 14, 1.2);
  c.fx.ring(at, '#ffffff', 8, 0.8);
  c.fx.sparkles(at, GOLD, 70, 5, 2.2);
  c.fx.flash(at.clone().setY(3), '#fff2c4', 18, 0.6);
  return 0;
};

const STORM: WinFxSkin = {
  id: 'storm',
  name: '细金雷',
  // 一道细的黄色闪电劈在铳牌上
  dealIn: (c, tile, top) => c.fx.bolt(top, tile, c.eye, { color: '#ffe24a', width: 0.45, duration: 0.5 }),
  // 门清荣和：蓝色电火花像烧引线一样从左到右窜过手牌
  ronClosed: (c, hand) => c.fx.fuse(hand, 'spark', '#3d9bff', c.eye),
  // 门清自摸：火烧引线
  tsumoClosed: (c, hand) => c.fx.fuse(hand, 'fire', '#ff9a2e', c.eye),
  ronOpen: burst,
  tsumoOpen: burst,
};

// 别的几版只换点和的闪电
const dealIn = (id: string, name: string, style: BoltStyle): WinFxSkin => ({
  ...STORM,
  id,
  name,
  dealIn: (c, tile, top) => c.fx.bolt(top, tile, c.eye, style),
});

export const WIN_FX_SKINS: WinFxSkin[] = [
  STORM,
  // 蓝白色、稍粗，四根分叉，快速闪四下
  dealIn('white', '白雷', {
    color: '#8fd0ff',
    width: 0.8,
    branches: 4,
    duration: 0.6,
    strikes: [
      [0, 1],
      [0.2, 0.6],
      [0.38, 0.95],
      [0.6, 0.8],
    ],
    sparkColor: '#cfeaff',
  }),
  // 紫色、很碎，分叉又多又长，像蜘蛛网
  dealIn('violet', '紫电', { color: '#b46bff', core: '#f6eaff', width: 0.6, branches: 5, forkLen: 0.35, segments: 18, amp: 2.4, duration: 0.55 }),
  // 细金雷从正上方和左右两边接连劈三道
  dealIn('triple', '三连雷', {
    color: '#ffe24a',
    width: 0.4,
    bolts: 3,
    stagger: 0.11,
    duration: 0.4,
    strikes: [
      [0, 1],
      [0.5, 0.7],
    ],
  }),
  // 粗、几乎是直的，一根分叉，闪得久，打中的光大一些
  dealIn('heaven', '天雷', {
    color: '#ffc93a',
    core: '#fffbe8',
    width: 1.3,
    branches: 1,
    amp: 0.7,
    duration: 0.75,
    hit: 1.3,
    strikes: [
      [0, 1],
      [0.2, 0.85],
      [0.4, 1],
      [0.62, 0.8],
    ],
  }),
];

export const DEFAULT_WIN_FX = WIN_FX_SKINS[0];

export function winFxSkin(id: string | undefined): WinFxSkin {
  return WIN_FX_SKINS.find((s) => s.id === id) ?? DEFAULT_WIN_FX;
}

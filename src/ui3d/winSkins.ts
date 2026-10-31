import * as THREE from 'three';
import { blaze, type BlazeStage } from './blaze';
import type { Effects, TileBox } from './effects';

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
  stage: BlazeStage; // 慢动作、震屏、整屏的暗角闪白；lite 是手机上的省电版
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
  name: '雷火',
  // 一道细的黄色闪电劈在铳牌上
  dealIn: (c, tile, top) => c.fx.bolt(top, tile, '#ffe24a', c.eye, 0.5, 0.45),
  // 门清荣和：蓝色电火花像烧引线一样从左到右窜过手牌
  ronClosed: (c, hand) => c.fx.fuse(hand, 'spark', '#3d9bff', c.eye),
  // 门清自摸：火烧引线
  tsumoClosed: (c, hand) => c.fx.fuse(hand, 'fire', '#ff9a2e', c.eye),
  ronOpen: burst,
  tsumoOpen: burst,
};

export const WIN_FX_SKINS: WinFxSkin[] = [
  STORM,
  // 华丽版：门清自摸换成「炎舞」（blaze.ts），别的时刻和雷火一样
  { ...STORM, id: 'blaze', name: '炎舞', tsumoClosed: (c, hand) => blaze(c.fx, hand, c.eye, c.stage) },
];

export const DEFAULT_WIN_FX = WIN_FX_SKINS[0];

export function winFxSkin(id: string | undefined): WinFxSkin {
  return WIN_FX_SKINS.find((s) => s.id === id) ?? DEFAULT_WIN_FX;
}

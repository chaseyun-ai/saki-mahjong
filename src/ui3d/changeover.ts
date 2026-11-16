import type * as THREE from 'three';

// 换局的演出（牌桌风格自己的，theme.ts 的 changeover）：沙滩一个浪打过来（tide.ts），草甸一阵风刮过来（gust.ts）。
// table3d.ts 每局开始时把桌上看得见的牌各复制一份交给它（sweep，原来的牌藏起来留给新的一局），再告诉它四家牌山在哪（rise）；
// 演着的时候（busy）牌山上的牌照 wallPose 摆，王牌感知那些浮在牌山上的牌面先不出来

// 牌山脚下那块地方（世界坐标，跟坐标轴对齐）：中心和两个方向的半宽，和自动麻将机的 MachineRect 一样
export interface WallRect {
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface Changeover<Cue extends string = string> {
  readonly group: THREE.Group;
  // 新牌山的牌歪着出来时绕哪根水平轴歪（世界坐标）
  readonly tiltAxis: THREE.Vector3;
  // 还在演：牌山上的牌照 wallPose 摆
  readonly busy: boolean;
  // 桌子尺寸定下来（或者变了）：half 桌面半宽，consoleHalf 仪表盘半宽，disc 仪表盘是不是圆盘
  build(half: number, consoleHalf: number, disc: boolean): void;
  // 屏幕上一个世界单位（在一个单位远处）有多少像素：粒子照这个定大小
  setScale(px: number): void;
  // 收牌：这些替身牌交给它演（演完它自己拿掉）
  sweep(objs: THREE.Object3D[], now: number): void;
  // 摆新牌山：返回从 now 起多久以后可以掷骰子
  rise(now: number, rects: WallRect[]): number;
  // (x, z) 在不在新牌山上
  onWall(x: number, z: number): boolean;
  // 牌山上 (x, z) 那一墩现在离摆好的位置差多少：out = (dx, dy, dz, 绕 tiltAxis 歪多少弧度)；还没出来返回 false（先藏着）
  wallPose(x: number, z: number, out: THREE.Vector4): boolean;
  // 往前走到 now，返回这一下该响的声音
  update(now: number): { cue: Cue; dur: number }[];
  // 马上演完（牌桌重建、跳过动画时）
  finish(): void;
  dispose(): void;
}

// 牌桌尺寸：哪些距离可以调，以及由它们算出来的各处位置。
//
// 桌上的距离以牌宽为单位（世界单位，牌宽是 1），都是两样东西之间看得见的空隙；
// 和人身体有关的用米（按人物身材），乘上人物放大倍数才是世界单位。
// 坐标和 table3d.ts 一样：每个座位的本地 +z 指向坐着的人，数值越大离桌子中心越远。

export const TILE_W = 1;
export const TILE_H = 1.36;
export const TILE_T = 0.78;
// 牌河里牌和牌之间的缝
export const POND_GAP = 0.04;
export const POND_COLS = 6;
export const POND_ROWS = 3;

// 牌山离中心多远：每边 17 墩围成方形，再近四个角就撞上了，所以不调
export const WALL_Z = 9.45;
// 人物大小 100% 时的放大倍数：模型的 1 米 = 23 个世界单位
export const BASE_AVATAR_SCALE = 23;
// 模型有高有矮（自带的四个底模坐高差两成，玩家导入的更说不准）：入座时按坐高（髋到头骨根部，米）
// 缩放到这个标准坐高，四家肩膀一样高、胳膊差不多一样长，矮的模型也够得着牌河。
// 标准取自带的三个高个底模的坐高；太离谱的模型最多只放大缩小这么多
export const REF_SIT_HEIGHT = 0.485;
const FIT_RANGE: [number, number] = [0.8, 1.3];
export const fitScale = (sitHeight: number): number => Math.min(FIT_RANGE[1], Math.max(FIT_RANGE[0], REF_SIT_HEIGHT / sitHeight));
// 中央控制台的半宽；怜竖着立的立直棒在牌河前面 0.5，不能压到控制台（其他人的立直棒放在控制台顶上）
export const CONSOLE_HALF = 2.9;

export interface TableLayout {
  size: number; // 人物大小，1 是 100%
  handToEdge: number; // 手牌背面到桌框内沿（牌宽）
  wallToHand: number; // 牌山外沿到手牌正面（牌宽）
  wallToPond: number; // 牌山内沿到牌河第一行外沿（牌宽）
  frame: number; // 桌框宽（牌宽）
  seatGap: number; // 髋部到桌框外沿（米）
  seatDrop: number; // 桌面比髋部高多少（米）
}

export const DEFAULT_LAYOUT: TableLayout = {
  // 100% 时人相对桌子太小（按牌换算，桌子是真实的七成，人只有一半），最远那排牌河要俯到头、胳膊绷直才勉强够着；
  // 放大两成（再加上下面的坐近、桌面放低），胳膊还带点弯就够得着。再大两侧的人挤进画面太多
  size: 1.2,
  handToEdge: 2.61,
  wallToHand: 0.48,
  wallToPond: WALL_Z - TILE_H * 1.5 - 3.6, // 牌河第一行从离中心 3.6 处开始，约 3.81
  frame: 1.4,
  // 原来髋离桌框 24 厘米、桌面比髋高 24 厘米：这些模型躯干短（髋到肩才 37 厘米），桌面齐胸，
  // 俯身伸手时肩膀沉到牌山以下。坐近 5 厘米、桌面放低 5 厘米（齐腰），最远一排俯二十来度就够得着
  seatGap: 0.19,
  seatDrop: 0.19,
};

// 牌河离中心最近、最远可以到哪：再近，四家牌河的角（加上立直横放的牌、牌河前的立直棒）
// 会撞到一起或压到控制台；再远，第三行就压到牌山
const POND_MIN = CONSOLE_HALF + 0.6;
const POND_MAX = WALL_Z - TILE_H / 2 - POND_ROWS * (TILE_H + POND_GAP) - 0.1;

export const LAYOUT_LIMITS: Record<keyof TableLayout, [number, number]> = {
  size: [0.8, 2.2],
  // 倒牌时牌往前倒，副露横放的牌比手牌更靠外，再小就伸出桌框了
  handToEdge: [0.8, 5],
  wallToHand: [0.1, 3],
  wallToPond: [WALL_Z - TILE_H * 1.5 - POND_MAX, WALL_Z - TILE_H * 1.5 - POND_MIN],
  frame: [0.6, 3],
  seatGap: [0.08, 0.4],
  seatDrop: [0.15, 0.35],
};

export const LAYOUT_KEYS = Object.keys(DEFAULT_LAYOUT) as (keyof TableLayout)[];

// 把每个参数限制在不会撞牌的范围里
export function clampLayout(l: TableLayout): TableLayout {
  const out = { ...l };
  for (const k of LAYOUT_KEYS) {
    const [lo, hi] = LAYOUT_LIMITS[k];
    out[k] = Math.min(hi, Math.max(lo, l[k]));
  }
  return out;
}

// 由参数算出来的位置（世界单位，距离桌子中心）
export interface TableDims {
  scale: number; // 人物放大倍数
  handZ: number; // 手牌那一排的中线
  meldZ: number; // 副露那一排的中线
  pondZ: number; // 牌河第一行靠中心的边
  tableHalf: number; // 桌布（桌框内沿）
  frame: number;
  bodyHalf: number; // 桌框外沿
  seatZ: number; // 髋部
  seatY: number; // 髋部的高度（桌面是 0）
}

export function tableDims(l: TableLayout): TableDims {
  const scale = BASE_AVATAR_SCALE * l.size;
  const handZ = WALL_Z + TILE_H / 2 + l.wallToHand + TILE_T / 2;
  const tableHalf = handZ + TILE_T / 2 + l.handToEdge;
  const bodyHalf = tableHalf + l.frame;
  return {
    scale,
    handZ,
    // 手牌离桌边很近时，副露往里收一点，横放的牌不伸出桌框
    meldZ: Math.min(handZ + 0.6, tableHalf - 1),
    pondZ: WALL_Z - TILE_H * 1.5 - l.wallToPond,
    tableHalf,
    frame: l.frame,
    bodyHalf,
    seatZ: bodyHalf + l.seatGap * scale,
    seatY: -l.seatDrop * scale,
  };
}

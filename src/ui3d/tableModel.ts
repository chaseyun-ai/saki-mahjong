import * as THREE from 'three';
import type { TableDims } from './tableLayout';

// 全自动麻将桌的桌框和机身（参考大洋 AMOS）。
//
// 桌框是一整圈圆角框，比桌布高一点。机身从桌框下面开始：先是一圈和桌框一样宽的围板（点棒抽屉装在这里），
// 然后两边沿弧线往里收，收到坐着的人膝盖前面；再往下是略微变窄的立柱，最底下一圈底座落在地上。
// 从侧面看是上宽下窄、带弧度的梯形。收多窄按人的膝盖和脚尖的位置算，腿不会穿进桌子。

// 腿的尺寸（米，按人物身材），量自四个模型里腿最长的那个
const KNEE_REACH = 0.47; // 髋部往桌子方向到膝盖前面
const TOE_REACH = 0.55; // 髋部往桌子方向到脚尖
const THIGH_TOP = 0.02; // 大腿上面比髋部高多少
const FOOT_DROP = 0.57; // 髋部到脚底
const FRAME_H = 0.8; // 桌框总高
const APRON_H = 1.2; // 桌框下面围板的高度
const PLINTH_H = 0.5; // 底座高度
const PLINTH_OUT = 0.25; // 底座比立柱宽出多少

export interface TableShape {
  frameBottom: number;
  apronY: number; // 围板下沿，从这里开始往里收
  waistY: number; // 收到最窄的高度（大腿上面）
  waistHalf: number;
  footHalf: number; // 立柱下端
  floorY: number;
}

export function tableShape(d: TableDims, frameTop: number): TableShape {
  const frameBottom = frameTop - FRAME_H;
  const waistY = d.seatY + THIGH_TOP * d.scale;
  const apronTop = d.bodyHalf - 0.12;
  // 腰不宽过围板的四分之三，看起来才像收进去的梯形；也别细成一根杆
  const waistHalf = Math.max(3, Math.min(apronTop * 0.75, d.seatZ - KNEE_REACH * d.scale));
  return {
    frameBottom,
    apronY: Math.max(waistY + 1, frameBottom - APRON_H),
    waistY,
    waistHalf,
    footHalf: Math.max(2.5, Math.min(waistHalf, d.seatZ - TOE_REACH * d.scale - PLINTH_OUT)),
    floorY: d.seatY - FOOT_DROP * d.scale,
  };
}

// 圆角的大小跟着尺寸走
const cornerRadius = (half: number) => THREE.MathUtils.clamp(half * 0.14, 0.5, 2.2);

export interface TableMaterials {
  frame: THREE.Material;
  trim: THREE.Material;
  body: THREE.Material;
  floor: THREE.Material;
}

// 整张桌子（不含桌布、控制台和抽屉）：桌框、内侧金属包边、机身、地面
export function buildTableModel(d: TableDims, frameTop: number, mats: TableMaterials): THREE.Group {
  const shape = tableShape(d, frameTop);
  const group = new THREE.Group();

  // 桌框：外圈圆角，内圈就是桌布的方形；上下边都倒圆
  const bevel = 0.14;
  // 框窄的时候外圈圆角也要小，免得四个角上框被圆角切断
  const outerR = Math.min(cornerRadius(d.bodyHalf), (Math.SQRT2 * d.frame - 0.25) / (Math.SQRT2 - 1));
  const outer = roundedRectShape(d.bodyHalf - bevel, Math.max(0.05, outerR - bevel));
  outer.holes.push(roundedRectShape(d.tableHalf + bevel, 0.05));
  const frameGeo = new THREE.ExtrudeGeometry(outer, {
    depth: FRAME_H - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
  });
  frameGeo.rotateX(-Math.PI / 2);
  frameGeo.translate(0, shape.frameBottom + bevel, 0);
  const frame = new THREE.Mesh(frameGeo, mats.frame);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // 桌框内侧一圈金属包边
  for (let s = 0; s < 4; s++) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(d.tableHalf * 2, 0.05, 0.08), mats.trim);
    trim.position.set(0, frameTop - 0.02, d.tableHalf + 0.05);
    const side = new THREE.Group();
    side.rotation.y = (s * Math.PI) / 2;
    side.add(trim);
    group.add(side);
  }

  // 机身：一圈圈圆角方形从上往下连起来
  const rings: [number, number][] = [];
  const apron = d.bodyHalf - 0.12;
  rings.push([apron, shape.frameBottom + 0.05], [apron, shape.apronY]);
  // 围板下沿到腰：四分之一椭圆，上面几乎是平着往里收，到腰那里变成竖直
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const a = (Math.PI / 2) * (1 - i / steps);
    const r = shape.waistHalf + (apron - shape.waistHalf) * (1 - Math.cos(a));
    rings.push([r, shape.waistY + (shape.apronY - shape.waistY) * Math.sin(a)]);
  }
  const plinthTop = shape.floorY + PLINTH_H;
  rings.push([shape.footHalf, plinthTop], [shape.footHalf + PLINTH_OUT, plinthTop], [shape.footHalf + PLINTH_OUT, shape.floorY]);
  const body = new THREE.Mesh(loftGeometry(rings), mats.body);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 围板下沿和底座上沿各一道金属细线，把机身的轮廓勾出来
  const band = (half: number, y: number) => new THREE.Mesh(loftGeometry([[half, y + 0.06], [half, y - 0.06]], false), mats.trim);
  group.add(band(apron + 0.02, shape.apronY + 0.06), band(shape.footHalf + PLINTH_OUT + 0.02, plinthTop - 0.06));

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = shape.floorY;
  floor.receiveShadow = true;
  group.add(floor);
  return group;
}

// 以原点为中心的圆角方形（xy 平面），挤出后转到水平
function roundedRectShape(half: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const h = half;
  s.moveTo(-h + r, -h);
  s.lineTo(h - r, -h);
  s.quadraticCurveTo(h, -h, h, -h + r);
  s.lineTo(h, h - r);
  s.quadraticCurveTo(h, h, h - r, h);
  s.lineTo(-h + r, h);
  s.quadraticCurveTo(-h, h, -h, h - r);
  s.lineTo(-h, -h + r);
  s.quadraticCurveTo(-h, -h, -h + r, -h);
  return s;
}

// 一圈圆角方形上的点（xz 平面），每圈点数一样，才能一圈圈连起来
const CORNER_SEGS = 8;
function ringPoints(half: number): [number, number][] {
  const r = cornerRadius(half);
  const c = half - r;
  const pts: [number, number][] = [];
  const centers: [number, number][] = [
    [c, c],
    [-c, c],
    [-c, -c],
    [c, -c],
  ];
  centers.forEach(([cx, cz], k) => {
    for (let i = 0; i <= CORNER_SEGS; i++) {
      const a = ((k + i / CORNER_SEGS) * Math.PI) / 2;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  });
  return pts;
}

// 把一串 [半宽, 高度] 连成一个侧面，cap 时最底下封口
function loftGeometry(rings: [number, number][], cap = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  let n = 0;
  for (const [half, y] of rings) {
    const pts = ringPoints(half);
    n = pts.length;
    for (const [x, z] of pts) pos.push(x, y, z);
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * n + i;
      const b = j * n + ((i + 1) % n);
      const c = a + n;
      const e = b + n;
      index.push(a, b, c, b, e, c);
    }
  }
  if (cap) {
    const last = (rings.length - 1) * n;
    const centre = pos.length / 3;
    pos.push(0, rings[rings.length - 1][1], 0);
    for (let i = 0; i < n; i++) index.push(centre, last + i, last + ((i + 1) % n));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

import * as THREE from 'three';
import { BLOCK, pixelCanvas } from '../pixel/blocks';
import type { TableDims } from './tableLayout';
import { tableShape } from './tableModel';

// 像素牌桌（方块世界那种）：桌子是一个个方块搭的。桌框是一圈木板方块，四个角下面各一根方块桌腿，
// 桌布是一块块羊毛毡拼的，地上铺一块块深色木板。方块边长差不多就是桌框宽（视觉设置里调桌框宽，方块跟着变大变小），
// 一圈正好放整数个，所以桌布、桌框、地板的缝都对得上。贴图都是 16×16 的小图（pixel/blocks.ts），放大不插值

// 一张 16×16 的小图做成贴图：放大不插值；缩小时用多级贴图（远处的桌布不闪），四周接得上
export function blockTexture(px: Uint32Array, w = BLOCK, h = BLOCK): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(pixelCanvas(px, w, h));
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
}

// 方块多大、一边几个
export function blockCell(d: TableDims): { n: number; c: number } {
  const n = Math.max(6, Math.round((d.bodyHalf * 2) / d.frame));
  return { n, c: (d.bodyHalf * 2) / n };
}

// 按世界坐标重新算贴图坐标：每个面取它所在平面的两个轴，一个方块边长 unit 正好贴一遍；
// 从 origin 开始数格子（桌框外角），桌布、地板、仪表盘上的格子就和桌框的方块对齐
export function worldUV(geo: THREE.BufferGeometry, unit: number, origin = new THREE.Vector3()): THREE.BufferGeometry {
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < p.count; i++) {
    const x = (p.getX(i) - origin.x) / unit;
    const y = (p.getY(i) - origin.y) / unit;
    const z = (p.getZ(i) - origin.z) / unit;
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    // 侧面：横着的轴配竖着的 y（贴图上方朝上）；顶面、底面：x、z
    if (ay > 0.7) uv.setXY(i, x, -z);
    else if (ax > 0.7) uv.setXY(i, z * Math.sign(n.getX(i)) * -1, y);
    else uv.setXY(i, x * Math.sign(n.getZ(i)), y);
  }
  uv.needsUpdate = true;
  return geo;
}

export interface BlockMaterials {
  frame: THREE.Material;
  leg: THREE.Material;
  felt: THREE.Material;
  floor: THREE.Material;
}

export function buildBlockTable(d: TableDims, frameTop: number, mats: BlockMaterials): THREE.Group {
  const group = new THREE.Group();
  const { n, c } = blockCell(d);
  const h = d.bodyHalf;
  const at = (i: number) => -h + c * (i + 0.5);

  // 桌框：外面一圈方块
  const cube = new THREE.BoxGeometry(c, c, c);
  const ring: [number, number][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (i === 0 || j === 0 || i === n - 1 || j === n - 1) ring.push([i, j]);
  const frame = new THREE.InstancedMesh(cube, mats.frame, ring.length);
  const m = new THREE.Matrix4();
  ring.forEach(([i, j], k) => frame.setMatrixAt(k, m.makeTranslation(at(i), frameTop - c / 2, at(j))));
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // 桌腿：四个角的方块往下一直摞到地面
  const shape = tableShape(d, frameTop);
  const stack = Math.max(1, Math.ceil((frameTop - c - shape.floorY) / c));
  const legs = new THREE.InstancedMesh(cube, mats.leg, stack * 4);
  let k = 0;
  for (const [i, j] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]])
    for (let s = 0; s < stack; s++) legs.setMatrixAt(k++, m.makeTranslation(at(i), frameTop - c * (s + 1.5), at(j)));
  legs.castShadow = true;
  legs.receiveShadow = true;
  group.add(legs);

  // 桌布：铺满整个桌框外圈那么大（外面一圈压在桌框方块底下看不见），一格一块毡
  const felt = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(h * 2, h * 2).rotateX(-Math.PI / 2), c, new THREE.Vector3(-h, 0, -h)), mats.felt);
  felt.receiveShadow = true;
  group.add(felt);

  // 地板：一大片，格子和桌子对齐
  const floor = new THREE.Mesh(worldUV(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), c, new THREE.Vector3(-h, 0, -h)), mats.floor);
  floor.position.y = shape.floorY;
  floor.receiveShadow = true;
  group.add(floor);
  return group;
}

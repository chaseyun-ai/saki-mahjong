import * as THREE from 'three';
import { DiscardParams, DiscardPath, sampleDiscard, totalTime } from '../ui3d/discardMotion';

// 调试场景的辅助线：手腕目标、实际手腕和手臂、接触点和指尖、手腕和牌走过的轨迹。
// 都画在最上层（不被桌子和人挡住），每一类可以单独开关。

export type GizmoKind = 'target' | 'arm' | 'contact' | 'wristPath' | 'tilePath';

export const GIZMO_LABELS: Record<GizmoKind, string> = {
  target: '手腕目标',
  arm: '实际手腕和手臂',
  contact: '接触点和指尖',
  wristPath: '手腕轨迹',
  tilePath: '牌的轨迹',
};

export const GIZMO_COLORS: Record<GizmoKind, string> = {
  target: '#3fd0ff',
  arm: '#ff5fd2',
  contact: '#5dff8a',
  wristPath: '#3fd0ff',
  tilePath: '#ffc43d',
};

const ERROR_COLOR = '#ff4b3e';
const TIP_COLOR = '#ff8a3d';

export interface GizmoFrame {
  target: THREE.Vector3 | null; // 出牌动作这一刻想让手腕在的位置
  goal: THREE.Vector3; // IK 实际要去的位置（和休息位置按权重混合后）
  arm: { shoulder: THREE.Vector3; elbow: THREE.Vector3; wrist: THREE.Vector3; tip: THREE.Vector3 };
  contact: THREE.Vector3 | null;
}

function dot(color: string, r: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 16, 12),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  m.renderOrder = 1000;
  return m;
}

function line(color: string, points: number, opacity = 1): THREE.Line {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }));
  l.renderOrder = 999;
  l.frustumCulled = false;
  return l;
}

function setLine(l: THREE.Line, pts: THREE.Vector3[]): void {
  const attr = l.geometry.getAttribute('position') as THREE.BufferAttribute;
  pts.forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
  attr.needsUpdate = true;
  l.geometry.setDrawRange(0, pts.length);
}

const PATH_SAMPLES = 160;

export class Gizmos {
  readonly group = new THREE.Group();
  private parts: Record<GizmoKind, THREE.Group>;
  private target = dot(GIZMO_COLORS.target, 0.16);
  private goal = dot(ERROR_COLOR, 0.07);
  private goalErr = line(ERROR_COLOR, 2);
  private wrist = dot(GIZMO_COLORS.arm, 0.14);
  private elbow = dot(GIZMO_COLORS.arm, 0.1);
  private armLine = line(GIZMO_COLORS.arm, 4, 0.9);
  private contact = dot(GIZMO_COLORS.contact, 0.13);
  private tip = dot(TIP_COLOR, 0.09);
  private contactErr = line(GIZMO_COLORS.contact, 2, 0.8);
  private wristPath = line(GIZMO_COLORS.wristPath, PATH_SAMPLES + 1, 0.7);
  private tilePath = line(GIZMO_COLORS.tilePath, PATH_SAMPLES + 1, 0.8);

  constructor(parent: THREE.Object3D) {
    const group = (...objs: THREE.Object3D[]) => {
      const g = new THREE.Group();
      g.add(...objs);
      this.group.add(g);
      return g;
    };
    this.parts = {
      target: group(this.target, this.goal, this.goalErr),
      arm: group(this.wrist, this.elbow, this.armLine),
      contact: group(this.contact, this.tip, this.contactErr),
      wristPath: group(this.wristPath),
      tilePath: group(this.tilePath),
    };
    parent.add(this.group);
  }

  show(kind: GizmoKind, on: boolean): void {
    this.parts[kind].visible = on;
  }

  // 整个出牌过程中手腕和牌走过的路线（按参数从头算一遍，不依赖播到哪了）
  setPaths(p: DiscardParams, path: DiscardPath): void {
    const total = totalTime(p, path.hold);
    const wrist: THREE.Vector3[] = [];
    const tile: THREE.Vector3[] = [];
    for (let i = 0; i <= PATH_SAMPLES; i++) {
      const pose = sampleDiscard(p, path, (i / PATH_SAMPLES) * total);
      wrist.push(pose.wrist);
      tile.push(pose.tilePos);
    }
    setLine(this.wristPath, wrist);
    setLine(this.tilePath, tile);
  }

  update(f: GizmoFrame): void {
    this.target.visible = !!f.target;
    if (f.target) this.target.position.copy(f.target);
    this.goal.position.copy(f.goal);
    setLine(this.goalErr, [f.goal, f.arm.wrist]);
    this.wrist.position.copy(f.arm.wrist);
    this.elbow.position.copy(f.arm.elbow);
    setLine(this.armLine, [f.arm.shoulder, f.arm.elbow, f.arm.wrist, f.arm.tip]);
    this.tip.position.copy(f.arm.tip);
    this.contact.visible = !!f.contact;
    this.contactErr.visible = !!f.contact;
    if (f.contact) {
      this.contact.position.copy(f.contact);
      setLine(this.contactErr, [f.contact, f.arm.tip]);
    }
  }
}

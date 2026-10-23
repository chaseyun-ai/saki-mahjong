import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BASE_AVATAR_SCALE } from '../ui3d/tableLayout';
import { DiscardPath } from '../ui3d/discardMotion';
import { Table3D } from '../ui3d/table3d';

// 调试场景的机位：游戏视角就是正式牌局的镜头；侧面、俯视可以用鼠标拖动旋转、滚轮缩放；
// 跟手始终对着手腕。离开游戏视角时自己座位的人改成第三人称，能看到整个人。

export type CameraMode = 'game' | 'side' | 'top' | 'follow';

export const CAMERA_LABELS: Record<CameraMode, string> = {
  game: '游戏视角',
  side: '侧面',
  top: '俯视',
  follow: '跟手',
};

const UP = new THREE.Vector3(0, 1, 0);

export class LabCamera {
  mode: CameraMode = 'game';
  private controls: OrbitControls;
  private follow = new THREE.Vector3();
  private following = false;

  constructor(private table: Table3D) {
    this.controls = new OrbitControls(table.camera, table.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enabled = false;
  }

  dispose(): void {
    this.controls.dispose();
  }

  // 换机位：按这次出牌的路线摆镜头
  set(mode: CameraMode, path: DiscardPath | null): void {
    this.mode = mode;
    const cam = this.table.camera;
    this.table.debugCamera = mode !== 'game';
    this.table.setFirstPerson(mode === 'game');
    this.controls.enabled = mode === 'side' || mode === 'top';
    this.following = false;
    if (mode === 'game' || !path) return;
    const center = path.from.clone().lerp(path.to, 0.5).setY(1.5);
    const side = new THREE.Vector3().crossVectors(UP, path.toward).normalize();
    // 人物放大时镜头跟着拉远
    const k = this.table.dims.scale / BASE_AVATAR_SCALE;
    if (mode === 'side') cam.position.copy(center).addScaledVector(side, 26 * k).addScaledVector(UP, 9 * k).addScaledVector(path.toward, -1);
    else if (mode === 'top') cam.position.copy(center).addScaledVector(UP, 26 * k).addScaledVector(path.toward, 7);
    this.controls.target.copy(center);
    if (mode === 'follow') {
      this.following = true;
      this.follow.copy(side).multiplyScalar(5 * k).addScaledVector(UP, 4 * k).addScaledVector(path.toward, 5 * k);
      return;
    }
    cam.lookAt(center);
    this.controls.update();
  }

  // 每帧：跟手时镜头跟着手腕走
  update(wrist: THREE.Vector3 | null): void {
    if (!this.following || !wrist) return;
    const cam = this.table.camera;
    cam.position.copy(wrist).add(this.follow);
    cam.lookAt(wrist);
  }
}

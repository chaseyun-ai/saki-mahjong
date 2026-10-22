import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// 开局的两颗骰子：从上方抛下，翻滚几下停在控制台上，点数朝上。

const SIZE = 0.85;
const ROLL_TIME = 1.1;

// BoxGeometry 六个面的顺序是 +x -x +y -y +z -z，对面点数相加为 7
const FACE_VALUES = [3, 4, 1, 6, 2, 5];

// 把点数 v 那一面转到朝上
const UP_ROTATION: Record<number, THREE.Euler> = {
  1: new THREE.Euler(0, 0, 0),
  6: new THREE.Euler(Math.PI, 0, 0),
  2: new THREE.Euler(-Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI / 2, 0, 0),
  3: new THREE.Euler(0, 0, Math.PI / 2),
  4: new THREE.Euler(0, 0, -Math.PI / 2),
};

const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

function faceTexture(v: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f7f3ea';
  ctx.fillRect(0, 0, 128, 128);
  // 一点和四点按传统用红色
  ctx.fillStyle = v === 1 || v === 4 ? '#c4212c' : '#1d1f33';
  const r = v === 1 ? 20 : 11;
  for (const [x, y] of PIPS[v]) {
    ctx.beginPath();
    ctx.arc(64 + x * 32, 64 + y * 32, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Die {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  final: THREE.Quaternion;
  spinAxis: THREE.Vector3;
}

export class Dice {
  readonly group = new THREE.Group();
  private dice: Die[] = [];
  private t = -1;
  private hideAt = Infinity;

  constructor(private surfaceY: number) {
    const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 3, 0.12);
    const mats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35 }));
    for (let i = 0; i < 2; i++) {
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.dice.push({
        mesh,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        final: new THREE.Quaternion(),
        spinAxis: new THREE.Vector3(),
      });
    }
    this.group.visible = false;
  }

  get duration(): number {
    return ROLL_TIME;
  }

  // 掷出指定点数；hideAfter 秒后收起
  roll(values: [number, number], hideAfter: number): void {
    this.dice.forEach((d, i) => {
      const side = i === 0 ? -1 : 1;
      d.to.set(side * 0.75 + (Math.random() - 0.5) * 0.3, this.surfaceY + SIZE / 2, (Math.random() - 0.5) * 0.6);
      d.from.set(side * 2.4, this.surfaceY + 5, 3 + Math.random());
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.2);
      d.final.copy(yaw.multiply(new THREE.Quaternion().setFromEuler(UP_ROTATION[values[i]])));
      d.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    });
    this.t = 0;
    this.hideAt = hideAfter;
    this.group.visible = true;
    this.update(0);
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t > this.hideAt) {
      this.group.visible = false;
      this.t = -1;
      return;
    }
    const k = Math.min(1, this.t / ROLL_TIME);
    // 落地后弹两下
    const bounce = Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * (1 - k) * 2.2;
    for (const d of this.dice) {
      const ease = 1 - (1 - k) * (1 - k);
      d.mesh.position.lerpVectors(d.from, d.to, ease);
      d.mesh.position.y = THREE.MathUtils.lerp(d.from.y, d.to.y, Math.min(1, k * 2.2)) + bounce;
      const spin = new THREE.Quaternion().setFromAxisAngle(d.spinAxis, (1 - k) * (1 - k) * 14);
      d.mesh.quaternion.copy(spin.multiply(d.final));
    }
  }
}

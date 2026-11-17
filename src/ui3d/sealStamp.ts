import * as THREE from 'three';
import { CONSOLE_TOP, SEAL_SIZE, drawSeal } from './consoleLooks';

// 原木：和了一局，一个小朱印从镜头这边朝仪表盘上那家点数旁边按下去，“嗒”地盖上，四周一圈印泥的红晕散开。
// 印顺着视线过来，画面上一直在要盖的那个位置，只是越按越小（直着往下落的话 2.5D 从上往下看会斜着滑过整块仪表盘）。
// 印在半空的时候仪表盘贴图上先不画它，落地那一刻（update 交出来）才画进去，按下去的印正好盖在贴图上那个印的位置
const DROP = 0.24; // 按下去要多久（秒）：越按越快
const REACH = 0.3; // 从多远开始按：落点到镜头这段距离的几成
const GROW = 1; // 刚出现时比落地时大多少
const RING = 0.45; // 落地以后那一圈红晕散多久
const RING_GROW = 1.3;

// 贴图 512 坐标换成桌面上的长度
const UNIT = (CONSOLE_TOP * 2) / 512;
// 印的贴图四周留一点空，免得边上被采样截掉
const PAD = 1;
const TEX = 128;

interface Stamp {
  seat: number;
  n: number; // 落地以后这家一共几个印
  at: number;
  spot: THREE.Vector3; // 落点
  seal: THREE.Mesh;
  ring: THREE.Mesh;
  landed: boolean;
}

export class SealStamps {
  readonly group = new THREE.Group();
  private list: Stamp[] = [];
  private canvas = document.createElement('canvas');
  private tex = new THREE.CanvasTexture(this.canvas);
  private sealGeo: THREE.PlaneGeometry;
  private ringGeo: THREE.RingGeometry;
  private drawn = false;
  private toEye = new THREE.Vector3();

  // glow：仪表盘顶面自发光有多强（印的材质照它，落地时和贴图上画的那个看起来一样）
  constructor(private glow: number) {
    this.canvas.width = TEX;
    this.canvas.height = TEX;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const w = (SEAL_SIZE + PAD * 2) * UNIT;
    this.sealGeo = new THREE.PlaneGeometry(w, w).rotateX(-Math.PI / 2);
    // 方框：四段的圆环，从 45° 起，四个角正好是方块的四个角
    const half = (SEAL_SIZE / 2) * UNIT;
    this.ringGeo = new THREE.RingGeometry((half + 0.01) * Math.SQRT2, (half + 0.06) * Math.SQRT2, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);
  }

  // 还在半空（没落地）的印有几个
  pending(seat: number): number {
    return this.list.filter((s) => s.seat === seat && !s.landed).length;
  }

  // 排一个印：at 秒开始落，落到贴图坐标 (x, y)、转 rot（画布上顺时针为正），top 是仪表盘顶面的高度
  add(seat: number, n: number, at: number, spot: { x: number; y: number; rot: number }, top: number): void {
    // 字体在第一次盖印时早就下载好了，这时候才画贴图
    if (!this.drawn) {
      const c = this.canvas.getContext('2d')!;
      const k = TEX / (SEAL_SIZE + PAD * 2);
      c.setTransform(k, 0, 0, k, TEX / 2, TEX / 2);
      drawSeal(c);
      this.tex.needsUpdate = true;
      this.drawn = true;
    }
    const at3 = new THREE.Vector3((spot.x / 512 - 0.5) * CONSOLE_TOP * 2, top, (spot.y / 512 - 0.5) * CONSOLE_TOP * 2);
    const seal = new THREE.Mesh(
      this.sealGeo,
      new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.2, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: this.glow, transparent: true, depthWrite: false }),
    );
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#b5371c', transparent: true, opacity: 0, depthWrite: false }));
    // 贴图往下是 +z：画布上顺时针转，桌面上（从上往下看）也是顺时针，绕 y 轴是负的
    for (const m of [seal, ring]) {
      m.rotation.y = -spot.rot;
      m.position.copy(at3);
      m.visible = false;
    }
    ring.position.y += 0.002;
    seal.renderOrder = 2;
    this.group.add(ring, seal);
    this.list.push({ seat, n, at, spot: at3, seal, ring, landed: false });
  }

  // 每帧摆一次（eye：镜头在哪）；交出这一帧刚落地的印（外面把它画进仪表盘、响一声）
  update(now: number, eye: THREE.Vector3): { seat: number; n: number }[] {
    const hit: { seat: number; n: number }[] = [];
    for (const s of this.list) {
      const t = now - s.at;
      if (t < 0) continue;
      const seal = s.seal.material as THREE.MeshStandardMaterial;
      const ring = s.ring.material as THREE.MeshBasicMaterial;
      if (t < DROP) {
        const e = (t / DROP) ** 2;
        s.seal.visible = true;
        s.seal.position.copy(s.spot).add(this.toEye.subVectors(eye, s.spot).multiplyScalar(REACH * (1 - e)));
        s.seal.scale.setScalar(1 + GROW * (1 - e));
        seal.opacity = Math.min(1, t / 0.06);
        continue;
      }
      if (!s.landed) {
        s.landed = true;
        hit.push({ seat: s.seat, n: s.n });
        // 贴图上已经画上了，半空那个收掉
        s.seal.visible = false;
        s.ring.visible = true;
      }
      const u = Math.min(1, (t - DROP) / RING);
      s.ring.scale.setScalar(1 + RING_GROW * (1 - (1 - u) ** 3));
      ring.opacity = 0.7 * (1 - u) ** 2;
    }
    this.list = this.list.filter((s) => {
      if (now - s.at < DROP + RING) return true;
      this.drop(s);
      return false;
    });
    return hit;
  }

  clear(): void {
    for (const s of this.list) this.drop(s);
    this.list = [];
  }

  dispose(): void {
    this.clear();
    this.sealGeo.dispose();
    this.ringGeo.dispose();
    this.tex.dispose();
  }

  private drop(s: Stamp): void {
    for (const m of [s.seal, s.ring]) {
      this.group.remove(m);
      (m.material as THREE.Material).dispose();
    }
  }
}

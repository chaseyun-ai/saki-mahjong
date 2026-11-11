import * as THREE from 'three';

// 天江衣的海底捞月：捞上来的那张牌背后的一轮月亮（月相照今晚的月亮），和从海面照上来的一道月光。
// 牌从月亮的倒影里浮上来，倒影没了，月亮跟着牌到了半空：月亮被她从海里捞走了。
// 两样都是发亮的片，一直朝着镜头；不挡牌（画在牌后面一点）

const N = 256;
// 月面占整张图的多大（外面留给光晕）
const DISC = 0.42;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 一小块值噪声，画月海用
function noise(x: number, y: number): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

// phase：0 新月 … 0.5 满月 … 接近 1 残月（和水面倒影同一个数）
function moonTexture(phase: number): THREE.DataTexture {
  const data = new Uint8Array(N * N * 4);
  const p = phase - Math.floor(phase);
  const c = Math.cos(p * Math.PI * 2);
  const side = p <= 0.5 ? 1 : -1;
  const thin = p < 0.07 || p > 0.93;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N - 0.5) / (DISC / 2);
      const y = ((j + 0.5) / N - 0.5) / (DISC / 2);
      const r = Math.hypot(x, y);
      const disc = smooth(1, 0.96, r);
      const edge = Math.sqrt(Math.max(0, 1 - y * y));
      const lit = smooth(-0.07, 0.07, side * x - c * edge);
      const maria = 0.58 + 0.42 * smooth(0.35, 0.65, noise(x * 2.6 + 4.1, y * 2.6 + 4.1));
      const limb = 0.78 + 0.22 * Math.sqrt(Math.max(0, 1 - r * r));
      const rim = thin ? smooth(0.84, 0.95, r) * disc * 0.5 : 0;
      // 光晕：贴着月面一圈亮，往外很快淡掉；亮的那一侧更亮
      const glow = (Math.exp(-Math.max(0, r - 0.95) * 3.2) * 0.34 + Math.exp(-r * r * 0.5) * 0.1) * (0.35 + 0.65 * Math.max(lit, thin ? 0.3 : 0.12)) * smooth(2.38, 1.6, r);
      const v = Math.min(1, disc * (0.16 + 0.84 * lit) * maria * limb + rim + glow * (1 - disc * 0.6));
      const o = (j * N + i) * 4;
      data[o] = Math.round(255 * v * 0.86);
      data[o + 1] = Math.round(255 * v * 0.93);
      data[o + 2] = Math.round(255 * v);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 月光：中间亮、两边柔，底下（海面）最亮，往上慢慢淡掉
function beamTexture(): THREE.DataTexture {
  const w = 64, h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = (i + 0.5) / w - 0.5;
      const y = (j + 0.5) / h;
      const v = Math.exp(-x * x * 26) * (0.25 + 0.75 * (1 - y) ** 1.6) * smooth(0, 0.06, y) * smooth(1, 0.7, y) * smooth(0.5, 0.36, Math.abs(x));
      const o = (j * w + i) * 4;
      data[o] = Math.round(255 * v * 0.8);
      data[o + 1] = Math.round(255 * v * 0.9);
      data[o + 2] = Math.round(255 * v);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export class MoonLift {
  readonly group = new THREE.Group();
  private halo: THREE.Sprite;
  private beam: THREE.Mesh;
  private haloMat: THREE.SpriteMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private phase = -1;

  constructor() {
    // 滤色叠加（底色越亮加得越少）：月亮压在深色的海面上是亮的，后面有牌河的地方不会被照成一片白。
    // 这种叠法不看透明度，月亮的明暗用 color 调
    this.haloMat = new THREE.SpriteMaterial({
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.OneFactor,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      fog: false,
    });
    this.haloMat.color.setScalar(0);
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.renderOrder = 3;
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false, fog: false });
    // 底边在原点、往上长的一片
    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), this.beamMat);
    this.beam.renderOrder = 2;
    this.group.add(this.beam, this.halo);
    this.group.visible = false;
  }

  // tile：牌现在在哪；size：月面的直径（世界单位）；glow：月亮多亮（0 藏起来）；
  // foot：月光从哪（海面上那一点）照上来，beam：月光多亮
  set(tile: THREE.Vector3, size: number, glow: number, foot: THREE.Vector3, beam: number, phase: number, camera: THREE.Camera): void {
    this.group.visible = glow > 0.002 || beam > 0.002;
    if (!this.group.visible) return;
    if (phase !== this.phase) {
      this.haloMat.map?.dispose();
      this.haloMat.map = moonTexture(phase);
      this.haloMat.needsUpdate = true;
      this.phase = phase;
    }
    const cam = camera.getWorldPosition(new THREE.Vector3());
    // 月亮在牌后面一点（顺着视线往远处挪），牌压在月面上
    const away = tile.clone().sub(cam).normalize();
    this.halo.position.copy(tile).addScaledVector(away, 0.9);
    this.halo.scale.setScalar(size / DISC);
    this.haloMat.color.setScalar(Math.min(1, glow) * 0.92);
    // 月光：竖着的一片，绕竖轴转到朝着镜头
    const top = Math.max(tile.y + 1.2, foot.y + 2);
    this.beam.position.copy(foot);
    this.beam.scale.set(size * 0.9, top - foot.y + 5, 1);
    this.beam.rotation.y = Math.atan2(cam.x - foot.x, cam.z - foot.z);
    this.beamMat.opacity = Math.min(1, beam) * 0.55;
  }

  hide(): void {
    this.group.visible = false;
    this.haloMat.color.setScalar(0);
    this.beamMat.opacity = 0;
  }

  dispose(): void {
    this.haloMat.map?.dispose();
    this.haloMat.dispose();
    this.beamMat.map?.dispose();
    this.beamMat.dispose();
    this.beam.geometry.dispose();
  }
}

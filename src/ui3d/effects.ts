import * as THREE from 'three';

// 牌桌上的特效：冲击波圆环、光柱、闪光粒子。都是加法混合的半透明网格，播完自己移除。

interface Effect {
  obj: THREE.Object3D;
  t: number;
  duration: number;
  update: (k: number) => void;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 光柱：上下渐隐
function pillarTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const additive = (color: THREE.ColorRepresentation, map?: THREE.Texture) =>
  new THREE.MeshBasicMaterial({
    color,
    ...(map ? { map } : {}),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

export class Effects {
  private list: Effect[] = [];
  private glow = glowTexture();
  private pillar = pillarTexture();

  constructor(private scene: THREE.Scene) {}

  private add(obj: THREE.Object3D, duration: number, update: (k: number) => void): void {
    this.scene.add(obj);
    this.list.push({ obj, t: 0, duration, update });
    update(0);
  }

  // 贴着桌面向外扩散的圆环
  ring(at: THREE.Vector3, color: THREE.ColorRepresentation, radius = 6, duration = 0.7): void {
    const mat = additive(color);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(at).setY(at.y + 0.05);
    this.add(mesh, duration, (k) => {
      const e = 1 - (1 - k) * (1 - k);
      mesh.scale.setScalar(0.3 + e * radius);
      mat.opacity = (1 - k) * 0.9;
    });
  }

  // 从桌面升起的光柱
  beam(at: THREE.Vector3, color: THREE.ColorRepresentation, height = 14, duration = 1.4): void {
    const mat = additive(color, this.pillar);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, height, 32, 1, true), mat);
    mesh.position.copy(at).setY(at.y + height / 2);
    this.add(mesh, duration, (k) => {
      mesh.scale.set(1 + k * 0.4, Math.min(1, k * 5), 1 + k * 0.4);
      mat.opacity = (k < 0.2 ? k * 5 : (1 - k) * 1.25) * 0.6;
      mesh.rotation.y = k * 2;
    });
  }

  // 一团向上飘散的闪光
  sparkles(at: THREE.Vector3, color: THREE.ColorRepresentation, count = 40, spread = 4, duration = 1.6): void {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      vel.push(new THREE.Vector3(Math.cos(a) * r, 3 + Math.random() * 6, Math.sin(a) * r));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      map: this.glow,
      size: 0.9,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.position.copy(at);
    this.add(pts, duration, (k) => {
      for (let i = 0; i < count; i++) {
        const v = vel[i];
        pos[i * 3] = v.x * k;
        pos[i * 3 + 1] = v.y * k - 3 * k * k;
        pos[i * 3 + 2] = v.z * k;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - k * k;
      mat.size = 0.9 * (1 - k * 0.5);
    });
  }

  // 一闪而过的光晕
  flash(at: THREE.Vector3, color: THREE.ColorRepresentation, size = 8, duration = 0.45): void {
    const mat = new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at);
    this.add(sprite, duration, (k) => {
      sprite.scale.setScalar(size * (0.5 + k));
      mat.opacity = 1 - k;
    });
  }

  update(dt: number): void {
    this.list = this.list.filter((e) => {
      e.t += dt;
      const k = Math.min(1, e.t / e.duration);
      e.update(k);
      if (k >= 1) {
        this.scene.remove(e.obj);
        const m = e.obj as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose();
        return false;
      }
      return true;
    });
  }
}

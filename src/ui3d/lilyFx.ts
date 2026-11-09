import * as THREE from 'three';

// 宫永咲的岭上开花：岭上牌砸到桌上的那一下，牌顶上开出一朵百合（六片花被往外翻卷、六根雄蕊顶着橙色花药、中间一根柱头），
// 接着花瓣从花里迸出来，一片片打着转、晃悠悠飘落到牌桌上，再慢慢谢掉。
// 和得越大花瓣越多（lilyCount，看基本点）：花开得越大，倍满起花瓣卷成一道往上旋的花柱，役满起整张牌桌上空还下一场花瓣雨。
// 花瓣是一张 InstancedMesh（一种弯弯的、尖头往后翻的百合花瓣形状），每帧在 CPU 上算位置和转动，几百片也很轻。

// 基本点 → 花瓣片数：1 番 30 符约 40 片、满贯约 135、倍满约 215、役满 360，两倍役满封顶约 600
export function lilyCount(base: number): number {
  const b = Math.min(Math.max(base, 0), 16000);
  return Math.round(24 + 336 * (b / 8000) ** 0.8);
}

// 0（小和）到 1（两倍役满）：花开多大、花柱、花瓣雨（音效也跟着）
export function lilyGrand(base: number): number {
  const b = Math.min(Math.max(base, 240), 16000);
  return Math.log(b / 240) / Math.log(16000 / 240);
}

export interface LilyOpts {
  at: THREE.Vector3; // 花开在哪（牌顶上）
  face: THREE.Vector3; // 花朝哪开（一般朝着镜头、偏上）
  base: number; // 这一手的基本点（WinResult.base）
  scale?: number; // 牌的大小
  area?: number; // 花瓣雨洒多大一片（牌桌半宽）
  inward?: THREE.Vector3; // 往牌桌中间的方向（水平）：花瓣往这边飘，不往镜头上糊
}

interface Petal {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  axis: THREE.Vector3; // 自转轴
  spin: number; // 自转多快（弧度/秒）
  phase: number;
  sway: number; // 左右晃多大
  size: number;
  born: number;
  life: number;
  landed: boolean;
  swirl: number; // 绕着花打转的劲
  tint: THREE.Color;
}

const MAX_PETALS = 720;
const GRAVITY = 2.6;
const DRAG = 2.4;
const LIE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

// 花瓣的形状：沿 +y 长、x 方向宽，根部窄、四成处最宽、尖头；正面是 -z：横截面中间凹（花瓣中肋，两边往正面翘），越往尖越往背面（+z）翻卷
function petalGeometry(len: number, wid: number, curl: number, groove: number): THREE.BufferGeometry {
  const nu = 14;
  const nv = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const w = wid * Math.sin(Math.PI * u ** 0.72) ** 0.85;
    for (let j = 0; j <= nv; j++) {
      const v = (j / nv) * 2 - 1;
      const x = v * w;
      const y = u * len;
      const z = -groove * v * v * w + curl * u ** 2.2 * len + 0.04 * Math.sin(v * 3 + u * 9) * u * wid;
      pos.push(x, y, z);
      uv.push(j / nv, u);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 花瓣的颜色：根部带一点黄绿，往上是白，尖上一点点粉；中间一道淡淡的中肋，根部几颗小斑点
function petalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, '#c9dc86');
  g.addColorStop(0.2, '#eef3d2');
  g.addColorStop(0.45, '#fbfaf4');
  g.addColorStop(0.8, '#fbf1f3');
  g.addColorStop(1, '#f6d3de');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 256);
  // 中肋
  const rib = x.createLinearGradient(0, 256, 0, 40);
  rib.addColorStop(0, 'rgba(170,200,110,0.55)');
  rib.addColorStop(1, 'rgba(220,230,200,0)');
  x.fillStyle = rib;
  x.fillRect(29, 40, 6, 216);
  // 几道脉纹
  x.strokeStyle = 'rgba(200,215,170,0.25)';
  x.lineWidth = 1;
  for (const dx of [-14, -7, 7, 14]) {
    x.beginPath();
    x.moveTo(32 + dx * 0.3, 250);
    x.quadraticCurveTo(32 + dx, 140, 32 + dx * 0.6, 40);
    x.stroke();
  }
  // 根部的小斑点（淡淡的粉）
  x.fillStyle = 'rgba(226,120,150,0.35)';
  for (let i = 0; i < 14; i++) {
    const px = 32 + (Math.sin(i * 12.9898) * 0.5) * 30;
    const py = 200 - (Math.abs(Math.sin(i * 78.233)) * 70);
    x.beginPath();
    x.arc(px, py, 1.3, 0, Math.PI * 2);
    x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,250,235,0.6)');
  g.addColorStop(1, 'rgba(255,240,220,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Bloom {
  group: THREE.Group;
  tepals: THREE.Mesh[];
  stamens: THREE.Group;
  glow: THREE.Sprite;
  born: number;
  size: number;
  fall: number; // 花被一片片脱落、变成飞的花瓣的时刻（相对 born）
  shed: boolean;
  grand: number;
  origin: THREE.Vector3;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const TINTS = ['#ffffff', '#fff7fa', '#fffbf0', '#fdf2f6', '#ffffff'].map((c) => new THREE.Color(c));

export class LilyFx {
  readonly group = new THREE.Group();
  private now = 0;
  private petals: Petal[] = [];
  private mesh: THREE.InstancedMesh | null = null;
  private mat: THREE.MeshStandardMaterial | null = null;
  private petalGeo: THREE.BufferGeometry | null = null;
  private tepalGeo: THREE.BufferGeometry | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private glowTex: THREE.CanvasTexture | null = null;
  private blooms: Bloom[] = [];
  // 还没发出去的花瓣：[时刻, 怎么发]
  private queue: { at: number; fn: () => void }[] = [];
  private dummy = new THREE.Object3D();
  private center = new THREE.Vector3();
  private inward = new THREE.Vector3();

  // 还要多久才放完（秒）
  get remaining(): number {
    let end = this.now;
    for (const p of this.petals) end = Math.max(end, p.born + p.life);
    for (const q of this.queue) end = Math.max(end, q.at + 6);
    for (const b of this.blooms) end = Math.max(end, b.born + b.fall + 6);
    return Math.max(0, end - this.now);
  }

  private ensure(): void {
    if (this.mesh) return;
    this.tex = petalTexture();
    this.glowTex = glowTexture();
    this.petalGeo = petalGeometry(1, 0.34, 0.28, 0.35);
    this.tepalGeo = petalGeometry(1, 0.3, 0.55, 0.45);
    // 颜色压一点，不然在聚光灯和 ACES 下整片白成一团，看不出花瓣的弯
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, color: '#e9e4e6', side: THREE.DoubleSide, roughness: 0.6, emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 0.1 });
    this.mesh = new THREE.InstancedMesh(this.petalGeo, this.mat, MAX_PETALS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color('#ffffff'));
    this.group.add(this.mesh);
  }

  // 开一朵：花在 at 开出来，花瓣按这一手多大迸出来、飘下来
  bloom(o: LilyOpts): void {
    this.ensure();
    const s = o.scale ?? 1;
    const grand = lilyGrand(o.base);
    const total = lilyCount(o.base);
    const size = (0.85 + 0.95 * grand) * s;
    const face = o.face.clone().normalize();
    const inward = o.inward?.clone().setY(0).normalize() ?? new THREE.Vector3();
    this.inward.copy(inward);
    // 花开在牌顶上方一点，开着开着往上浮（自己的牌在画面最底下，花不会被画面底边切掉）
    const at = o.at.clone().add(new THREE.Vector3(0, 0.35 * s, 0)).addScaledVector(inward, 0.4 * s);
    this.center.copy(at);
    const b = this.makeFlower(at, face, size, grand);
    this.blooms.push(b);
    const t0 = this.now;
    // 花开的一下先迸出一半，剩下的接着从花心一股股往上冒；花被脱落时再添六片大的
    const first = Math.round(total * (grand > 0.6 ? 0.35 : 0.5));
    const stream = total - first;
    this.queue.push({ at: t0 + 0.08, fn: () => this.burst(at, inward, first, s, grand) });
    const streamTime = 0.6 + 1.2 * grand;
    const puffs = Math.max(1, Math.round(streamTime / 0.06));
    for (let i = 0; i < puffs; i++) {
      const n = Math.round(((i + 1) * stream) / puffs) - Math.round((i * stream) / puffs);
      if (n > 0) this.queue.push({ at: t0 + 0.25 + (i * streamTime) / puffs, fn: () => this.rise(at, n, s, grand) });
    }
    // 役满起：整张牌桌上空下一场花瓣雨（算在总数里）
    if (grand > 0.85 && o.area) {
      const rain = Math.round(total * 0.3);
      for (let i = 0; i < 12; i++) this.queue.push({ at: t0 + 0.5 + i * 0.18, fn: () => this.rain(o.area!, Math.round(rain / 12), s) });
    }
  }

  clear(): void {
    this.petals = [];
    this.queue = [];
    for (const b of this.blooms) this.dropFlower(b);
    this.blooms = [];
    if (this.mesh) this.mesh.count = 0;
  }

  dispose(): void {
    this.clear();
    this.petalGeo?.dispose();
    this.tepalGeo?.dispose();
    this.mat?.dispose();
    this.tex?.dispose();
    this.glowTex?.dispose();
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.mesh = null;
  }

  // ---------- 花 ----------

  private makeFlower(at: THREE.Vector3, face: THREE.Vector3, size: number, grand: number): Bloom {
    const group = new THREE.Group();
    group.position.copy(at);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), face);
    group.scale.setScalar(0.001);
    const tepals: THREE.Mesh[] = [];
    for (let i = 0; i < 6; i++) {
      const outer = i % 2 === 0;
      const m = new THREE.Mesh(this.tepalGeo!, this.mat!);
      // 花被的根在花心，往外长；外三片宽一点、里三片窄一点
      m.scale.set(outer ? 1.08 : 0.9, outer ? 1 : 1.04, 1);
      m.userData.yaw = (i * Math.PI) / 3 + (outer ? 0 : 0.05);
      m.userData.outer = outer;
      group.add(m);
      tepals.push(m);
    }
    // 雄蕊：六根细丝顶着橙褐色的花药；柱头一根，顶上三裂
    const stamens = new THREE.Group();
    const filament = new THREE.MeshStandardMaterial({ color: '#e9f0c8', emissive: '#e9f0c8', emissiveIntensity: 0.25, roughness: 0.6 });
    const anther = new THREE.MeshStandardMaterial({ color: '#c85a1c', emissive: '#a8420e', emissiveIntensity: 0.35, roughness: 0.7 });
    const stigma = new THREE.MeshStandardMaterial({ color: '#cfe08a', emissive: '#a9c060', emissiveIntensity: 0.3, roughness: 0.6 });
    const fil = new THREE.CylinderGeometry(0.012, 0.016, 0.62, 5);
    fil.translate(0, 0.31, 0);
    const anth = new THREE.CapsuleGeometry(0.035, 0.11, 3, 6);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + 0.5;
      const stem = new THREE.Group();
      stem.rotation.order = 'YXZ';
      stem.rotation.set(0.34, a, 0);
      const f = new THREE.Mesh(fil, filament);
      const h = new THREE.Mesh(anth, anther);
      h.position.y = 0.64;
      h.rotation.z = Math.PI / 2;
      stem.add(f, h);
      stamens.add(stem);
    }
    const pistil = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.72, 5).translate(0, 0.36, 0), stigma);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), stigma);
    tip.position.y = 0.74;
    stamens.add(pistil, tip);
    stamens.userData.mats = [filament, anther, stigma];
    group.add(stamens);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex!, color: '#fff3d6', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    glow.position.y = 0.1;
    group.add(glow);
    this.group.add(group);
    return { group, tepals, stamens, glow, born: this.now, size, fall: 1.15 + 0.9 * grand, shed: false, grand, origin: at.clone() };
  }

  private dropFlower(b: Bloom): void {
    this.group.remove(b.group);
    for (const m of b.stamens.userData.mats as THREE.Material[]) m.dispose();
    b.stamens.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    b.glow.material.dispose();
  }

  private animateFlower(b: Bloom): boolean {
    const k = this.now - b.born;
    // 0.38 秒开到最大（稍微张过头再回来），之后慢慢转、轻轻呼吸
    const open = k < 0.38 ? 1 - (1 - k / 0.38) ** 3 : 1;
    const over = k < 0.6 ? Math.sin(Math.PI * Math.min(1, k / 0.6)) * 0.12 : 0;
    const grow = Math.min(1, k / 0.22);
    const breathe = 1 + 0.03 * Math.sin(k * 3.2);
    let fade = 1;
    if (k > b.fall) fade = Math.max(0, 1 - (k - b.fall) / 0.45);
    b.group.scale.setScalar(Math.max(0.001, b.size * (0.35 + 0.65 * (1 - (1 - grow) ** 2)) * breathe));
    b.group.position.copy(b.origin).add(new THREE.Vector3(0, 0.5 * b.size * (1 - Math.exp(-k * 1.5)), 0));
    b.group.rotateOnAxis(new THREE.Vector3(0, 1, 0), 0.004);
    for (const m of b.tepals) {
      const outer = m.userData.outer as boolean;
      // 从合着（贴着花心往上）张开到往外平摊、尖往后卷
      const pitch = (0.2 + (outer ? 1.18 : 1.08) * (open + over)) * (k > b.fall ? 1 + (k - b.fall) * 0.6 : 1);
      m.rotation.set(0, 0, 0);
      m.rotation.order = 'YXZ';
      m.rotation.y = m.userData.yaw as number;
      m.rotation.x = pitch;
      m.visible = fade > 0.02;
    }
    b.stamens.scale.setScalar(Math.max(0.001, Math.min(1, k / 0.3) * fade));
    const gl = b.glow.material;
    gl.opacity = (k < 0.1 ? k / 0.1 : Math.exp(-(k - 0.1) * 1.4) * 0.6 + 0.25) * fade;
    b.glow.scale.setScalar(2.4 + 0.6 * Math.sin(k * 4));
    // 花被脱落：每片花被变成一片飞走的大花瓣
    if (k > b.fall && !b.shed) {
      b.shed = true;
      b.group.updateMatrixWorld(true);
      for (const m of b.tepals) {
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const sc = new THREE.Vector3();
        m.matrixWorld.decompose(p, q, sc);
        const out = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(rand(1.5, 2.6));
        out.y += rand(1.2, 2.4);
        this.spawn(p, out, sc.y * 0.9, 0.2, q, rand(3.5, 5));
      }
    }
    if (fade <= 0) {
      this.dropFlower(b);
      return false;
    }
    return true;
  }

  // ---------- 花瓣 ----------

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, size: number, swirl: number, quat?: THREE.Quaternion, life?: number): void {
    if (this.petals.length >= MAX_PETALS) return;
    this.petals.push({
      pos: pos.clone(),
      vel: vel.clone(),
      quat: quat?.clone() ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.28), rand(0, 6.28), rand(0, 6.28))),
      axis: new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
      spin: rand(2, 6) * (Math.random() < 0.5 ? -1 : 1),
      phase: rand(0, 6.28),
      sway: rand(0.4, 1.1),
      size,
      born: this.now,
      life: life ?? rand(4.2, 6.2),
      landed: false,
      swirl,
      tint: TINTS[Math.floor(Math.random() * TINTS.length)],
    });
  }

  // 花开的一下：往上、往外迸开一圈，偏往牌桌中间（inward）
  private burst(at: THREE.Vector3, inward: THREE.Vector3, n: number, s: number, grand: number): void {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(rand(0.4, 1)).add(up.clone().multiplyScalar(rand(0.7, 1.6))).addScaledVector(inward, rand(0.2, 0.9));
      dir.normalize().multiplyScalar(rand(4, 8 + 5 * grand) * s);
      this.spawn(at.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2)).multiplyScalar(s)), dir, rand(0.32, 0.55) * s, rand(0.2, 0.6) * (0.4 + grand));
    }
  }

  // 从花心一股股往上冒，绕着花打着旋往上升（大的手升得高、旋得猛）
  private rise(at: THREE.Vector3, n: number, s: number, grand: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.2, 0.7) * s;
      const p = at.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(0.1, 0.4) * s, Math.sin(a) * r));
      const v = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(rand(1, 2.5) * s);
      v.y = rand(5, 8 + 9 * grand) * s;
      v.addScaledVector(this.inward, rand(0.5, 1.5) * s);
      this.spawn(p, v, rand(0.3, 0.52) * s, rand(0.8, 1.6) * (0.3 + grand * 1.4));
    }
  }

  // 花瓣雨：从牌桌上空飘下来
  private rain(area: number, n: number, s: number): void {
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(rand(-area, area), rand(9, 14), rand(-area, area));
      this.spawn(p, new THREE.Vector3(rand(-0.6, 0.6), -rand(0.3, 1), rand(-0.6, 0.6)), rand(0.36, 0.6) * s, 0, undefined, rand(5, 7));
    }
  }

  update(dt: number): void {
    this.now += dt;
    if (this.queue.length) {
      const due = this.queue.filter((q) => q.at <= this.now);
      this.queue = this.queue.filter((q) => q.at > this.now);
      for (const q of due) q.fn();
    }
    this.blooms = this.blooms.filter((b) => this.animateFlower(b));
    if (!this.mesh) return;
    const live: Petal[] = [];
    const tmpQ = new THREE.Quaternion();
    let n = 0;
    for (const p of this.petals) {
      const age = this.now - p.born;
      if (age > p.life) continue;
      live.push(p);
      if (!p.landed) {
        // 重力往下、空气阻力把速度压到很慢（花瓣是飘的），再左右晃、绕着花打旋
        p.vel.y -= GRAVITY * dt;
        p.vel.multiplyScalar(Math.exp(-DRAG * dt));
        const rx = p.pos.x - this.center.x;
        const rz = p.pos.z - this.center.z;
        const r = Math.hypot(rx, rz) + 0.6;
        const sw = (p.swirl * Math.exp(-age * 0.5)) / r;
        p.vel.x += -rz * sw * dt * 6;
        p.vel.z += rx * sw * dt * 6;
        // 往上冒的那几股旋起来以后还有一点上升的劲
        if (p.swirl > 0.6 && age < 1.2) p.vel.y += p.swirl * 2.2 * dt;
        const sway = Math.sin(age * 3.1 + p.phase) * p.sway;
        p.pos.addScaledVector(p.vel, dt);
        p.pos.x += Math.cos(p.phase) * sway * dt;
        p.pos.z += Math.sin(p.phase) * sway * dt;
        // 打着转：越慢的时候转得越像落叶那样翻
        tmpQ.setFromAxisAngle(p.axis, p.spin * dt);
        p.quat.premultiply(tmpQ);
        if (p.pos.y <= 0.02 && p.vel.y < 0) {
          // 落到桌上：平躺下来，随手转个方向
          p.landed = true;
          p.pos.y = 0.015;
          p.quat.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.phase * 3).multiply(LIE));
        }
      }
      // 最后 0.7 秒慢慢缩掉（谢了）
      const wither = Math.min(1, (p.life - age) / 0.7);
      const grow = Math.min(1, age / 0.12);
      this.dummy.position.copy(p.pos);
      this.dummy.quaternion.copy(p.quat);
      this.dummy.scale.setScalar(Math.max(0.001, p.size * wither * grow));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.mesh.setColorAt(n, p.tint);
      n++;
    }
    this.petals = live;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

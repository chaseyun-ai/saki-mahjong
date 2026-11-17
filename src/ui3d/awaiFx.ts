import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

// 大星淡三个主动技能挂在桌上的东西（2.5D、3D；2D 的简化版在 ui/app.ts 和 style.css）：
// - 高维领域：按下时一层暗紫的穹顶从她那边罩过整张桌子；桌面压暗、浮出一张慢慢扭动的发光网格（两层，像隔着一维看下去）；
//   桌子中央上方悬一个慢慢翻转的四维立方体线框，挂到这一局结束。别人的能力被压住、摸牌被挡掉的那一下，牌上闪一个紫色的封印
// - 加速驱动：另外三家的牌河上方各悬一个慢慢转的粉紫色准星，挂到这一局结束
// 引力波的波纹、加速驱动那一下的拉线是整幅画面的后期（warpFx.ts）；流星、闪光用 starFx.ts 和 effects.ts 现成的

const GRID_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const GRID_FRAG = /* glsl */ `
uniform float uTime;
uniform float uA;
uniform float uHalf;
uniform float uWave;
uniform vec2 uOrigin;
varying vec2 vP;
// 一张格子：q 是格子坐标，返回线有多亮（线宽不随远近变粗）
float grid(vec2 q) {
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
  return 1.0 - min(min(g.x, g.y), 1.0);
}
void main() {
  vec2 p = vP;
  float r = length(p) / uHalf;
  float e = max(abs(p.x), abs(p.y)) / uHalf;
  float edge = smoothstep(1.0, 0.93, e);
  float d = distance(p, uOrigin);
  float reveal = smoothstep(uWave, uWave - 2.5, d);
  float front = exp(-pow((d - uWave) / 0.9, 2.0)) * step(uWave, 900.0);
  // 格子慢慢扭：横线竖线各自像水草一样摆，整张网往桌心一呼一吸
  vec2 q = p;
  q.x += 0.45 * sin(p.y * 0.42 + uTime * 0.5) + 0.2 * sin(p.y * 0.95 - uTime * 0.37);
  q.y += 0.45 * sin(p.x * 0.42 - uTime * 0.43) + 0.2 * sin(p.x * 0.85 + uTime * 0.31);
  q *= 1.0 + 0.1 * sin(uTime * 0.35) * (1.0 - r);
  float a1 = grid(q / 1.55);
  // 第二层：斜着的、细一点的格子，扭得和第一层不同步，看着像在桌面底下更深的一层
  vec2 s = vec2(p.x + p.y, p.x - p.y) * 0.7071;
  s.x += 0.6 * sin(s.y * 0.3 - uTime * 0.28);
  s.y += 0.6 * sin(s.x * 0.3 + uTime * 0.22);
  s *= 1.0 - 0.14 * sin(uTime * 0.27 + 1.3) * (1.0 - r);
  float a2 = grid(s / 2.6);
  // 沿着线跑的光
  float run = 0.6 + 0.4 * sin(q.x * 0.9 + q.y * 0.7 - uTime * 1.6);
  vec3 glow = vec3(0.5, 0.3, 1.0) * a1 * 0.5 * run + vec3(0.25, 0.5, 1.0) * a2 * 0.22;
  glow += vec3(0.75, 0.55, 1.0) * front * 0.9;
  float dark = 0.5 * (0.75 + 0.25 * r);
  float a = reveal * edge * uA;
  // 预乘的混合：桌面压成暗紫，线和光加在上面
  gl_FragColor = vec4((vec3(0.035, 0.012, 0.09) * dark + glow) * a, dark * a);
}
`;

const DOME_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const DOME_FRAG = /* glsl */ `
uniform float uSweep; // 罩到哪了（沿 uDir 从 uOrigin 量）
uniform float uA;
uniform float uR;
uniform vec2 uOrigin;
uniform vec2 uDir;
uniform float uTime;
varying vec3 vW;
varying vec3 vN;
void main() {
  float along = dot(vW.xz - uOrigin, uDir);
  float lit = exp(-pow((along - uSweep) / (uR * 0.22), 2.0));
  float behind = smoothstep(uSweep, uSweep - uR * 0.7, along);
  // 经纬线
  float lon = atan(vW.z, vW.x) * 12.0 / 3.14159;
  float lat = asin(clamp(vW.y / uR, 0.0, 1.0)) * 16.0 / 3.14159;
  vec2 g = abs(fract(vec2(lon, lat) - 0.5) - 0.5) / max(fwidth(vec2(lon, lat)), vec2(1e-4));
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  // 正对镜头的地方淡，擦着边的地方亮：看得出是一层壳
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))), 1.5);
  float low = smoothstep(0.0, uR * 0.12, vW.y);
  vec3 col = vec3(0.42, 0.24, 1.0) * (line * 0.75 + 0.1 + rim * 0.5) * (lit * 1.2 + behind * 0.16);
  col += vec3(0.8, 0.65, 1.0) * lit * lit * (0.25 + line * 0.5);
  gl_FragColor = vec4(col * uA * low, 1.0);
}
`;

function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  c.translate(size / 2, size / 2);
  draw(c, size / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 封印：两圈环、八角星、中间一个「封」字
function sealTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (c, s) => {
    c.strokeStyle = '#c9a8ff';
    c.fillStyle = '#e8dcff';
    c.shadowColor = '#8a5cff';
    c.shadowBlur = 14;
    c.lineWidth = 5;
    c.beginPath();
    c.arc(0, 0, s * 0.86, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 2;
    c.beginPath();
    c.arc(0, 0, s * 0.74, 0, Math.PI * 2);
    c.stroke();
    for (let k = 0; k < 2; k++) {
      c.save();
      c.rotate((k * Math.PI) / 4);
      c.lineWidth = 3;
      c.strokeRect(-s * 0.5, -s * 0.5, s, s);
      c.restore();
    }
    for (let i = 0; i < 8; i++) {
      c.save();
      c.rotate((i * Math.PI) / 4 + Math.PI / 8);
      c.fillRect(-2, -s * 0.86, 4, s * 0.12);
      c.restore();
    }
    c.font = `bold ${Math.round(s * 0.62)}px "Noto Serif SC", "Songti SC", "SimSun", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('封', 0, s * 0.03);
  });
}

// 准星：一圈断开的环、里面一圈细环、四个朝里的刻度、正中一个小菱形
function reticleTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (c, s) => {
    c.shadowColor = '#ff5fc8';
    c.shadowBlur = 12;
    c.strokeStyle = '#ff9ae0';
    c.lineWidth = 6;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(0, 0, s * 0.82, (i * Math.PI) / 2 + 0.22, ((i + 1) * Math.PI) / 2 - 0.22);
      c.stroke();
    }
    c.strokeStyle = '#c9a0ff';
    c.lineWidth = 2;
    c.setLineDash([10, 9]);
    c.beginPath();
    c.arc(0, 0, s * 0.6, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#ffd0f0';
    for (let i = 0; i < 4; i++) {
      c.save();
      c.rotate((i * Math.PI) / 2);
      c.beginPath();
      c.moveTo(0, -s * 0.95);
      c.lineTo(s * 0.06, -s * 0.7);
      c.lineTo(-s * 0.06, -s * 0.7);
      c.fill();
      c.fillRect(-1.5, -s * 0.42, 3, s * 0.22);
      c.restore();
    }
    c.rotate(Math.PI / 4);
    c.fillRect(-s * 0.05, -s * 0.05, s * 0.1, s * 0.1);
  });
}

function haloTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (c, s) => {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, s);
    g.addColorStop(0, 'rgba(190,150,255,0.9)');
    g.addColorStop(0.35, 'rgba(120,80,255,0.35)');
    g.addColorStop(1, 'rgba(60,30,160,0)');
    c.fillStyle = g;
    c.fillRect(-s, -s, s * 2, s * 2);
  });
}

interface Seal {
  sprite: THREE.Sprite;
  t: number;
  delay: number;
  size: number;
}

// 四维立方体：16 个顶点（四个坐标各取 ±1），只差一个坐标的两点连一条棱，共 32 条
const TESS_EDGES: [number, number][] = [];
for (let i = 0; i < 16; i++) for (let b = 0; b < 4; b++) if (!(i & (1 << b))) TESS_EDGES.push([i, i | (1 << b)]);

export class AwaiFx {
  readonly group = new THREE.Group();
  private half: number;
  private scale: number;
  private t = 0;
  // 高维领域
  private domainOn = false;
  private domainA = 0;
  private wave = 1e3;
  private gridU = { uTime: { value: 0 }, uA: { value: 0 }, uHalf: { value: 10 }, uWave: { value: 1e3 }, uOrigin: { value: new THREE.Vector2() } };
  private grid: THREE.Mesh;
  private domeU = { uSweep: { value: 0 }, uA: { value: 0 }, uR: { value: 10 }, uOrigin: { value: new THREE.Vector2() }, uDir: { value: new THREE.Vector2(0, -1) }, uTime: { value: 0 } };
  private dome: THREE.Mesh;
  private domeT = -1;
  private tess: LineSegments2;
  private tessMat: LineMaterial;
  private tessHalo: THREE.Sprite;
  private tessGroup = new THREE.Group();
  private sealTex: THREE.Texture | null = null;
  private seals: Seal[] = [];
  // 加速驱动
  private reticleTex: THREE.Texture | null = null;
  private reticles: THREE.Mesh[] = [];
  private reticleA = 0;
  private reticleOn = false;
  private reticleCount = 0;

  // half：桌面半宽；scale：东西画多大（2.5D 是 1，3D 略小）
  constructor(half: number, scale = 1) {
    this.half = half;
    this.scale = scale;
    this.gridU.uHalf.value = half;
    this.grid = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: this.gridU,
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -10,
      }),
    );
    this.grid.position.y = 0.045;
    this.grid.renderOrder = 3;
    this.grid.visible = false;

    const R = half * 1.5;
    this.domeU.uR.value = R;
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({ uniforms: this.domeU, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.dome.renderOrder = 6;
    this.dome.visible = false;

    const geo = new LineSegmentsGeometry();
    geo.setPositions(new Float32Array(TESS_EDGES.length * 6));
    this.tessMat = new LineMaterial({ color: 0xc4a6ff, linewidth: 2.2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.tess = new LineSegments2(geo, this.tessMat);
    this.tess.frustumCulled = false;
    this.tess.renderOrder = 7;
    this.tessHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.tessHalo.scale.setScalar(4.6 * scale);
    this.tessHalo.renderOrder = 6;
    this.tessGroup.add(this.tessHalo, this.tess);
    this.tessGroup.position.set(0, 3.3 * scale, 0);
    this.tessGroup.visible = false;

    this.group.add(this.grid, this.dome, this.tessGroup);
  }

  // 高维领域开着没有。不经过 domainSweep 直接开（比如中途重画）就没有罩过来的那一下
  setDomain(on: boolean): void {
    if (on === this.domainOn) return;
    this.domainOn = on;
  }

  // 按下的那一下：穹顶和网格从 origin（她那边）罩过整张桌子
  domainSweep(origin: THREE.Vector3): void {
    this.domainOn = true;
    this.wave = 0;
    this.gridU.uOrigin.value.set(origin.x, origin.z);
    const dir = new THREE.Vector2(-origin.x, -origin.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, -1);
    dir.normalize();
    this.domeU.uDir.value.copy(dir);
    // 从她身后的穹顶边上起
    this.domeU.uOrigin.value.copy(dir).multiplyScalar(-this.domeU.uR.value);
    this.domeT = 0;
  }

  // 封印：在 at 闪一下（delay 秒以后）
  seal(at: THREE.Vector3, size = 2.2, delay = 0): void {
    this.sealTex ??= sealTexture();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sealTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sprite.position.copy(at);
    sprite.renderOrder = 9;
    sprite.visible = false;
    this.group.add(sprite);
    this.seals.push({ sprite, t: 0, delay, size: size * this.scale });
  }

  // 加速驱动的准星挂在哪几个点上（一般三个：另外三家的牌河上方）；null 收起来
  setReticles(points: THREE.Vector3[] | null): void {
    this.reticleOn = !!points;
    if (!points) return;
    this.reticleTex ??= reticleTexture();
    while (this.reticles.length < points.length) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: this.reticleTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }),
      );
      m.renderOrder = 5;
      this.reticles.push(m);
      this.group.add(m);
    }
    this.reticleCount = points.length;
    points.forEach((p, i) => this.reticles[i].position.copy(p));
  }

  // 一局结束：全收起来（不等淡出）
  clear(): void {
    this.domainOn = false;
    this.domainA = 0;
    this.wave = 1e3;
    this.domeT = -1;
    this.dome.visible = false;
    this.grid.visible = false;
    this.tessGroup.visible = false;
    this.reticleOn = false;
    this.reticleA = 0;
    for (const m of this.reticles) m.visible = false;
    for (const s of this.seals) {
      s.sprite.removeFromParent();
      s.sprite.material.dispose();
    }
    this.seals.length = 0;
  }

  update(dt: number, renderer: THREE.WebGLRenderer): void {
    this.t += dt;
    // 高维领域：网格
    this.domainA += ((this.domainOn ? 1 : 0) - this.domainA) * Math.min(1, dt * (this.domainOn ? 4 : 2));
    if (!this.domainOn && this.domainA < 0.004) this.domainA = 0;
    if (this.wave < 1e3) {
      this.wave += dt * this.half * 1.7;
      if (this.wave > this.half * 3.6) this.wave = 1e3;
    }
    this.grid.visible = this.domainA > 0;
    this.gridU.uTime.value = this.t;
    this.gridU.uA.value = this.domainA;
    this.gridU.uWave.value = this.wave;
    // 穹顶：1.5 秒罩过去，再用 0.9 秒淡掉
    if (this.domeT >= 0) {
      this.domeT += dt;
      const R = this.domeU.uR.value;
      const k = Math.min(1, this.domeT / 1.5);
      this.domeU.uSweep.value = (k * k * (3 - 2 * k)) * R * 2.3 - R * 0.15;
      this.domeU.uA.value = Math.min(1, this.domeT / 0.2) * (1 - Math.max(0, Math.min(1, (this.domeT - 1.5) / 0.9)));
      this.domeU.uTime.value = this.t;
      this.dome.visible = true;
      if (this.domeT > 2.4) {
        this.domeT = -1;
        this.dome.visible = false;
      }
    }
    // 四维立方体：在四维里慢慢翻，投到三维再画
    this.tessGroup.visible = this.domainA > 0.01;
    if (this.tessGroup.visible) {
      const size = 1.05 * this.scale * (0.9 + 0.1 * this.domainA);
      const a = this.t * 0.42;
      const b = this.t * 0.27;
      const c = this.t * 0.19;
      const pts: number[][] = [];
      for (let i = 0; i < 16; i++) {
        let x = i & 1 ? 1 : -1;
        let y = i & 2 ? 1 : -1;
        let z = i & 4 ? 1 : -1;
        let w = i & 8 ? 1 : -1;
        // 转三个面：x–w、y–z、z–w
        [x, w] = [x * Math.cos(a) - w * Math.sin(a), x * Math.sin(a) + w * Math.cos(a)];
        [y, z] = [y * Math.cos(b) - z * Math.sin(b), y * Math.sin(b) + z * Math.cos(b)];
        [z, w] = [z * Math.cos(c) - w * Math.sin(c), z * Math.sin(c) + w * Math.cos(c)];
        const k = (size * 1.6) / (2.6 - w);
        pts.push([x * k, y * k, z * k]);
      }
      const start = this.tess.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
      const arr = start.data.array as Float32Array;
      TESS_EDGES.forEach(([p, q], i) => {
        arr.set(pts[p], i * 6);
        arr.set(pts[q], i * 6 + 3);
      });
      start.data.needsUpdate = true;
      renderer.getDrawingBufferSize(this.tessMat.resolution);
      this.tessMat.linewidth = 2.2 * Math.max(1, this.tessMat.resolution.y / 900);
      this.tessMat.opacity = this.domainA * (0.7 + 0.15 * Math.sin(this.t * 1.7));
      this.tessHalo.material.opacity = this.domainA * (0.32 + 0.1 * Math.sin(this.t * 1.1));
      this.tessGroup.position.y = (3.3 + 0.12 * Math.sin(this.t * 0.8)) * this.scale;
    }
    // 封印：盖下来、停一下、散掉
    for (let i = this.seals.length - 1; i >= 0; i--) {
      const s = this.seals[i];
      if (s.delay > 0) {
        s.delay -= dt;
        continue;
      }
      s.t += dt;
      const k = s.t / 1.1;
      if (k >= 1) {
        s.sprite.removeFromParent();
        s.sprite.material.dispose();
        this.seals.splice(i, 1);
        continue;
      }
      s.sprite.visible = true;
      const stamp = 1 + 0.9 * Math.exp(-s.t * 14);
      s.sprite.scale.setScalar(s.size * stamp * (1 + 0.25 * Math.max(0, k - 0.7) / 0.3));
      s.sprite.material.opacity = Math.min(1, s.t / 0.07) * (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      s.sprite.material.rotation = -0.5 * Math.exp(-s.t * 9);
    }
    // 准星
    this.reticleA += ((this.reticleOn ? 1 : 0) - this.reticleA) * Math.min(1, dt * 4);
    if (!this.reticleOn && this.reticleA < 0.004) this.reticleA = 0;
    this.reticles.forEach((m, i) => {
      m.visible = i < this.reticleCount && this.reticleA > 0;
      if (!m.visible) return;
      // 刚挂上时从大圈收到位；之后慢慢转，轻轻一缩一放
      const lock = 1 + 1.4 * (1 - this.reticleA) + 0.05 * Math.sin(this.t * 2.3 + i * 2.1);
      m.scale.setScalar(2.7 * this.scale * lock);
      m.rotation.y = this.t * 0.5 * (i % 2 ? -1 : 1) + i;
      (m.material as THREE.MeshBasicMaterial).opacity = this.reticleA * (0.7 + 0.2 * Math.sin(this.t * 3.1 + i));
    });
  }

  dispose(): void {
    this.clear();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
    this.tess.geometry.dispose();
    this.tessMat.dispose();
    this.tessHalo.material.map?.dispose();
    this.tessHalo.material.dispose();
    this.sealTex?.dispose();
    this.reticleTex?.dispose();
    for (const m of this.reticles) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  }
}

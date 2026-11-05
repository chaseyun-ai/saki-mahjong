import * as THREE from 'three';

// 薄墨初美的里鬼门（3D、2.5D），照动画原作：东风、北风都鸣出来以后，紫色的风绕着牌桌打转、一圈圈往里卷，
// 四周暗下来、出现星点；和牌时桌心炸开一团白光，紫色的风像喷泉一样往上、往外张开。
// - 每一缕风是一条笔触：两头细、中间粗，中心一道白芯、外面一层紫晕，沿着走向带一点毛糙的抖动
// - 风丝的位置全在顶点着色器里按时间算（每条只存几个随机数），一帧不用在 CPU 上改顶点
// - 宽度朝着镜头展开；线细到不足 1.5 个像素时不再变细而是变暗，远处的风丝不会断成虚线
// level 0–1：照小四喜的进度，越接近听牌风越多、转得越急、四周越暗。
// release()：和牌时风被往外、往上甩散；burst() 放和牌的喷泉。
// 风丝的画法参考了 Humpalumps/ultra-elements（MIT）Ribbons.js 的解析式条带和“细线变暗不变细”，
// 地上冲击波的半径照它 Shockwaves.js 的 t^0.4 爆炸波曲线。见 THIRD_PARTY_NOTICES.md

const STREAKS = 260;
const SEG = 20;
const RAYS = 200;
const RAY_SEG = 14;
const STARS = 420;
const PALETTE = ['#d93cff', '#e255ff', '#b83cff', '#ff4fd8', '#c94cff', '#ef6bff'];

const NOISE = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
`;

// 条带的公共部分：给定中线上一点 P 和下一点 P2，朝镜头展开 halfW；返回偏移后的位置，aa 是变暗的系数
const STRIP = /* glsl */ `
uniform float uResY;
vec3 expand(vec3 P, vec3 P2, float halfW, float side, out float aa) {
  vec3 T = normalize(P2 - P + vec3(1e-5, 0.0, 0.0));
  vec3 V = cameraPosition - P;
  vec3 S = normalize(cross(T, V));
  float viewZ = max(-(viewMatrix * vec4(P, 1.0)).z, 0.1);
  float px = 2.0 * halfW * 0.5 * uResY * projectionMatrix[1][1] / viewZ;
  float c = max(px, 1.5);
  aa = px / c;
  return P + S * side * halfW * c / max(px, 1e-5);
}
`;

const STREAK_VERT = /* glsl */ `
#define PI 3.14159265
attribute vec2 aUS;     // u：0 头 1 尾；side：-1 / 1
attribute vec4 iA;      // seed, rank, theta0, omega
attribute vec4 iB;      // phase, y, span, width
attribute vec4 iC;      // inward, wobble, -, -
attribute vec3 iCol;
uniform float uTime;
uniform float uLevel;
uniform float uOuter;
uniform float uInner;
uniform float uRelease;
uniform float uFade;
varying float vSide;
varying float vU;
varying float vAlpha;
varying vec3 vCol;
${NOISE}
${STRIP}
vec3 at(float u, float life, float th) {
  float r = mix(uOuter, uInner, pow(life, 0.8));
  float a = th - u * iB.z;
  float rr = r * (1.0 + u * iB.z * 0.2);
  float seed = iA.x * 97.0;
  // 笔触不是死板的圆弧：顺着走向慢慢弯一两下
  float wig = (n1(u * 2.6 + seed + uTime * 0.35) - 0.5) * iC.y + (n1(u * 5.5 + seed * 1.7) - 0.5) * iC.y * 0.25;
  rr += wig;
  float y = iB.y + sin(u * 3.0 + seed + uTime * 1.3) * 0.25 + wig * 0.5;
  // 和牌：往外甩、往上掀
  float rel = uRelease * uRelease;
  rr *= 1.0 + rel * (1.2 + 2.0 * iA.x);
  y += rel * (5.0 + 12.0 * iA.x);
  return vec3(sin(a) * rr, y, -cos(a) * rr);
}
void main() {
  float u = aUS.x;
  float span = uOuter - uInner;
  float life = fract(iB.x + uTime * iC.x / span);
  float r = mix(uOuter, uInner, pow(life, 0.8));
  // 越往里转得越快
  float th = iA.z + uTime * iA.w * (0.6 + 0.9 * uOuter / max(r, 1.0) * 0.35);
  vec3 P = at(u, life, th);
  vec3 P2 = at(u + 0.02, life, th);
  float taper = pow(sin(PI * clamp(u, 0.0, 1.0)), 0.55) * (1.0 - 0.45 * u);
  float aa;
  vec3 pos = expand(P, P2, iB.w * taper, aUS.y, aa);
  float on = clamp((uLevel - iA.y) * 6.0, 0.0, 1.0);
  float lifeA = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.82, 1.0, life));
  vAlpha = on * lifeA * aa * uFade;
  vSide = aUS.y;
  vU = u;
  vCol = iCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

// 横截面：中心一道白芯，外面一层紫晕；顺着走向头亮尾淡
const STRIP_FRAG = /* glsl */ `
varying float vSide;
varying float vU;
varying float vAlpha;
varying vec3 vCol;
uniform float uBright;
void main() {
  float s2 = vSide * vSide;
  float core = exp(-s2 * 18.0);
  float halo = max(0.0, 1.0 - s2) * exp(-s2 * 2.0);
  float along = mix(1.25, 0.35, vU);
  vec3 col = vCol * halo * 0.95 + vec3(1.0, 0.9, 1.0) * core * 0.55;
  gl_FragColor = vec4(col * along * vAlpha * uBright, 1.0);
}
`;

// 和牌的喷泉：从桌心往上、往外张开的风丝
const RAY_VERT = /* glsl */ `
attribute vec2 aUS;
attribute vec4 iA; // angle, lean, speed, delay
attribute vec4 iB; // len, width, curl, seed
attribute vec3 iCol;
uniform float uT;
varying float vSide;
varying float vU;
varying float vAlpha;
varying vec3 vCol;
${STRIP}
vec3 at(float d) {
  float a = iA.x + d * iB.z * 0.03;
  float rad = 0.4 + d * iA.y * (1.0 + d * 0.035);
  float y = d * (1.0 - iA.y * 0.35);
  return vec3(sin(a) * rad, y, -cos(a) * rad);
}
void main() {
  float t = max(0.0, uT - iA.w);
  float head = iA.z * (1.0 - exp(-t * 2.2)) / 2.2 * 2.2;
  float tail = max(0.0, head - iB.x);
  float d = mix(head, tail, aUS.x);
  vec3 P = at(d);
  vec3 P2 = at(d + 0.2);
  float taper = pow(sin(3.14159 * clamp(aUS.x, 0.0, 1.0)), 0.5) * (1.0 - 0.3 * aUS.x);
  float aa;
  vec3 pos = expand(P, P2, iB.y * taper * (1.0 + d * 0.03), aUS.y, aa);
  float fade = (uT > iA.w ? 1.0 : 0.0) * pow(max(0.0, 1.0 - uT / 2.4), 1.4);
  vAlpha = fade * aa * (1.0 + 2.0 * exp(-d * 0.25));
  vSide = aUS.y;
  vU = aUS.x;
  vCol = iCol;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

// 桌心那一团白光（竖着拉长、朝着镜头）
const CORE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const CORE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uA;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p * vec2(1.0, 0.55));
  float core = exp(-d * d * 9.0);
  float glow = exp(-d * 3.0);
  vec3 col = vec3(1.0, 0.95, 1.0) * core * 1.6 + vec3(0.85, 0.3, 1.0) * glow * 0.8;
  gl_FragColor = vec4(col * uA, 1.0);
}
`;
// 地上推开的一圈：前沿清楚、后面软尾，半径 ∝ t^0.4
const SHOCK_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uX;
void main() {
  vec2 q = (vUv * 2.0 - 1.0) * 2.6;
  float r = length(q);
  float rr = mix(0.1, 2.4, pow(uX, 0.4));
  float d = r - rr;
  float prof = d > 0.0 ? exp(-d / 0.015) : exp(d / 0.18);
  float e = pow(1.0 - uX, 2.2);
  vec3 col = mix(vec3(0.85, 0.3, 1.0), vec3(1.0, 0.9, 1.0), exp(-abs(d) / 0.02)) * prof * e * 1.3;
  col *= smoothstep(2.6, 2.4, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uA;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.55 + 0.45 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 40.0);
  vA = uA * tw;
  gl_PointSize = (1.2 + aSeed * 2.4);
}
`;
const STAR_FRAG = /* glsl */ `
varying float vA;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(p, p) * 3.0);
  gl_FragColor = vec4(vec3(0.85, 0.85, 1.0) * a * vA, 1.0);
}
`;

const additive = (u: Record<string, THREE.IUniform>, vert: string, frag: string) =>
  new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });

// 一条条带的底板：(SEG+1)×2 个顶点，aUS = (u, side)
function stripBase(seg: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  const us: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    us.push(i / seg, -1, i / seg, 1);
    if (i > 0) {
      const v = i * 2;
      idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
    }
  }
  g.setAttribute('aUS', new THREE.Float32BufferAttribute(us, 2));
  // three 要一个 position 才肯画（值不用，位置在着色器里算）
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(((seg + 1) * 2) * 3).fill(0), 3));
  g.setIndex(idx);
  return g;
}

function inst(g: THREE.InstancedBufferGeometry, name: string, data: number[], size: number): void {
  g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(data), size));
}

class GaleBurst {
  readonly group = new THREE.Group();
  private rayMat: THREE.ShaderMaterial;
  private core: THREE.Mesh;
  private coreMat: THREE.ShaderMaterial;
  private shock: THREE.Mesh;
  private shockMat: THREE.ShaderMaterial;
  private t = -1;

  constructor(res: THREE.IUniform, size: number) {
    const g = stripBase(RAY_SEG);
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    const col = new THREE.Color();
    for (let i = 0; i < RAYS; i++) {
      // 大多往上直冲，越靠外越斜（喷泉往外张开）
      const lean = 0.08 + Math.pow(Math.random(), 1.4) * 0.75;
      a.push(Math.random() * Math.PI * 2, lean, 14 + Math.random() * 22, Math.random() * 0.3);
      b.push(4 + Math.random() * 10, 0.12 + Math.random() * 0.45, (Math.random() - 0.5) * 2, Math.random());
      col.set(PALETTE[i % PALETTE.length]);
      c.push(col.r, col.g, col.b);
    }
    inst(g, 'iA', a, 4);
    inst(g, 'iB', b, 4);
    inst(g, 'iCol', c, 3);
    g.instanceCount = RAYS;
    this.rayMat = additive({ uT: { value: 0 }, uResY: res, uBright: { value: 1.3 } }, RAY_VERT, STRIP_FRAG);
    const rays = new THREE.Mesh(g, this.rayMat);
    rays.frustumCulled = false;
    rays.renderOrder = 9;
    this.coreMat = additive({ uA: { value: 0 } }, CORE_VERT, CORE_FRAG);
    this.core = new THREE.Mesh(new THREE.PlaneGeometry(7, 13), this.coreMat);
    this.core.position.y = 4;
    this.core.renderOrder = 10;
    this.shockMat = additive({ uX: { value: 0 } }, CORE_VERT, SHOCK_FRAG);
    this.shock = new THREE.Mesh(new THREE.PlaneGeometry(size * 2.6, size * 2.6), this.shockMat);
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 0.08;
    this.shock.renderOrder = 8;
    this.group.add(this.shock, rays, this.core);
    this.group.visible = false;
  }

  play(): void {
    this.t = 0;
    this.group.visible = true;
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    this.rayMat.uniforms.uT.value = t;
    // 白光：一下子亮起来，慢慢收掉
    this.coreMat.uniforms.uA.value = Math.min(1, t * 10) * Math.pow(Math.max(0, 1 - t / 1.6), 1.5) * 1.4;
    // 竖着的光团只绕竖轴转向镜头
    const cam = new THREE.Vector3();
    camera.getWorldPosition(cam);
    this.core.rotation.set(0, Math.atan2(cam.x, cam.z), 0);
    this.core.scale.set(1 + t * 0.6, 1 + t * 0.3, 1);
    this.shockMat.uniforms.uX.value = Math.min(1, t / 1.4);
    if (t > 2.6) {
      this.t = -1;
      this.group.visible = false;
    }
  }
}

export class Gale {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private burstFx: GaleBurst;
  private res = { value: 800 };
  private level = 0;
  private shown = 0;
  private release = 0; // 和牌以后 0→1
  private releasing = false;
  private t = 0;
  private clock = 0; // 风的时间：越接近听牌走得越快

  // outer：从多远卷进来；inner：卷到多近散掉
  constructor(outer = 26, inner = 4) {
    const g = stripBase(SEG);
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];
    const cl: number[] = [];
    const col = new THREE.Color();
    for (let s = 0; s < STREAKS; s++) {
      const rank = (s * 0.61803) % 1;
      // 大多贴着牌桌转，一些飘得高，一些在桌面以下（从桌边外面看得见）
      const k = Math.random();
      const y = k < 0.6 ? 0.4 + Math.random() * 2.2 : k < 0.85 ? 2.6 + Math.random() * 6 : -1 - Math.random() * 6;
      a.push(Math.random(), rank, Math.random() * Math.PI * 2, 0.5 + Math.random() * 0.7);
      b.push(Math.random(), y, 0.3 + Math.random() * 0.9, 0.14 + Math.pow(Math.random(), 1.5) * 0.5);
      c.push(1.0 + Math.random() * 2.2, 0.1 + Math.random() * 0.6, 0, 0);
      col.set(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      cl.push(col.r, col.g, col.b);
    }
    inst(g, 'iA', a, 4);
    inst(g, 'iB', b, 4);
    inst(g, 'iC', c, 4);
    inst(g, 'iCol', cl, 3);
    g.instanceCount = STREAKS;
    this.mat = additive(
      {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uOuter: { value: outer },
        uInner: { value: inner },
        uRelease: { value: 0 },
        uFade: { value: 1 },
        uResY: this.res,
        uBright: { value: 1 },
      },
      STREAK_VERT,
      STRIP_FRAG,
    );
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;

    // 星点：散在牌桌四周的空中（地板以上、桌子挡住的看不见）
    const sp: number[] = [];
    const ss: number[] = [];
    for (let i = 0; i < STARS; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = outer * 0.6 + Math.random() * outer * 1.4;
      sp.push(Math.sin(a) * r, -6 + Math.random() * 16, -Math.cos(a) * r);
      ss.push(Math.random());
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(ss, 1));
    this.starMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uA: { value: 0 } }, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const stars = new THREE.Points(sg, this.starMat);
    stars.frustumCulled = false;

    this.burstFx = new GaleBurst(this.res, outer);
    this.group.add(stars, mesh);
    this.group.visible = false;
  }

  // 和牌的喷泉另外放（风散掉以后还在放）
  get burstGroup(): THREE.Group {
    return this.burstFx.group;
  }

  // 四周压暗多少（0–1），牌桌拿去调房间的颜色
  get dark(): number {
    return this.shown * (1 - this.release) * 0.85;
  }

  setLevel(level: number): void {
    const v = Math.max(0, Math.min(1, level));
    // 新的一局又聚起来：撤掉散掉的状态
    if (v > 0 && this.level === 0) {
      this.releasing = false;
      this.release = 0;
    }
    this.level = v;
  }

  // 和牌那一下：风被甩散，桌心炸开喷泉
  burst(): void {
    if (this.shown > 0.01 && !this.releasing) {
      this.releasing = true;
      this.release = 0.001;
    }
    this.burstFx.play();
  }

  update(dt: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    this.t += dt;
    this.res.value = renderer.domElement.height || 800;
    this.burstFx.update(dt, camera);
    this.shown += (this.level - this.shown) * (1 - Math.exp(-dt * 1.2));
    if (this.level === 0 && this.shown < 0.01) this.shown = 0;
    if (this.releasing) this.release = Math.min(1, this.release + dt / 1.6);
    const amount = this.shown * (1 - this.release);
    this.group.visible = amount > 0.005 || (this.releasing && this.release < 1);
    if (!this.group.visible) return;
    const u = this.mat.uniforms;
    this.clock += dt * (0.7 + 0.6 * this.shown);
    u.uTime.value = this.clock;
    u.uLevel.value = this.shown;
    u.uRelease.value = this.release;
    u.uFade.value = Math.min(1, this.shown * 3) * (1 - this.release);
    this.starMat.uniforms.uTime.value = this.t;
    this.starMat.uniforms.uA.value = this.dark;
  }
}

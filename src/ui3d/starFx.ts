import * as THREE from 'three';

// 大星淡的星空（2.5D、3D）。
// - 双立直：立直棒落桌那一下，一圈金色的光从她那边扫过桌面，扫过的地方桌布变成夜空（星云、银河、一闪一闪的星），
//   桌面上方飘着细小的星尘；她等的那个转角上悬着一颗四芒星（被鸣牌错开时暗下去）
// - 转角暗杠：转角那颗星化成流星落到她的杠子上
// - 杠里：和牌时四颗流星从王牌里那张里宝牌指示牌飞到杠的四张牌上
// - 技能发动时的流星、闪光也借这里的四芒星画；星符汇聚的北斗七星（figure）挂到这一局结束
// 星云是开局前在 JS 里算好的一张贴图（四个通道四层云），星是一颗一个点。
// 夜空是活的，而且局局不同（reseed）：每一局星的位置、银河的方向和宽窄、星云的浓淡和颜色都重新随机；
// 几层星转得不一样快，彼此的位置一直在变；有些星隔一阵猛地亮一下，隔几秒有流星划过。
// 不在着色器里现算噪声：那种散列函数在不同显卡上算出来的数对不上，相邻两格接不起来，夜空会裂成一块一块的

const SKY_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SKY_FRAG = /* glsl */ `
uniform sampler2D uNeb;
uniform float uTime;
uniform float uA;
uniform float uWave;
uniform float uBoost;
uniform float uHalf;
uniform vec2 uOrigin;
// 这一局的夜空长什么样（每局随机，见 StarSky.reseed）
uniform float uTurn;  // 整片夜空先转过多少
uniform float uSpin;  // 之后转多快（有正有负）
uniform vec4 uOffA;   // 两层星云在贴图上从哪取
uniform vec4 uOffB;   // 银河里两层细云从哪取
uniform vec2 uDrift;  // 云往哪边飘
uniform vec3 uBand;   // 银河：偏离桌心多少、多宽、多亮
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColBand;
uniform vec3 uColDust;
uniform vec2 uDense;  // 两层星云各有多浓（阈值）
// 划过夜空的流星（两颗）：头、尾的位置，和各自多亮
uniform vec4 uMetA;
uniform vec4 uMetB;
uniform vec2 uMetK;
varying vec2 vP;
float meteor(vec2 p, vec4 m, float a) {
  vec2 pa = p - m.xy, ba = m.zw - m.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float d = length(pa - ba * h);
  float w = mix(0.1, 0.02, h);
  float head = exp(-dot(pa, pa) / 0.03);
  return a * (exp(-d * d / (w * w)) * pow(1.0 - h, 1.6) + head * 0.8);
}
void main() {
  vec2 p = vP;
  float ang = uTurn + uTime * uSpin;
  float cs = cos(ang), sn = sin(ang);
  vec2 q = vec2(cs * p.x + sn * p.y, cs * p.y - sn * p.x);
  // 星云：四层云都从一张烤好的贴图里取（四个通道各是一层），用不同的大小、慢慢错开着飘
  float n = texture2D(uNeb, q * 0.02125 + uOffA.xy + uDrift * uTime).r;
  float n2 = texture2D(uNeb, q * 0.04 + uOffA.zw - uDrift.yx * uTime * 1.4).g;
  vec3 col = vec3(0.010, 0.014, 0.045);
  // 云慢慢地一明一暗，各处不同步
  float breath = 0.86 + 0.14 * sin(uTime * 0.23 + n2 * 9.0);
  col += uColA * smoothstep(uDense.x, uDense.x + 0.4, n) * 0.8 * breath;
  col += uColB * smoothstep(uDense.y, uDense.y + 0.38, n2) * 0.7 * (1.72 - breath);
  // 斜着横过桌面的一条银河
  float across = (q.x * 0.62 + q.y * 0.78 - uBand.x) / (uHalf * uBand.y);
  float band = exp(-across * across);
  col += (uColBand * texture2D(uNeb, q * 0.0825 + uOffB.xy).b + uColDust * 0.16 * texture2D(uNeb, q * 0.175 + uOffB.zw).a) * band * uBand.z;
  col *= 1.0 + uBoost * 0.8;
  col += vec3(0.85, 0.92, 1.0) * (meteor(p, uMetA, uMetK.x) + meteor(p, uMetB, uMetK.y)) * 2.0;
  // 从她那边扫过来的金色光圈：扫过的地方才是夜空
  float d = distance(p, uOrigin);
  float inside = smoothstep(uWave, uWave - 2.2, d);
  float front = exp(-pow((d - uWave) / 0.55, 2.0)) * smoothstep(uHalf * 3.0, uHalf * 2.2, uWave);
  col += vec3(1.0, 0.8, 0.4) * front * 1.8;
  float e = max(abs(p.x), abs(p.y)) / uHalf;
  float edge = smoothstep(1.0, 0.94, e);
  float a = clamp(inside * 0.93 + front * 0.7, 0.0, 1.0) * uA * edge;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// 夜空里的星：一颗星一个点；大的带十字星芒。几层星转得不一样快，彼此的位置一直在变；
// 有些星隔一阵猛地亮一下、十字光伸出来（aGlint）。光圈没扫到的地方、桌子外面的不画
const STAR_VERT = /* glsl */ `
attribute vec4 aStar; // 半径、星芒、闪烁的种子、亮度
attribute vec3 aColor;
attribute vec2 aMove; // 这一层转得多快（夜空的几倍）、会不会猛地亮一下
uniform float uTime;
uniform float uA;
uniform float uWave;
uniform float uBoost;
uniform float uHalf;
uniform float uPx;
uniform float uMin;
uniform float uTurn;
uniform float uSpin;
uniform vec2 uOrigin;
varying float vA;
varying float vK;
varying float vM;
varying vec3 vC;
void main() {
  float ang = uTurn + uTime * uSpin * aMove.x;
  float cs = cos(ang), sn = sin(ang);
  vec2 q = position.xz;
  vec2 p = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
  vec4 mv = modelViewMatrix * vec4(p.x, position.y, p.y, 1.0);
  gl_Position = projectionMatrix * mv;
  float e = max(abs(p.x), abs(p.y)) / uHalf;
  float edge = smoothstep(1.0, 0.94, e);
  float inside = smoothstep(uWave, uWave - 2.2, distance(p, uOrigin));
  float h = aStar.z;
  float tw = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.6) + h * 40.0);
  // 猛地亮一下：十几到几十秒一回，一回不到一秒
  float glint = aMove.y * pow(max(0.0, sin(uTime * (0.12 + h * 0.3) + h * 91.0)), 90.0);
  vM = min(1.0, aStar.y + glint * 0.9);
  vK = 1.0 + 4.0 * vM;
  float px = uPx * aStar.x * vK / max(-mv.z, 0.1);
  float size = max(px, uMin);
  // 小到不足一个像素的星：点不再缩小，改成变暗
  vA = aStar.w * (tw + glint * 2.2) * inside * edge * uA * (1.0 + uBoost * 1.5) * (1.0 + uBoost * 0.8) * (px / size);
  vC = aColor;
  gl_PointSize = size;
}
`;

const STAR_FRAG = /* glsl */ `
varying float vA;
varying float vK;
varying float vM;
varying vec3 vC;
void main() {
  vec2 u = gl_PointCoord * 2.0 - 1.0;
  vec2 d = abs(u) * vK;
  float core = smoothstep(1.0, 0.0, length(d));
  float spike = (exp(-d.x * 6.6 - d.y * 0.77) + exp(-d.y * 6.6 - d.x * 0.77)) * vM * 1.6 * smoothstep(1.0, 0.6, length(u));
  gl_FragColor = vec4(vC * (core * core * 1.4 + spike) * vA, 1.0);
  #include <colorspace_fragment>
}
`;

const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uA;
uniform float uPx;
varying float vA;
varying float vGold;
void main() {
  vec3 p = position;
  float life = fract(aSeed.x + uTime * (0.02 + aSeed.y * 0.03));
  p.y = mix(0.3, 7.5, life);
  p.x += sin(uTime * 0.4 + aSeed.z * 30.0) * 0.5;
  p.z += cos(uTime * 0.33 + aSeed.w * 30.0) * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + aSeed.z * 3.0) + aSeed.w * 50.0);
  vA = uA * smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.7, life) * (0.35 + 0.65 * tw);
  vGold = step(0.6, aSeed.w);
  gl_PointSize = uPx * (0.05 + aSeed.y * 0.09) / max(-mv.z, 0.1);
}
`;

const MOTE_FRAG = /* glsl */ `
varying float vA;
varying float vGold;
void main() {
  vec2 u = gl_PointCoord * 2.0 - 1.0;
  float r = length(u);
  float v = exp(-r * r * 5.0) + (exp(-abs(u.x) * 14.0) + exp(-abs(u.y) * 14.0)) * exp(-r * 3.0) * 0.6;
  vec3 c = mix(vec3(0.85, 0.92, 1.0), vec3(1.0, 0.84, 0.5), vGold);
  gl_FragColor = vec4(c * v * vA, 1.0);
  #include <colorspace_fragment>
}
`;

const FLARE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 四芒星：中间一团白，横竖两道长芒，斜着两道短芒，外面一圈晕
const FLARE_FRAG = /* glsl */ `
uniform float uA;
uniform float uSpin;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 u = vUv * 2.0 - 1.0;
  float cs = cos(uSpin), sn = sin(uSpin);
  u = vec2(u.x * cs - u.y * sn, u.x * sn + u.y * cs);
  float r = length(u);
  float core = exp(-r * r * 110.0);
  float rays = exp(-abs(u.x) * 34.0) * exp(-abs(u.y) * 2.6) + exp(-abs(u.y) * 34.0) * exp(-abs(u.x) * 2.6);
  float diag = (exp(-abs(u.x - u.y) * 30.0) + exp(-abs(u.x + u.y) * 30.0)) * exp(-r * 6.0) * 0.5;
  float halo = exp(-r * r * 7.0) * 0.16;
  float fade = smoothstep(1.0, 0.75, r);
  vec3 c = uColor * (rays + diag + halo) + vec3(1.0) * core * 0.9;
  gl_FragColor = vec4(c * uA * fade, 1.0);
  #include <colorspace_fragment>
}
`;

const PILLAR_FRAG = /* glsl */ `
uniform float uA;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float v = exp(-x * x * 9.0) * pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.05, vUv.y);
  gl_FragColor = vec4(uColor * v * uA, 1.0);
  #include <colorspace_fragment>
}
`;

// 星座的连线：两头的星亮了才画出来，淡淡的一道
const LINE_VERT = /* glsl */ `
attribute float aWhen;
uniform float uT;
varying float vOn;
void main() {
  vOn = smoothstep(0.0, 0.25, uT - aWhen);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LINE_FRAG = /* glsl */ `
uniform float uA;
varying float vOn;
void main() {
  gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * vOn * uA * 0.55, 1.0);
  #include <colorspace_fragment>
}
`;

// 固定种子的随机数：每台机器、每次开局算出来的夜空都一样
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 星云贴图：四个通道各是一层叠了 5 遍的值噪声，上下左右接得上（可以平铺）
let nebula: THREE.DataTexture | null = null;
function nebulaTexture(): THREE.DataTexture {
  if (nebula) return nebula;
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const acc = new Float32Array(N * N);
  for (let ch = 0; ch < 4; ch++) {
    const rnd = mulberry(977 + ch * 131);
    acc.fill(0);
    let amp = 0.5;
    for (let o = 0; o < 5; o++) {
      const n = 4 << o;
      const lat = new Float32Array(n * n);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < N; y++) {
        const gy = (y * n) / N;
        const y0 = Math.floor(gy);
        const y1 = (y0 + 1) % n;
        let fy = gy - y0;
        fy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < N; x++) {
          const gx = (x * n) / N;
          const x0 = Math.floor(gx);
          const x1 = (x0 + 1) % n;
          let fx = gx - x0;
          fx = fx * fx * (3 - 2 * fx);
          const top = lat[y0 * n + x0] + (lat[y0 * n + x1] - lat[y0 * n + x0]) * fx;
          const bot = lat[y1 * n + x0] + (lat[y1 * n + x1] - lat[y1 * n + x0]) * fx;
          acc[y * N + x] += amp * (top + (bot - top) * fy);
        }
      }
      amp *= 0.5;
    }
    for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = Math.round(Math.min(1, acc[i]) * 255);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  nebula = tex;
  return tex;
}

// 夜空里的星：撒在一个罩得住整张桌子的圆里（夜空在转，圆转到哪都盖得住四个角）。每一局按种子重撒一遍。
// 四层：少而大的、多而小的、银河里密密的碎星（跟着银河转）、几颗特别亮的带颜色的大星；
// 每颗记下半径、星芒、闪烁的种子、亮度、颜色、这一层转多快、会不会猛地亮一下
const WHITE: [number, number, number] = [0.82, 0.9, 1.0];
const WARM: [number, number, number] = [1.0, 0.82, 0.45];
const GIANTS: [number, number, number][] = [[1.0, 0.55, 0.35], [0.55, 0.85, 1.0], [1.0, 0.9, 0.6], [0.8, 0.7, 1.0], [0.6, 1.0, 0.9]];
function starField(half: number, seed: number, band: { off: number; width: number }): THREE.BufferGeometry {
  const rnd = mulberry(seed);
  const R = half * 1.42;
  const area = Math.PI * R * R;
  const pos: number[] = [];
  const star: number[] = [];
  const color: number[] = [];
  const move: number[] = [];
  const spot = (): [number, number] => {
    const r = R * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  const layer = (count: number, lo: number, hi: number, bright: number, inBandOnly: number, speed: number, glints: number) => {
    for (let i = 0; i < count; i++) {
      const [x, z] = spot();
      const m = Math.pow(rnd(), 5);
      const seed = rnd();
      const c = rnd() < 0.18 ? WARM : WHITE;
      const across = (x * 0.62 + z * 0.78 - band.off) / (half * band.width);
      const inBand = Math.exp(-across * across);
      const glint = rnd() < glints ? 1 : 0;
      // 碎星：银河外面稀、也暗
      if (inBandOnly > 0 && rnd() > 1 - inBandOnly + inBandOnly * inBand) continue;
      pos.push(x, 0, z);
      star.push(lo + (hi - lo) * m, m, seed, bright * (inBandOnly > 0 ? 0.4 + 0.6 * inBand : 1));
      color.push(...c);
      move.push(speed, glint);
    }
  };
  layer(Math.round(area * 0.4), 0.039, 0.122, 1, 0, 0.55, 0.1);
  layer(Math.round(area * 1.8), 0.017, 0.052, 0.7, 0, 1.7, 0.03);
  layer(Math.round(area * 5), 0.009, 0.022, 0.8, 0.6, 1, 0);
  // 大星：只撒在桌面里面，一局四到七颗
  const giants = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < giants; i++) {
    pos.push((rnd() * 2 - 1) * half * 0.85, 0, (rnd() * 2 - 1) * half * 0.85);
    star.push(0.1 + rnd() * 0.08, 0.45 + rnd() * 0.4, rnd(), 1.15);
    color.push(...GIANTS[Math.floor(rnd() * GIANTS.length)]);
    move.push(0.3 + rnd() * 0.5, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aStar', new THREE.Float32BufferAttribute(star, 4));
  geo.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
  geo.setAttribute('aMove', new THREE.Float32BufferAttribute(move, 2));
  return geo;
}

// 夜空的几套颜色（两层星云、银河、银河里的星尘）：每一局在两套之间随便调一个比例
const PALETTES: [number, number, number][][] = [
  [[0.17, 0.07, 0.4], [0.04, 0.15, 0.5], [0.3, 0.26, 0.5], [1.0, 0.78, 0.36]],
  [[0.3, 0.05, 0.28], [0.02, 0.22, 0.36], [0.22, 0.34, 0.5], [0.6, 0.9, 1.0]],
  [[0.05, 0.1, 0.45], [0.03, 0.26, 0.25], [0.25, 0.3, 0.55], [1.0, 0.85, 0.5]],
  [[0.34, 0.07, 0.22], [0.12, 0.08, 0.46], [0.36, 0.24, 0.46], [1.0, 0.7, 0.5]],
  [[0.1, 0.06, 0.46], [0.24, 0.05, 0.34], [0.28, 0.24, 0.56], [0.8, 0.85, 1.0]],
];

// 划过夜空的一颗流星
interface Meteor {
  from: THREE.Vector2;
  dir: THREE.Vector2;
  travel: number;
  tail: number;
  t: number;
  dur: number;
}

const GOLD = new THREE.Color('#ffd36b');
const PALE = new THREE.Color('#8fa2c8');

const add = (uniforms: Record<string, THREE.IUniform>, vert: string, frag: string) =>
  new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });

interface Flare {
  mesh: THREE.Mesh;
  u: { uA: THREE.IUniform<number>; uSpin: THREE.IUniform<number>; uColor: THREE.IUniform<THREE.Color> };
  t: number;
  dur: number;
  size: number;
  peak: number;
  grow: number;
  spin: number;
}

interface Comet {
  from: THREE.Vector3;
  to: () => THREE.Vector3;
  t: number;
  dur: number;
  lift: number;
  size: number;
  trail: number;
  onHit?: () => void;
  head: THREE.ColorRepresentation;
  tail: THREE.ColorRepresentation;
}

// 星座里的一颗星：轮到它时闪一下亮起来，之后一直微微闪着
interface Fixed {
  mesh: THREE.Mesh;
  u: { uA: THREE.IUniform<number>; uSpin: THREE.IUniform<number>; uColor: THREE.IUniform<THREE.Color> };
  at: number; // 第几秒亮
  seed: number;
}

const FLARES = 72;

export class StarSky {
  readonly group = new THREE.Group();
  private sky: THREE.Mesh;
  private skyU = {
    uNeb: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uA: { value: 0 },
    uWave: { value: 0 },
    uBoost: { value: 0 },
    uHalf: { value: 10 },
    uOrigin: { value: new THREE.Vector2() },
    uPx: { value: 800 },
    uMin: { value: 2 },
    uTurn: { value: 0 },
    uSpin: { value: 0.012 },
    uOffA: { value: new THREE.Vector4() },
    uOffB: { value: new THREE.Vector4() },
    uDrift: { value: new THREE.Vector2() },
    uBand: { value: new THREE.Vector3(0, 0.3, 0.7) },
    uColA: { value: new THREE.Vector3() },
    uColB: { value: new THREE.Vector3() },
    uColBand: { value: new THREE.Vector3() },
    uColDust: { value: new THREE.Vector3() },
    uDense: { value: new THREE.Vector2(0.46, 0.5) },
    uMetA: { value: new THREE.Vector4() },
    uMetB: { value: new THREE.Vector4() },
    uMetK: { value: new THREE.Vector2() },
  };
  private meteors: (Meteor | null)[] = [null, null];
  private meteorIn = 2;
  private dots: THREE.Points;
  private moteU = { uTime: { value: 0 }, uA: { value: 0 }, uPx: { value: 800 } };
  private beacon: THREE.Mesh;
  private beaconU = { uA: { value: 0 }, uSpin: { value: 0 }, uColor: { value: GOLD.clone() } };
  private pillar: THREE.Mesh;
  private pillarU = { uA: { value: 0 }, uColor: { value: GOLD.clone() } };
  private flares: Flare[] = [];
  private comets: Comet[] = [];
  private flareGeo = new THREE.PlaneGeometry(1, 1);
  private lineU = { uT: { value: 0 }, uA: { value: 0 } };
  private on = false;
  private shown = 0;
  private wave = 1e3;
  private boost = 0;
  private t = 0;
  private beaconAt: THREE.Vector3 | null = null;
  private beaconLast: THREE.Vector3 | null = null; // 这一局星最后挂在哪（她摸走转角那张以后星收起来了，暗杠的流星还从这里出发）
  private beaconLost = false;
  private beaconA = 0;
  private beaconDim = 0; // 0 金色，1 暗下去
  private beaconScale = 1;
  // 星座（星符汇聚的北斗七星）：星一颗颗亮起来，连线跟着画出来
  private fixed: Fixed[] = [];
  private lines: THREE.LineSegments | null = null;
  private figT = -1;
  private figA = 0;
  private figOn = false;

  constructor(private half: number, scale = 1) {
    this.skyU.uHalf.value = half;
    this.skyU.uNeb.value = nebulaTexture();
    // 贴着桌布的一层：抬高一点、再让深度往前偏一点，深度精度低的手机上也不会和桌布抢着画
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2),
      new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }),
    );
    this.sky.rotation.x = -Math.PI / 2;
    this.sky.position.y = 0.02;
    this.sky.renderOrder = 1;
    this.sky.frustumCulled = false;
    this.dots = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.dots.position.y = 0.03;
    this.dots.renderOrder = 2;
    this.dots.frustumCulled = false;

    const n = 150;
    const pos: number[] = [];
    const seed: number[] = [];
    for (let i = 0; i < n; i++) {
      pos.push((Math.random() * 2 - 1) * half * 0.95, 0, (Math.random() * 2 - 1) * half * 0.95);
      seed.push(Math.random(), Math.random(), Math.random(), Math.random());
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    mg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
    const motes = new THREE.Points(mg, add(this.moteU, MOTE_VERT, MOTE_FRAG));
    motes.frustumCulled = false;
    motes.renderOrder = 7;

    this.beacon = new THREE.Mesh(this.flareGeo, add(this.beaconU, FLARE_VERT, FLARE_FRAG));
    this.beacon.renderOrder = 9;
    this.beacon.frustumCulled = false;
    this.pillar = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), add(this.pillarU, FLARE_VERT, PILLAR_FRAG));
    this.pillar.renderOrder = 8;
    this.pillar.frustumCulled = false;
    this.beaconScale = scale;

    for (let i = 0; i < FLARES; i++) {
      const u = { uA: { value: 0 }, uSpin: { value: 0 }, uColor: { value: GOLD.clone() } };
      const mesh = new THREE.Mesh(this.flareGeo, add(u, FLARE_VERT, FLARE_FRAG));
      mesh.visible = false;
      mesh.renderOrder = 10;
      mesh.frustumCulled = false;
      this.flares.push({ mesh, u, t: 0, dur: 0, size: 1, peak: 1, grow: 0, spin: 0 });
      this.group.add(mesh);
    }
    this.group.add(this.sky, this.dots, motes, this.pillar, this.beacon);
    this.group.visible = false;
    this.reseed();
  }

  // 换一片夜空：整片转过的角度、转的方向和快慢、星云取贴图的哪一块、往哪飘、浓淡、颜色，银河的位置和宽窄，
  // 还有每颗星的位置，都按种子重来。每一局开始换一次（clear 里），所以局局不一样
  reseed(seed = Math.floor(Math.random() * 0x7fffffff)): void {
    const rnd = mulberry(seed);
    const u = this.skyU;
    u.uTurn.value = rnd() * Math.PI * 2;
    u.uSpin.value = (rnd() < 0.5 ? -1 : 1) * (0.008 + rnd() * 0.009);
    u.uOffA.value.set(rnd(), rnd(), rnd(), rnd());
    u.uOffB.value.set(rnd(), rnd(), rnd(), rnd());
    const drift = rnd() * Math.PI * 2;
    u.uDrift.value.set(Math.cos(drift), Math.sin(drift)).multiplyScalar(0.0016 + rnd() * 0.0012);
    const band = { off: (rnd() - 0.5) * this.half * 0.7, width: 0.22 + rnd() * 0.16 };
    u.uBand.value.set(band.off, band.width, 0.55 + rnd() * 0.35);
    u.uDense.value.set(0.4 + rnd() * 0.1, 0.44 + rnd() * 0.1);
    const a = PALETTES[Math.floor(rnd() * PALETTES.length)];
    const b = PALETTES[Math.floor(rnd() * PALETTES.length)];
    const k = rnd();
    [u.uColA, u.uColB, u.uColBand, u.uColDust].forEach((c, i) => c.value.set(a[i][0] + (b[i][0] - a[i][0]) * k, a[i][1] + (b[i][1] - a[i][1]) * k, a[i][2] + (b[i][2] - a[i][2]) * k));
    this.dots.geometry.dispose();
    this.dots.geometry = starField(this.half, seed ^ 0x5bd1e995, band);
    this.meteors = [null, null];
    u.uMetK.value.set(0, 0);
    this.meteorIn = 1.5 + rnd() * 3;
  }

  // 流星：隔几秒从桌面的一边斜着划到另一边
  private updateMeteors(dt: number): void {
    const u = this.skyU;
    this.meteorIn -= dt;
    if (this.meteorIn <= 0) {
      const slot = this.meteors.findIndex((m) => !m);
      this.meteorIn = 2.5 + Math.random() * 6;
      if (slot >= 0) {
        const a = Math.random() * Math.PI * 2;
        const from = new THREE.Vector2(Math.cos(a), Math.sin(a)).multiplyScalar(this.half * (0.35 + Math.random() * 0.6));
        // 朝桌心附近划过去，偏一点
        const dir = from.clone().multiplyScalar(-1).normalize().rotateAround(new THREE.Vector2(), (Math.random() - 0.5) * 1.6);
        this.meteors[slot] = { from, dir, travel: this.half * (0.5 + Math.random() * 0.7), tail: 2.5 + Math.random() * 3, t: 0, dur: 0.55 + Math.random() * 0.5 };
      }
    }
    this.meteors.forEach((m, i) => {
      const dst = i === 0 ? u.uMetA.value : u.uMetB.value;
      if (!m) return;
      m.t += dt;
      const k = m.t / m.dur;
      if (k >= 1) {
        this.meteors[i] = null;
        if (i === 0) u.uMetK.value.x = 0;
        else u.uMetK.value.y = 0;
        return;
      }
      const head = m.from.clone().addScaledVector(m.dir, m.travel * k);
      const tail = head.clone().addScaledVector(m.dir, -m.tail * Math.min(1, k * 3));
      dst.set(head.x, head.y, tail.x, tail.y);
      const alpha = Math.sin(Math.PI * k) ** 0.6;
      if (i === 0) u.uMetK.value.x = alpha;
      else u.uMetK.value.y = alpha;
    });
  }

  // 四周压暗多少（0–1），牌桌拿去调房间的颜色
  get dark(): number {
    return this.shown * 0.7;
  }

  get active(): boolean {
    return this.on;
  }

  // 夜空开着没有。关掉时慢慢淡出
  setOn(on: boolean): void {
    if (on && !this.on && this.shown < 0.01) this.wave = 1e3;
    this.on = on;
  }

  // 双立直宣言：金色的光圈从 origin（她的立直棒）扫过整张桌子
  declare(origin: THREE.Vector3): void {
    this.on = true;
    this.skyU.uOrigin.value.set(origin.x, origin.z);
    this.wave = 0;
    this.shown = Math.max(this.shown, 0.001);
    this.boost = 1;
  }

  // 整片星空亮一下
  pulse(amount = 1): void {
    this.boost = Math.max(this.boost, amount);
  }

  // 转角上那颗星：at 是转角那张牌的位置（没有就收起来），lost 被错开了
  setBeacon(at: THREE.Vector3 | null, lost = false): void {
    this.beaconAt = at ? at.clone() : null;
    if (at) this.beaconLast = at.clone();
    this.beaconLost = lost;
  }

  // 星挂在哪（收起来以后是这一局它最后挂的地方；这一局没挂过是 null）
  get beaconPos(): THREE.Vector3 | null {
    const at = this.beaconAt ?? this.beaconLast;
    return at ? at.clone().setY(at.y + 1.5 * this.beaconScale) : null;
  }

  // 一颗四芒星闪一下：一下子亮起来，慢慢暗下去；grow 越大越往外胀
  flare(at: THREE.Vector3, size = 3, dur = 0.7, color: THREE.ColorRepresentation = GOLD, peak = 1, grow = 0.6): void {
    const f = this.flares.find((x) => !x.mesh.visible) ?? this.flares[0];
    f.mesh.visible = true;
    f.mesh.position.copy(at);
    f.u.uColor.value.set(color);
    f.t = 0;
    f.dur = dur;
    f.size = size;
    f.peak = peak;
    f.grow = grow;
    f.spin = Math.random() * 0.6 - 0.3;
  }

  // 一颗流星从 from 划一道弧飞到 to，一路撒下星屑；到了回调（放落点的特效）。head、tail：彗头和星屑的颜色
  comet(from: THREE.Vector3, to: THREE.Vector3 | (() => THREE.Vector3), dur = 0.55, lift = 3, size = 2.4, onHit?: () => void, head: THREE.ColorRepresentation = '#fff3cf', tail: THREE.ColorRepresentation = GOLD): void {
    const end = to instanceof THREE.Vector3 ? to.clone() : null;
    this.comets.push({ from: from.clone(), to: end ? () => end : (to as () => THREE.Vector3), t: 0, dur, lift, size, trail: 0, onHit, head, tail });
  }

  // 一个星座：points 上的星隔 gap 秒一颗颗亮起来，links（第几颗连第几颗）的线跟着画出来；一直挂到 clear 或 dropFigure
  figure(points: THREE.Vector3[], links: [number, number][], size = 1.6, gap = 0.16): void {
    this.dropFigure(true);
    points.forEach((p, i) => {
      const u = { uA: { value: 0 }, uSpin: { value: 0 }, uColor: { value: new THREE.Color(i % 3 === 1 ? '#cfe0ff' : '#ffe6a6') } };
      const mesh = new THREE.Mesh(this.flareGeo, add(u, FLARE_VERT, FLARE_FRAG));
      mesh.position.copy(p);
      mesh.scale.setScalar(size * (0.85 + 0.3 * ((i * 0.618) % 1)));
      mesh.renderOrder = 9;
      mesh.frustumCulled = false;
      this.fixed.push({ mesh, u, at: i * gap, seed: Math.random() * 10 });
      this.group.add(mesh);
    });
    const pos: number[] = [];
    const when: number[] = [];
    for (const [a, b] of links) {
      pos.push(points[a].x, points[a].y, points[a].z, points[b].x, points[b].y, points[b].z);
      when.push(a * gap, b * gap);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aWhen', new THREE.Float32BufferAttribute(when, 1));
    this.lineU.uT.value = 0;
    this.lines = new THREE.LineSegments(geo, add(this.lineU, LINE_VERT, LINE_FRAG));
    this.lines.renderOrder = 8;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.figT = 0;
    this.figOn = true;
  }

  // 星座收起来（now：马上拿掉，不淡出）
  dropFigure(now = false): void {
    this.figOn = false;
    if (!now) return;
    for (const f of this.fixed) {
      this.group.remove(f.mesh);
      (f.mesh.material as THREE.Material).dispose();
    }
    this.fixed.length = 0;
    if (this.lines) {
      this.group.remove(this.lines);
      this.lines.geometry.dispose();
      (this.lines.material as THREE.Material).dispose();
      this.lines = null;
    }
    this.figT = -1;
    this.figA = 0;
  }

  clear(): void {
    this.on = false;
    this.shown = 0;
    this.boost = 0;
    this.wave = 1e3;
    this.beaconAt = null;
    this.beaconLast = null;
    this.beaconA = 0;
    this.comets.length = 0;
    for (const f of this.flares) f.mesh.visible = false;
    this.dropFigure(true);
    this.group.visible = false;
    this.reseed();
  }

  update(dt: number, camera: THREE.Camera, resY: number): void {
    this.t += dt;
    const target = this.on ? 1 : 0;
    this.shown += (target - this.shown) * Math.min(1, dt * (this.on ? 3 : 1.6));
    if (!this.on && this.shown < 0.005) this.shown = 0;
    const busy = this.shown > 0 || this.comets.length > 0 || this.figT >= 0 || this.flares.some((f) => f.mesh.visible);
    this.group.visible = busy;
    this.sky.visible = this.shown > 0;
    this.dots.visible = this.shown > 0;
    if (!busy) return;

    // 星座
    if (this.figT >= 0) {
      this.figT += dt;
      this.figA += ((this.figOn ? 1 : 0) - this.figA) * Math.min(1, dt * (this.figOn ? 6 : 2.5));
      if (!this.figOn && this.figA < 0.01) this.dropFigure(true);
      else {
        this.lineU.uT.value = this.figT;
        this.lineU.uA.value = this.figA;
        for (const f of this.fixed) {
          const k = this.figT - f.at;
          // 亮起来那一下冲得高，之后落回来微微闪
          const pop = k < 0 ? 0 : 1 + 1.6 * Math.exp(-k * 5);
          const tw = 0.82 + 0.18 * Math.sin(this.t * (2 + f.seed * 0.3) + f.seed);
          f.u.uA.value = this.figA * Math.min(1, Math.max(0, k) / 0.06) * pop * tw * 0.75;
          f.u.uSpin.value = Math.sin(this.t * 0.5 + f.seed) * 0.1;
          f.mesh.quaternion.copy(camera.quaternion);
        }
      }
    }
    if (this.wave < 1e3) {
      this.wave += dt * this.half * 1.9;
      if (this.wave > this.half * 3.4) this.wave = 1e3;
    }
    this.boost *= Math.exp(-dt * 2.2);
    this.skyU.uTime.value = this.t;
    this.skyU.uA.value = this.shown;
    this.skyU.uWave.value = this.wave;
    this.skyU.uBoost.value = this.boost;
    if (this.shown > 0.5) this.updateMeteors(dt);
    this.moteU.uTime.value = this.t;
    this.moteU.uA.value = this.shown * Math.min(1, this.wave / (this.half * 2));
    const proj = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    this.moteU.uPx.value = resY * proj;
    this.skyU.uPx.value = resY * proj;
    this.skyU.uMin.value = Math.max(1.5, resY / 500);

    // 转角的星
    const wantA = this.beaconAt && this.on ? 1 : 0;
    this.beaconA += (wantA - this.beaconA) * Math.min(1, dt * 4);
    this.beaconDim += ((this.beaconLost ? 1 : 0) - this.beaconDim) * Math.min(1, dt * 5);
    const showBeacon = this.beaconA > 0.01 && !!this.beaconAt;
    this.beacon.visible = showBeacon;
    this.pillar.visible = showBeacon;
    if (showBeacon && this.beaconAt) {
      const s = this.beaconScale;
      const breathe = 1 + 0.12 * Math.sin(this.t * 2.6);
      const a = this.beaconA * (1 - this.beaconDim * 0.78) * (this.beaconLost ? 0.75 + 0.25 * Math.sin(this.t * 17) : 1);
      const c = GOLD.clone().lerp(PALE, this.beaconDim);
      this.beacon.position.copy(this.beaconAt).setY(this.beaconAt.y + 1.5 * s);
      this.beacon.quaternion.copy(camera.quaternion);
      this.beacon.scale.setScalar(3.6 * s * breathe);
      this.beaconU.uA.value = a;
      this.beaconU.uSpin.value = Math.sin(this.t * 0.7) * 0.12;
      this.beaconU.uColor.value.copy(c);
      this.pillar.position.copy(this.beaconAt).setY(this.beaconAt.y);
      // 光柱只绕竖轴转向镜头
      this.pillar.rotation.set(0, Math.atan2(camera.position.x - this.beaconAt.x, camera.position.z - this.beaconAt.z), 0);
      this.pillar.scale.set(0.9 * s, 5.5 * s, 1);
      this.pillarU.uA.value = a * 0.55;
      this.pillarU.uColor.value.copy(c);
    }

    for (const f of this.flares) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) {
        f.mesh.visible = false;
        continue;
      }
      f.mesh.quaternion.copy(camera.quaternion);
      f.mesh.scale.setScalar(f.size * (1 + f.grow * Math.pow(k, 0.5)));
      f.u.uA.value = f.peak * Math.min(1, k / 0.08) * Math.pow(1 - k, 1.8);
      f.u.uSpin.value = f.spin + k * 0.5;
    }

    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const e = k * k * (3 - 2 * k);
      const p = c.from.clone().lerp(c.to(), e);
      p.y += Math.sin(Math.PI * e) * c.lift;
      // 彗头：每帧放一颗很短命的大星；尾巴：隔一小段撒一颗小的
      this.flare(p, c.size, 0.12, c.head, 1, 0);
      c.trail += dt;
      while (c.trail > 0.018) {
        c.trail -= 0.018;
        const j = new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35);
        this.flare(p.clone().add(j), c.size * (0.25 + Math.random() * 0.3), 0.35 + Math.random() * 0.3, Math.random() < 0.3 ? '#bcd4ff' : c.tail, 0.6, 0.2);
      }
      if (k >= 1) {
        this.comets.splice(i, 1);
        c.onHit?.();
      }
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}

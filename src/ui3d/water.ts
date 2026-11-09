import * as THREE from 'three';

// 牌桌上的水：龙门渊透华的治水（牌桌像平静的水面，打进牌河的牌荡开涟漪）和天江衣的海底（越接近海底海水越涨，
// 最后把牌山淹没；海底牌上方映着月亮）。两个人同桌时是同一片水。
// 手法参考 Humpalumps/ultra-elements（MIT）的水（src/scene/pool.js、src/spells/water.js、src/vfx/Refraction.js）：
//   涟漪：GPU 上解波动方程的高度场（Evan Wallace 的 WebGL Water，pool.js 那样），每格高度 + 速度，
//     四邻拉普拉斯，牌落水是按牌的形状压下去的一块，桌框是反射墙（clamp-to-edge）。水面的法线来自它的斜率
//   水面：Schlick Fresnel（f0 = 0.02），反射天空或镜像（平静的水像镜子，透华的水面照出牌），GGX 高光，
//     涟漪把光聚到水底、在水底照出一圈圈明暗（pool.js 的 lens）
//   水下：Beer-Lambert 吸收（沿视线在水里走过的路越长，红、绿越少）加水里散射回来的颜色，
//     水底一层游动的焦散（common.js 的 caustic cookie：叠起来的折叠正弦）；水面切过牌的地方一圈水线
// 水下的颜色是改牌、桌布这些材质（wet()），不另外画一遍场景；水面是盖在上面的一层半透明网格。代码是照这些思路为牌桌重写的

// ---------- 水下：所有泡在水里的东西共用的参数 ----------

export const SEA = {
  // x 水面高度（桌面是 0），y 时间（秒），z 浓淡 0..1（0 时整段跳过），w 水池半宽（桌布）
  uSea: { value: new THREE.Vector4(-100, 0, 0, 14) },
  // x 涌浪的高度，y 焦散强度，z 水线亮度，w 月光照在海底的半径
  uSeaB: { value: new THREE.Vector4(0, 0, 0, 1.4) },
  // rgb 每单位的吸收，a 月光照在海底多亮
  uSeaAbs: { value: new THREE.Vector4(0.5, 0.14, 0.09, 0) },
  // 水里散射回来的颜色（线性）
  uSeaScatter: { value: new THREE.Color(0.01, 0.045, 0.085) },
  // xy 月光照在海底的中心（世界 xz）
  uSeaMoon: { value: new THREE.Vector2(0, 0) },
};

// 涌浪：几道方向不同的长波叠起来，水面网格、水线、水下用的都是这一个
const SWELL_GLSL = /* glsl */ `
float seaSwell(vec2 p, float t, float amp) {
  return amp * (0.5 * sin(dot(p, vec2(0.33, 0.13)) + t * 0.9)
              + 0.32 * sin(dot(p, vec2(-0.19, 0.29)) * 1.3 + t * 1.15)
              + 0.18 * sin(dot(p, vec2(0.06, -0.41)) * 1.7 + t * 1.45));
}
vec2 seaSwellSlope(vec2 p, float t, float amp) {
  return amp * (0.5 * cos(dot(p, vec2(0.33, 0.13)) + t * 0.9) * vec2(0.33, 0.13)
              + 0.32 * 1.3 * cos(dot(p, vec2(-0.19, 0.29)) * 1.3 + t * 1.15) * vec2(-0.19, 0.29)
              + 0.18 * 1.7 * cos(dot(p, vec2(0.06, -0.41)) * 1.7 + t * 1.45) * vec2(0.06, -0.41));
}
// 焦散：两层折叠的正弦，越尖越亮，慢慢游动
float seaCaustic(vec2 p, float t) {
  vec2 w = p * 2.1 + vec2(sin(p.y * 1.9 + t * 1.3), cos(p.x * 1.6 - t * 1.1));
  float k = abs(sin(w.x) * sin(w.y));
  vec2 q = p * 1.37 + vec2(t * 0.23, -t * 0.19);
  vec2 w2 = q * 2.0 + vec2(cos(q.y * 2.3 - t * 0.9), sin(q.x * 2.1 + t * 1.2));
  float k2 = abs(sin(w2.x) * sin(w2.y));
  return pow(1.0 - k, 7.0) * 0.75 + pow(1.0 - k2, 9.0) * 0.55;
}
`;

const WET_PARS_VERT = /* glsl */ `
varying vec3 vSeaW;
`;
const WET_VERT = /* glsl */ `
{
  vec4 seaW = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  seaW = batchingMatrix * seaW;
  #endif
  #ifdef USE_INSTANCING
  seaW = instanceMatrix * seaW;
  #endif
  vSeaW = (modelMatrix * seaW).xyz;
}
`;
const WET_PARS_FRAG = /* glsl */ `
uniform vec4 uSea;
uniform vec4 uSeaB;
uniform vec4 uSeaAbs;
uniform vec3 uSeaScatter;
uniform vec2 uSeaMoon;
varying vec3 vSeaW;
${SWELL_GLSL}
vec3 seaShade(vec3 col) {
  if (uSea.z <= 0.0) return col;
  vec3 p = vSeaW;
  if (max(abs(p.x), abs(p.z)) > uSea.w + 0.03) return col;
  float depth = uSea.x + seaSwell(p.xz, uSea.y, uSeaB.x) - p.y;
  if (depth < -0.08) return col;
  // 这个面朝哪（屏幕空间求导，基础材质没有法线也能用）：水线只画在竖着的面上，焦散主要落在朝上的面上
  vec3 nW = normalize(cross(dFdx(p), dFdy(p)));
  float side = 1.0 - abs(nW.y);
  // 水线：水面切过牌、桌框的地方一道亮线，上面一点是打湿的亮边
  float line = uSeaB.z * side * (smoothstep(0.045, 0.0, abs(depth)) + 0.35 * smoothstep(0.08, 0.0, -depth) * step(depth, 0.0));
  vec3 lineCol = vec3(0.55, 0.75, 0.85) * line;
  if (depth <= 0.0) return col + lineCol * uSea.z;
  vec3 toCam = cameraPosition - p;
  float len = length(toCam);
  // 视线从水面进来、走到这一点：在水里走过的路
  float path = depth * len / max(toCam.y, 0.1 * len);
  vec3 T = exp(-uSeaAbs.rgb * path);
  float up = 0.35 + 0.65 * max(nW.y, 0.0);
  float c = seaCaustic(p.xz, uSea.y) * uSeaB.y * up * exp(-depth * 0.45) * smoothstep(0.0, 0.12, depth);
  // 月光：海底牌那一块一圈柔光
  vec2 dm = p.xz - uSeaMoon;
  float moon = uSeaAbs.a * exp(-dot(dm, dm) / (uSeaB.w * uSeaB.w));
  vec3 lit = col * (1.0 + c + moon * 1.6) + vec3(0.55, 0.7, 0.9) * moon * 0.12;
  vec3 under = lit * T + uSeaScatter * (1.0 - T);
  return mix(col, under, uSea.z) + lineCol * uSea.z;
}
`;

// 让一个材质泡得了水：水面以下按上面的算法变色。在材质第一次编译之前调用（之后才加会让它重新编译一次）。
// 不在水里时 uSea.z 是 0，着色器开头就跳过
const wetCompile = (shader: THREE.WebGLProgramParametersWithUniforms): void => {
  shader.uniforms.uSea = SEA.uSea;
  shader.uniforms.uSeaB = SEA.uSeaB;
  shader.uniforms.uSeaAbs = SEA.uSeaAbs;
  shader.uniforms.uSeaScatter = SEA.uSeaScatter;
  shader.uniforms.uSeaMoon = SEA.uSeaMoon;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${WET_PARS_VERT}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${WET_VERT}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${WET_PARS_FRAG}`)
    .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = seaShade(gl_FragColor.rgb);\n#include <tonemapping_fragment>');
};

export function wet<M extends THREE.Material>(m: M): M {
  if (m.userData.wet) return m;
  m.userData.wet = true;
  m.onBeforeCompile = wetCompile;
  return m;
}

// 复制出来的材质（淡入淡出、隐身用的）照原来的泡不泡水
export function wetLike<M extends THREE.Material>(from: THREE.Material, m: M): M {
  return from.userData.wet ? wet(m) : m;
}

// ---------- 涟漪：GPU 上的波动方程 ----------

const SIM_N = 256;
const SIM_STEP = 1 / 120;
const MAX_DROPS = 8;

const SIM_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const SIM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform float uC2;
uniform float uDamp;
uniform float uSize;
uniform float uDx;
uniform vec4 uDrops[${MAX_DROPS}];   // 世界 x, z, 幅度（+ 抬高），羽化半径
uniform vec4 uShape[${MAX_DROPS}];   // 半宽、半长、转角（弧度），-
uniform int uDropCount;
varying vec2 vUv;
void main() {
  vec4 s = texture2D(uPrev, vUv);
  float hl = texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r, hr = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r;
  float hd = texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r, hu = texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r;
  float avg = 0.25 * (hl + hr + hd + hu);
  s.g += (avg - s.r) * 4.0 * uC2;
  s.g *= uDamp;
  s.r += s.g;
  // 一点点黏性：最细的那几格起伏（数值上的棋盘格）很快抹平，一圈圈大的涟漪不受影响
  s.r = mix(s.r, avg, 0.06) * 0.9995;
  vec2 m = (vUv - 0.5) * uSize;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uDropCount) break;
    vec4 d = uDrops[i];
    vec4 sh = uShape[i];
    vec2 q = m - d.xy;
    float c = cos(sh.z), sn = sin(sh.z);
    q = vec2(c * q.x - sn * q.y, sn * q.x + c * q.y);
    // 圆角矩形（牌的样子）往外羽化 d.w：里面整块压下去，边上余弦过渡
    float dist = length(max(abs(q) - sh.xy, 0.0));
    float k = clamp(1.0 - dist / max(d.w, 1e-3), 0.0, 1.0);
    s.r += (0.5 - 0.5 * cos(k * 3.14159265)) * d.z;
  }
  s.ba = vec2(hr - hl, hu - hd) / (2.0 * uDx);
  gl_FragColor = s;
}
`;

class RippleSim {
  readonly targets: THREE.WebGLRenderTarget[];
  private cur = 0;
  private acc = 0;
  private calm = 99;
  private drops: { pos: THREE.Vector4; shape: THREE.Vector4 }[] = [];
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private u: Record<string, THREE.IUniform>;
  readonly size: number;

  constructor(renderer: THREE.WebGLRenderer, half: number) {
    this.size = half * 2;
    const ext = renderer.extensions;
    const type = ext.has('OES_texture_float_linear') && ext.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.HalfFloatType;
    const rt = () =>
      new THREE.WebGLRenderTarget(SIM_N, SIM_N, {
        type,
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
      });
    this.targets = [rt(), rt()];
    const dx = this.size / SIM_N;
    // 波速：一圈涟漪三四秒荡到桌边。c2 = (c·dt/dx)² 要小于 0.5 才稳定
    const c = 3.4;
    this.u = {
      uPrev: { value: null },
      uTexel: { value: new THREE.Vector2(1 / SIM_N, 1 / SIM_N) },
      uC2: { value: Math.min(0.45, ((c * SIM_STEP) / dx) ** 2) },
      uDamp: { value: 0.993 },
      uSize: { value: this.size },
      uDx: { value: dx },
      uDrops: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) },
      uShape: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) },
      uDropCount: { value: 0 },
    };
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: SIM_VERT, fragmentShader: SIM_FRAG, uniforms: this.u, depthTest: false, depthWrite: false }),
    );
    this.quad.frustumCulled = false;
    // 一开始两张都清成 0（有的驱动新建的浮点贴图不是 0）
    const prev = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of this.targets) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setClearColor(clear, alpha);
    renderer.setRenderTarget(prev);
  }

  get texture(): THREE.Texture {
    return this.targets[this.cur].texture;
  }

  // 一块水被压下去（amp < 0）或抬起来：hw × hh 的圆角矩形（转 angle），边上羽化 feather
  drop(x: number, z: number, amp: number, hw: number, hh: number, angle = 0, feather = 0.35): void {
    this.calm = 0;
    if (this.drops.length >= MAX_DROPS) this.drops.shift();
    this.drops.push({ pos: new THREE.Vector4(x, z, amp, feather), shape: new THREE.Vector4(hw, hh, angle, 0) });
  }

  setDamp(d: number): void {
    this.u.uDamp.value = d;
  }

  update(renderer: THREE.WebGLRenderer, dt: number): void {
    // 平静了八秒（涟漪早就平了）就不再算
    if ((this.calm += dt) > 8 && !this.drops.length) return;
    this.acc = Math.min(this.acc + dt, SIM_STEP * 4);
    if (this.acc < SIM_STEP) return;
    const prev = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    let first = true;
    while (this.acc >= SIM_STEP) {
      this.acc -= SIM_STEP;
      const n = first ? this.drops.length : 0;
      this.u.uDropCount.value = n;
      for (let i = 0; i < n; i++) {
        (this.u.uDrops.value as THREE.Vector4[])[i].copy(this.drops[i].pos);
        (this.u.uShape.value as THREE.Vector4[])[i].copy(this.drops[i].shape);
      }
      this.u.uPrev.value = this.targets[this.cur].texture;
      this.cur ^= 1;
      renderer.setRenderTarget(this.targets[this.cur]);
      renderer.render(this.quad, this.cam);
      first = false;
    }
    this.drops = [];
    renderer.autoClear = auto;
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}

// ---------- 水面 ----------

const SURF_VERT = /* glsl */ `
uniform vec4 uSea;
uniform vec4 uSeaB;
varying vec3 vW;
${SWELL_GLSL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  w.y = uSea.x + seaSwell(w.xz, uSea.y, uSeaB.x);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SURF_FRAG = /* glsl */ `
uniform vec4 uSea;
uniform vec4 uSeaB;
uniform sampler2D uSim;
uniform float uSimTexel;
uniform sampler2D uMirror;
uniform mat4 uMirrorMatrix;
uniform float uMirrorOn;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyLow;
uniform vec3 uBody;
// x 反射比 Fresnel 多出来多少，y 水本身的颜色盖多少，z 涟漪聚光的明暗，w 微风
uniform vec4 uLook;
// 月亮的倒影：xy 位置（世界 xz），z 半径，w 亮度
uniform vec4 uMoonA;
// x 明暗交界（cos 2πp），y 1 上弦（右边亮）/ -1 下弦，z 新月时只剩一圈细边
uniform vec4 uMoonB;
uniform vec3 uMoonDir;
varying vec3 vW;
${SWELL_GLSL}
// Dave Hoskins 的 Hash without Sine（MIT，shadertoy.com/view/4djSRW）
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float ggx(float nh, float a) {
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159265 * d * d);
}
void main() {
  float t = uSea.y;
  vec2 suv = vW.xz / (2.0 * uSea.w) + 0.5;
  vec4 s = texture2D(uSim, suv);
  // 涟漪的斜率 + 涌浪 + 一点点微风（水面永远不是死的）
  vec2 slope = s.ba + seaSwellSlope(vW.xz, t, uSeaB.x);
  vec2 bp = vW.xz * 1.7;
  slope += uLook.w * vec2(vnoise(bp + vec2(t * 0.31, t * 0.17)) - vnoise(bp + vec2(3.7 - t * 0.23, 1.3 + t * 0.29)),
                          vnoise(bp * 1.3 + vec2(5.1 + t * 0.19, -t * 0.27)) - vnoise(bp * 1.3 + vec2(-t * 0.35, 7.9 + t * 0.21)));
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 V = normalize(cameraPosition - vW);
  float NoV = max(dot(N, V), 1e-3);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  float Fr = clamp(F + uLook.x * (1.0 - F), 0.0, 1.0);
  vec3 R = reflect(-V, N);
  // 天空（房间）：越往头顶越亮，头顶一盏大灯。平的水面反射的方向正好在明暗变化最快的地方，涟漪一歪就是一道亮一道暗
  vec3 refl = mix(uSkyLow, uSkyTop, smoothstep(0.25, 0.98, R.y)) + uSkyTop * 1.6 * pow(max(R.y, 0.0), 48.0);
  if (uMirrorOn > 0.0) {
    // 镜像：水面上这一点经过镜像相机落在哪，再按水面的斜率挪一点（涟漪把倒影拉歪）；照到东西的地方换成倒影，别处还是天空
    vec4 c = uMirrorMatrix * vec4(vW.x, uSea.x, vW.z, 1.0);
    vec2 uv = c.xy / c.w + vec2(slope.x, -slope.y) * 0.05;
    vec4 m = texture2D(uMirror, clamp(uv, 0.001, 0.999));
    refl = mix(refl, m.rgb, m.a * uMirrorOn);
  }
  // 主光的高光：涟漪的波峰、涌浪上一闪一闪
  vec3 L = normalize(uKeyDir);
  vec3 H = normalize(L + V);
  float nl = max(dot(N, L), 0.0);
  vec3 spec = uKeyColor * ggx(max(dot(N, H), 0.0), 0.045) * F * nl * 0.25;
  // 涟漪把光聚到水底：高度场的曲率，凸处亮、凹处暗（pool.js 的 lens）
  float e = uSimTexel * 1.5;
  float lap = texture2D(uSim, suv + vec2(e, 0.0)).r + texture2D(uSim, suv - vec2(e, 0.0)).r + texture2D(uSim, suv + vec2(0.0, e)).r + texture2D(uSim, suv - vec2(0.0, e)).r - 4.0 * s.r;
  float lens = clamp(-lap * uLook.z, -1.0, 1.0);
  // 月亮的倒影：被波浪打碎、往近处拉长，月相照衣的月亮；再加一条月光的碎光路
  vec3 moon = vec3(0.0);
  if (uMoonA.w > 0.0) {
    // 波浪把倒影一条条横着切开、左右错开（离镜头近的方向拉长），条和条之间露出暗的水
    float row = vW.z * 7.0 + t * 1.7;
    float chop = sin(row + 2.0 * vnoise(vec2(vW.x * 1.3, row * 0.5)));
    vec2 q = (vW.xz + slope * 1.4 + vec2(0.09 * chop, 0.0) - uMoonA.xy) / uMoonA.z;
    q.y /= 1.35;
    vec2 m2 = vec2(q.x, -q.y);
    float r = length(m2);
    float disc = smoothstep(1.0, 0.93, r);
    float edge = sqrt(max(1.0 - m2.y * m2.y, 0.0));
    float lit = smoothstep(-0.06, 0.06, uMoonB.y * m2.x - uMoonB.x * edge);
    // 月面：边缘暗一点，几块灰色的月海
    float maria = 0.72 + 0.28 * smoothstep(0.35, 0.65, vnoise(m2 * 2.6 + 4.1));
    float limb = 0.75 + 0.25 * sqrt(max(1.0 - r * r, 0.0));
    float gaps = mix(0.45, 1.0, smoothstep(-0.35, 0.25, sin(vW.z * 13.0 - t * 2.3 + 3.0 * vnoise(vW.xz * 2.0 + t * 0.3))));
    float rim = smoothstep(0.84, 0.95, r) * disc * uMoonB.z;
    float halo = exp(-r * r * 0.9) * 0.12 + exp(-r * r * 0.15) * 0.05;
    vec3 HM = normalize(normalize(uMoonDir) + V);
    float road = ggx(max(dot(N, HM), 0.0), 0.07) * 0.003 * exp(-r * r * 0.03) * gaps;
    moon = vec3(0.86, 0.92, 1.0) * (disc * (0.05 + 0.95 * lit) * maria * limb * gaps * 0.95 + rim * 0.5 + halo + road) * uMoonA.w;
  }
  vec3 col = refl * Fr + spec + moon;
  float alpha = Fr + uLook.y * (1.0 - Fr);
  col += uBody * uLook.y * (1.0 - Fr);
  col += max(lens, 0.0) * vec3(0.75, 0.88, 1.0) * 0.6;
  alpha += max(-lens, 0.0) * 0.35;
  float lum = dot(spec + moon + max(lens, 0.0) * 0.6, vec3(0.3, 0.6, 0.1));
  alpha = clamp(max(alpha, lum), 0.0, 1.0);
  // 桌框内沿：水面边上一圈细亮线（水贴着框的弯月面）
  vec2 ed = uSea.w - abs(vW.xz);
  float rimLine = smoothstep(0.08, 0.0, min(ed.x, ed.y));
  col += vec3(0.6, 0.8, 0.9) * rimLine * 0.5;
  alpha = max(alpha, rimLine * 0.5);
  gl_FragColor = vec4(col / max(alpha, 1e-3), alpha * uSea.z);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// 水池四面（水比桌框高时）：从侧面看进去的水
const SIDE_VERT = /* glsl */ `
uniform vec4 uSea;
uniform vec4 uSeaB;
uniform float uFloor;
varying vec3 vW;
varying float vV;
${SWELL_GLSL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  float top = uSea.x + seaSwell(w.xz, uSea.y, uSeaB.x);
  w.y = mix(uFloor, max(top, uFloor), position.y);
  vV = position.y;
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const SIDE_FRAG = /* glsl */ `
uniform vec4 uSea;
uniform vec3 uBody;
uniform float uFloor;
varying vec3 vW;
varying float vV;
${SWELL_GLSL}
void main() {
  float h = max(uSea.x - uFloor, 1e-3);
  float y = (vW.y - uFloor) / h;
  float shimmer = seaCaustic(vec2(vW.x + vW.z, vW.y * 3.0), uSea.y) * 0.25;
  float top = smoothstep(0.92, 1.0, y);
  vec3 col = uBody * 2.2 + vec3(0.55, 0.75, 0.85) * (top * 1.2 + shimmer);
  float a = 0.28 + 0.2 * (1.0 - y) + top * 0.5;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uSea.z);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// 两种水的样子
export interface WaterLook {
  absorb: THREE.Vector3; // 每单位的吸收（红绿蓝）
  scatter: THREE.Color; // 水里散射回来的颜色
  body: THREE.Color; // 水面本身的颜色
  skyTop: THREE.Color;
  skyLow: THREE.Color;
  reflect: number; // 反射比 Fresnel 多出来多少
  bodyAlpha: number;
  lens: number;
  breeze: number;
  swell: number; // 涌浪的高度
  caustic: number;
  line: number; // 水线亮度
  mirror: number; // 镜像倒影浓淡
}

// 透华：静水。像一面镜子，照出牌和房间；水本身几乎透明
export const STILL_LOOK: WaterLook = {
  absorb: new THREE.Vector3(0.6, 0.2, 0.12),
  scatter: new THREE.Color(0.02, 0.06, 0.1),
  body: new THREE.Color(0.02, 0.07, 0.12),
  skyTop: new THREE.Color(0.32, 0.45, 0.6),
  skyLow: new THREE.Color(0.06, 0.1, 0.16),
  reflect: 0.2,
  bodyAlpha: 0.1,
  lens: 30,
  breeze: 0.006,
  swell: 0,
  caustic: 0,
  line: 0.5,
  mirror: 1,
};

// 衣：夜里的海。清，但深处发蓝绿；天空是深蓝的夜，月亮照在海底牌上
export const SEA_LOOK: WaterLook = {
  absorb: new THREE.Vector3(1.05, 0.32, 0.17),
  scatter: new THREE.Color(0.004, 0.04, 0.07),
  body: new THREE.Color(0.004, 0.028, 0.055),
  skyTop: new THREE.Color(0.07, 0.11, 0.22),
  skyLow: new THREE.Color(0.012, 0.02, 0.045),
  reflect: 0.1,
  bodyAlpha: 0.2,
  lens: 40,
  breeze: 0.02,
  swell: 0.035,
  caustic: 0.9,
  line: 0.9,
  mirror: 0.55,
};

const lerpLook = (a: WaterLook, b: WaterLook, k: number): WaterLook => ({
  absorb: a.absorb.clone().lerp(b.absorb, k),
  scatter: a.scatter.clone().lerp(b.scatter, k),
  body: a.body.clone().lerp(b.body, k),
  skyTop: a.skyTop.clone().lerp(b.skyTop, k),
  skyLow: a.skyLow.clone().lerp(b.skyLow, k),
  reflect: THREE.MathUtils.lerp(a.reflect, b.reflect, k),
  bodyAlpha: THREE.MathUtils.lerp(a.bodyAlpha, b.bodyAlpha, k),
  lens: THREE.MathUtils.lerp(a.lens, b.lens, k),
  breeze: THREE.MathUtils.lerp(a.breeze, b.breeze, k),
  swell: THREE.MathUtils.lerp(a.swell, b.swell, k),
  caustic: THREE.MathUtils.lerp(a.caustic, b.caustic, k),
  line: THREE.MathUtils.lerp(a.line, b.line, k),
  mirror: THREE.MathUtils.lerp(a.mirror, b.mirror, k),
});

// 月亮的倒影
export interface MoonReflection {
  x: number;
  z: number;
  phase: number; // 0 新月 … 0.5 满月 … 接近 1 残月
  amount: number; // 0..1
}

export class Water {
  readonly group = new THREE.Group();
  private sim: RippleSim;
  private top: THREE.Mesh;
  private sides: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private sideU: Record<string, THREE.IUniform>;
  private mirrorRT: THREE.WebGLRenderTarget | null = null;
  private mirrorCam = new THREE.PerspectiveCamera();
  private t = 0;
  // 水面高度和浓淡：往目标慢慢走
  level = 0;
  amount = 0;
  private targetLevel = 0;
  private targetAmount = 0;
  private rise = 0.6; // 水面每秒最多走多少（排水时快）
  // 静水（0）到海（1）
  private seaMix = 0;
  private seaTarget = 0;
  private moon: MoonReflection | null = null;
  private moonAmt = 0;
  // 海有多“夜”（0..1）：海水涨得越高四周越暗，月亮越亮
  get night(): number {
    return this.seaMix * Math.min(1, Math.max(0, this.level / 1.2)) * (this.amount > 0 ? 1 : 0);
  }
  // 手机：不画镜像（多画一遍整个场景太费）
  readonly lite: boolean;

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly half: number,
    private floor: number,
  ) {
    this.lite = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false) && Math.min(window.innerWidth, window.innerHeight) < 820;
    this.sim = new RippleSim(renderer, half);
    this.u = {
      uSea: SEA.uSea,
      uSeaB: SEA.uSeaB,
      uSim: { value: this.sim.texture },
      uSimTexel: { value: 1 / SIM_N },
      uMirror: { value: null },
      uMirrorMatrix: { value: new THREE.Matrix4() },
      uMirrorOn: { value: 0 },
      uKeyDir: { value: new THREE.Vector3(-6, 22, 10).normalize() },
      uKeyColor: { value: new THREE.Color('#fff4e0').multiplyScalar(2.2) },
      uSkyTop: { value: new THREE.Color() },
      uSkyLow: { value: new THREE.Color() },
      uBody: { value: new THREE.Color() },
      uLook: { value: new THREE.Vector4() },
      uMoonA: { value: new THREE.Vector4() },
      uMoonB: { value: new THREE.Vector4() },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    };
    const topMat = new THREE.ShaderMaterial({
      vertexShader: SURF_VERT,
      fragmentShader: SURF_FRAG,
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
    });
    // 细分一下，涌浪能让水面起伏
    this.top = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2, 96, 96).rotateX(-Math.PI / 2), topMat);
    this.top.renderOrder = 1;
    this.top.frustumCulled = false;
    this.sideU = { uSea: SEA.uSea, uSeaB: SEA.uSeaB, uBody: this.u.uBody, uFloor: { value: floor } };
    this.sides = new THREE.Mesh(sideGeometry(half), new THREE.ShaderMaterial({ vertexShader: SIDE_VERT, fragmentShader: SIDE_FRAG, uniforms: this.sideU, transparent: true, depthWrite: false }));
    this.sides.renderOrder = 1;
    this.sides.frustumCulled = false;
    this.group.add(this.top, this.sides);
    this.group.visible = false;
  }

  // level：水面高度（世界单位，桌面是 0）；amount：浓淡；sea：海（衣）还是静水（透华）
  set(level: number, amount: number, sea: boolean): void {
    this.targetLevel = level;
    this.targetAmount = amount;
    this.seaTarget = sea ? 1 : 0;
  }

  // 水面往目标走的快慢（单位每秒）：涨潮慢，砸牌把水打散时快
  setRate(r: number): void {
    this.rise = r;
  }

  setMoon(m: MoonReflection | null): void {
    if (m) this.moon = { ...m };
    else if (this.moon) this.moon.amount = 0;
  }

  setKeyLight(dir: THREE.Vector3, color: THREE.Color, intensity: number): void {
    (this.u.uKeyDir.value as THREE.Vector3).copy(dir).normalize();
    (this.u.uKeyColor.value as THREE.Color).copy(color).multiplyScalar(intensity);
  }

  get active(): boolean {
    return this.group.visible;
  }

  // 这一点在不在水里（水面以下）
  under(p: THREE.Vector3): boolean {
    return this.active && this.amount > 0.05 && p.y < this.level && Math.max(Math.abs(p.x), Math.abs(p.z)) < this.half;
  }

  // 牌落进水里：牌的样子压下去一块（hw × hh，长边朝 angle），荡开一圈圈涟漪
  splashTile(x: number, z: number, angle: number, strength = 1): void {
    if (!this.active || this.amount < 0.05) return;
    this.sim.drop(x, z, -0.05 * strength, 0.5, 0.68, angle, 0.5);
  }

  // 一滴水 / 一团水砸进来（amp 负的是压下去）
  drop(x: number, z: number, amp: number, radius: number): void {
    if (!this.active || this.amount < 0.05) return;
    this.sim.drop(x, z, amp, 0, 0, 0, radius);
  }

  // camPos：镜头在哪（月亮的倒影要正好落在海底牌上方，天上的月亮就在镜头看过去反射的方向）
  update(dt: number, camPos?: THREE.Vector3): void {
    this.t += dt;
    const step = this.rise * dt;
    this.level += THREE.MathUtils.clamp(this.targetLevel - this.level, -step * 4, step);
    this.amount += (this.targetAmount - this.amount) * (1 - Math.exp(-dt * 1.5));
    if (this.targetAmount === 0 && this.amount < 0.01) this.amount = 0;
    this.seaMix += (this.seaTarget - this.seaMix) * (1 - Math.exp(-dt * 1.2));
    const moonGoal = this.moon?.amount ?? 0;
    this.moonAmt += (moonGoal - this.moonAmt) * (1 - Math.exp(-dt * (moonGoal > this.moonAmt ? 0.9 : 3)));
    const on = this.amount > 0;
    this.group.visible = on;
    const look = lerpLook(STILL_LOOK, SEA_LOOK, this.seaMix);
    SEA.uSea.value.set(this.level, this.t, on ? this.amount : 0, this.half);
    SEA.uSeaB.value.set(look.swell * Math.min(1, this.level / 0.3), look.caustic, look.line, 1.6);
    SEA.uSeaAbs.value.set(look.absorb.x, look.absorb.y, look.absorb.z, this.moonAmt * 0.9);
    SEA.uSeaScatter.value.copy(look.scatter);
    if (this.moon) SEA.uSeaMoon.value.set(this.moon.x, this.moon.z);
    if (!on) return;
    this.sim.update(this.renderer, dt);
    this.u.uSim.value = this.sim.texture;
    (this.u.uSkyTop.value as THREE.Color).copy(look.skyTop);
    (this.u.uSkyLow.value as THREE.Color).copy(look.skyLow);
    (this.u.uBody.value as THREE.Color).copy(look.body);
    (this.u.uLook.value as THREE.Vector4).set(look.reflect, look.bodyAlpha, look.lens, look.breeze);
    this.u.uMirrorOn.value = this.lite ? 0 : look.mirror;
    const m = this.moon;
    if (m && this.moonAmt > 0.002) {
      (this.u.uMoonA.value as THREE.Vector4).set(m.x, m.z, 1.0, this.moonAmt);
      if (camPos) (this.u.uMoonDir.value as THREE.Vector3).set(m.x - camPos.x, camPos.y - this.level, m.z - camPos.z).normalize();
      const p = m.phase - Math.floor(m.phase);
      // 新月几乎看不见：留一圈细边
      (this.u.uMoonB.value as THREE.Vector4).set(Math.cos(p * Math.PI * 2), p <= 0.5 ? 1 : -1, p < 0.07 || p > 0.93 ? 1 : 0, 0);
    } else (this.u.uMoonA.value as THREE.Vector4).w = 0;
    // 水比桌框高才有侧面
    this.sides.visible = this.level > this.floor + 0.02;
    this.sim.setDamp(THREE.MathUtils.lerp(0.993, 0.991, this.seaMix));
  }

  // 镜像：从水面下对称的位置看上来，画到一张小一点的图里（只画水面以上的东西）。每帧画主画面之前调用
  renderMirror(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const mirrorOn = this.u.uMirrorOn.value as number;
    if (!this.active || this.lite || mirrorOn <= 0) return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.floor(size.x / 2));
    const h = Math.max(2, Math.floor(size.y / 2));
    if (!this.mirrorRT) this.mirrorRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 2 });
    else if (this.mirrorRT.width !== w || this.mirrorRT.height !== h) this.mirrorRT.setSize(w, h);
    const y = this.level;
    camera.updateMatrixWorld();
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= y + 0.01) return;
    const mc = this.mirrorCam;
    const normal = new THREE.Vector3(0, 1, 0);
    const origin = new THREE.Vector3(0, y, 0);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = origin.clone().sub(look).reflect(normal).negate().add(origin);
    mc.position.copy(origin.clone().sub(camPos).reflect(normal).negate().add(origin));
    mc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    mc.lookAt(target);
    mc.far = camera.far;
    mc.updateMatrixWorld();
    mc.projectionMatrix.copy(camera.projectionMatrix);
    // 把镜像相机的近裁面斜过来贴着水面（Lengyel 的斜裁面），水面以下的东西不进倒影
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin).applyMatrix4(mc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = mc.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x;
    pm[6] = clip.y;
    pm[10] = clip.z + 1;
    pm[14] = clip.w;
    mc.projectionMatrixInverse.copy(mc.projectionMatrix).invert();
    // 水面上一点在倒影图里的位置
    (this.u.uMirrorMatrix.value as THREE.Matrix4).set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mc.projectionMatrix).multiply(mc.matrixWorldInverse);
    const prevTarget = r.getRenderTarget();
    const shadows = r.shadowMap.autoUpdate;
    const vis = this.group.visible;
    // 倒影里的东西不泡水（水面以下的已经被斜裁面切掉）；背景透明，水面上没照到东西的地方用天空
    const amt = SEA.uSea.value.z;
    SEA.uSea.value.z = 0;
    this.group.visible = false;
    const bg = scene.background;
    scene.background = null;
    const clearColor = r.getClearColor(new THREE.Color());
    const clearAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.mirrorRT);
    r.clear();
    r.render(scene, mc);
    r.setRenderTarget(prevTarget);
    r.setClearColor(clearColor, clearAlpha);
    scene.background = bg;
    r.shadowMap.autoUpdate = shadows;
    this.group.visible = vis;
    SEA.uSea.value.z = amt;
    this.u.uMirror.value = this.mirrorRT.texture;
  }

  dispose(): void {
    this.sim.dispose();
    this.mirrorRT?.dispose();
    this.top.geometry.dispose();
    this.sides.geometry.dispose();
    (this.top.material as THREE.Material).dispose();
    (this.sides.material as THREE.Material).dispose();
    SEA.uSea.value.z = 0;
  }
}

// 水池的四面：四块竖着的面，朝外；y 是 0（桌框顶）到 1（水面），顶点着色器里换成真的高度
function sideGeometry(half: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = 48;
  const faces = [
    [new THREE.Vector2(-half, half), new THREE.Vector2(half, half)],
    [new THREE.Vector2(half, half), new THREE.Vector2(half, -half)],
    [new THREE.Vector2(half, -half), new THREE.Vector2(-half, -half)],
    [new THREE.Vector2(-half, -half), new THREE.Vector2(-half, half)],
  ];
  for (const [a, b] of faces) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      pos.push(p.x, 0, p.y, p.x, 1, p.y);
    }
    for (let i = 0; i < n; i++) {
      const k = base + i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

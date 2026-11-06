import * as THREE from 'three';

// 初美鸣出来的东、北中间那张上的紫色光柱，照动画原作：从牌面直直往上，和牌面差不多宽，
// 底下最亮、往上慢慢淡掉，两边柔和；牌面本身也染上一层紫光。
// 光柱是一根没有顶和底的扁圆筒：正对视线的地方浓、侧着的边上淡（按法线和视线的夹角），前后两层叠起来，看着像一团光而不是一张片。
// 同一根筒画两遍：一遍普通半透明把后面的东西染紫（压在白牌、黄牌背上也看得清），一遍叠加发亮（暗下来的星空里会发光）。
// 外面再套一层更宽更淡的。都是牌的子物体，牌放在哪、怎么转，光柱都跟着

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  // 只看横截面上的夹角（视线去掉顺着光柱的分量），俯视时也是中间浓、两边淡
  vec3 axis = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  vec3 v = cameraPosition - world.xyz;
  v -= axis * dot(v, axis);
  vFacing = abs(dot(n, normalize(v + 1e-5)));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BEAM_FRAG = /* glsl */ `
#define PI 3.14159265
uniform vec3 uColor;
uniform float uA;
uniform float uTime;
varying vec2 vUv;
varying float vFacing;
void main() {
  // 横向：正对视线的地方浓、侧边淡；纵向：底下亮，往上淡
  float edge = pow(vFacing, 1.6);
  float v = vUv.y;
  float rise = (0.55 + 0.45 * exp(-v * 3.0)) * pow(1.0 - v, 0.9);
  // 很轻的一点往上流的明暗，不抢眼
  float shimmer = 0.88 + 0.12 * sin(v * 9.0 - uTime * 1.6 + vUv.x * 12.0);
  float a = clamp(edge * rise * shimmer * uA, 0.0, 1.0);
#ifdef GLOW
  gl_FragColor = vec4(uColor * a, 1.0);
#else
  gl_FragColor = vec4(uColor, a);
#endif
}
`;

// 牌面上的一层紫光：中间浓、到牌边淡掉
const WASH_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uA;
varying vec2 vUv;
varying float vFacing;
void main() {
  vec2 p = abs(vUv * 2.0 - 1.0);
  float m = (1.0 - smoothstep(0.55, 1.0, p.x)) * (1.0 - smoothstep(0.6, 1.0, p.y));
  gl_FragColor = vec4(uColor, clamp(m * uA, 0.0, 1.0));
}
`;

// glow：叠加发亮；不然是普通半透明（把后面的东西染紫）
const beamMat = (frag: string, color: string, glow: boolean) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 0 }, uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: frag,
    defines: glow ? { GLOW: '' } : {},
    transparent: true,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

// 扁圆筒：底面是 w×h 的椭圆、高 height，开口朝牌面的法线（本地 +z），底在 z=0
function tube(w: number, h: number, height: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1, true);
  g.translate(0, 0.5, 0);
  g.scale(w, height, h);
  // 圆柱的轴是 y，转到 z（牌面朝外的方向），顶（uv.y = 1）在远离牌面的那头
  g.rotateX(Math.PI / 2);
  return g;
}

export class TileBeam {
  readonly group = new THREE.Group();
  private tint: THREE.ShaderMaterial;
  private glow: THREE.ShaderMaterial;
  private halo: THREE.ShaderMaterial;
  private wash: THREE.ShaderMaterial;

  // w、h：牌面大小；base：牌面离牌中心多远；height：光柱多高
  constructor(w: number, h: number, base: number, height = 5.5) {
    this.tint = beamMat(BEAM_FRAG, '#a46cff', false);
    this.glow = beamMat(BEAM_FRAG, '#8a4cff', true);
    this.halo = beamMat(BEAM_FRAG, '#6a34e0', true);
    this.wash = beamMat(WASH_FRAG, '#9a5cff', false);
    const core = tube(w * 1.05, h * 1.0, height);
    const tint = new THREE.Mesh(core, this.tint);
    const glow = new THREE.Mesh(core, this.glow);
    const halo = new THREE.Mesh(tube(w * 1.7, h * 1.5, height * 0.8), this.halo);
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.wash);
    tint.position.z = glow.position.z = halo.position.z = base + 0.005;
    wash.position.z = base + 0.008;
    for (const [m, order] of [[wash, 3], [halo, 4], [tint, 5], [glow, 6]] as const) {
      m.renderOrder = order;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  // strength：0 关掉；一明一暗由调用的人给
  update(time: number, strength: number): void {
    this.tint.uniforms.uA.value = strength * 0.6;
    this.glow.uniforms.uA.value = strength * 0.7;
    this.halo.uniforms.uA.value = strength * 0.22;
    this.wash.uniforms.uA.value = strength * 0.45;
    for (const m of [this.tint, this.glow, this.halo]) m.uniforms.uTime.value = time;
    this.group.visible = strength > 0.001;
  }
}

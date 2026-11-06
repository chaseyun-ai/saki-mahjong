import * as THREE from 'three';

// 初美鸣出来的东、北中间那张上的紫色光柱，照动画原作：从牌面直直往上，和牌面差不多宽，
// 底下最亮、往上慢慢淡掉，两边柔和。牌面本身是紫色的字（table3d 的 kimonFace），光柱不往牌面上糊：
// 朝着镜头的那面筒壁，压在牌面上的下半截是透明的，紫字看得清清楚楚。
// 光柱是一根没有顶和底的扁圆筒：正对视线的地方浓、侧着的边上淡（按法线和视线的夹角），前后两层叠起来，看着像一团光而不是一张片。
// 同一根筒画两遍：一遍普通半透明把后面的东西染紫（压在白牌、黄牌背上也看得清），一遍叠加发亮（暗下来的星空里会发光）。
// 外面再套一层更宽更淡的。都是牌的子物体，牌放在哪、怎么转，光柱都跟着

const VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
varying float vFront;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  // 只看横截面上的夹角（视线去掉顺着光柱的分量），俯视时也是中间浓、两边淡
  vec3 axis = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  vec3 v = cameraPosition - world.xyz;
  v -= axis * dot(v, axis);
  float d = dot(n, normalize(v + 1e-5));
  vFacing = abs(d);
  // 筒壁的法线朝外：大于 0 是朝着镜头的那面（挡在牌面前面的）
  vFront = d;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BEAM_FRAG = /* glsl */ `
#define PI 3.14159265
uniform vec3 uColor;
uniform float uA;
uniform float uTime;
uniform float uClear;
varying vec2 vUv;
varying float vFacing;
varying float vFront;
void main() {
  // 横向：正对视线的地方浓、侧边淡；纵向：底下亮，往上淡
  float edge = pow(vFacing, 1.6);
  float v = vUv.y;
  float rise = (0.55 + 0.45 * exp(-v * 3.0)) * pow(1.0 - v, 0.9);
  // 很轻的一点往上流的明暗，不抢眼
  float shimmer = 0.88 + 0.12 * sin(v * 9.0 - uTime * 1.6 + vUv.x * 12.0);
  // 朝镜头那面筒壁的下半截压在牌面上，让它透明，紫字不被糊掉；背面和两边的筒壁照常从牌边升起来
  float front = smoothstep(0.05, 0.45, vFront);
  float clear = 1.0 - front * (1.0 - smoothstep(0.0, uClear, v));
  float a = clamp(edge * rise * shimmer * clear * uA, 0.0, 1.0);
#ifdef GLOW
  gl_FragColor = vec4(uColor * a, 1.0);
#else
  gl_FragColor = vec4(uColor, a);
#endif
}
`;

// glow：叠加发亮；不然是普通半透明（把后面的东西染紫）
// clear：朝镜头那面筒壁从底往上多高（占光柱高度的比例）是透明的，筒越高这个比例越小
const beamMat = (color: string, glow: boolean, clear: number) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 0 }, uTime: { value: 0 }, uClear: { value: clear } },
    vertexShader: VERT,
    fragmentShader: BEAM_FRAG,
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

  // w、h：牌面大小；base：牌面离牌中心多远；height：光柱多高
  constructor(w: number, h: number, base: number, height = 5.5) {
    // 斜着看时，朝镜头那面筒壁升到差不多牌面深度的一倍半高，都还压在牌面上
    const clear = Math.min(0.6, (h * 1.5) / height);
    this.tint = beamMat('#a46cff', false, clear);
    this.glow = beamMat('#8a4cff', true, clear);
    this.halo = beamMat('#6a34e0', true, clear / 0.8);
    const core = tube(w * 1.05, h * 1.0, height);
    const tint = new THREE.Mesh(core, this.tint);
    const glow = new THREE.Mesh(core, this.glow);
    const halo = new THREE.Mesh(tube(w * 1.7, h * 1.5, height * 0.8), this.halo);
    tint.position.z = glow.position.z = halo.position.z = base + 0.005;
    for (const [m, order] of [[halo, 4], [tint, 5], [glow, 6]] as const) {
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
    for (const m of [this.tint, this.glow, this.halo]) m.uniforms.uTime.value = time;
    this.group.visible = strength > 0.001;
  }
}

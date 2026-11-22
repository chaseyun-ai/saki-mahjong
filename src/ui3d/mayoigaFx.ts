import * as THREE from 'three';

// 小濑川白望的迷途之家（2.5D、3D）：应该打的那张牌脚下像落了一滴水，一圈圈清水波纹往外荡。
// 水是透明的，不画白圈：桌子先照常画好、抄成贴图，再在牌脚下铺一块圆，按水面的起伏把底下的桌布折过来画——
// 波峰把桌布的花纹、牌的影子、桌上的线推开一点，红绿蓝折得差一点点；波底下有焦散的亮纹，
// 朝着镜头的那面斜坡上闪一丝天光。水面平的地方和原来的画面一模一样，看不出有水。
// 这块圆和桌子一起比远近，挡在它前面的东西照样挡着它。
// 自己的手牌立在水里：抄下来的画面里有手牌的话，另外画一张手牌的剪影，折过去碰到剪影的地方不折
// （不然牌面上的字、颜色会被折到水里，牌脚下一片红一片白）。

export const MAYOIGA_FX = {
  rings: 3, // 同时有几圈
  period: 1.8, // 一圈从牌脚荡到最外面要几秒
  radius: 1.8, // 荡多远（牌宽）
  orthoRadius: 1.6, // 2.5D 改良布局（手牌单独画在最上面一层）荡得远几倍
  tilt: 0.011, // 水面多陡（波的斜率乘这个，约等于斜面的弧度）
  refract: 5, // 折射多强：斜面每一弧度，底下的桌面挪开多少（按荡开的半径算）
  disperse: 0.22, // 红、蓝比绿多折、少折几成（透明的玻璃、水那样边上带一点彩）
  caustic: 0.0016, // 焦散：水面往上鼓的地方底下亮、往下凹的地方暗
  glint: 1.2, // 斜面上那一丝高光多亮
  fade: 0.25, // 出现、消失各要几秒
};

const VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vPos = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform sampler2D uMask;
uniform float uMaskOn;
uniform vec2 uRes;
uniform mat4 uVP;
uniform vec3 uCenter;
uniform vec3 uEye;
uniform float uR;
uniform float uTime;
uniform float uA;
uniform float uPeriod;
uniform float uTilt;
uniform float uRefract;
uniform float uDisperse;
uniform float uCaustic;
uniform float uGlint;
varying vec3 vPos;

// 离牌脚 d（按荡开的半径算，0–1）的地方水面有多高：三圈波，每圈是一小段起伏，越往外越矮、越宽
float wave(float d) {
  float h = 0.0;
  for (int i = 0; i < ${MAYOIGA_FX.rings}; i++) {
    float k = fract(uTime / uPeriod + float(i) / ${MAYOIGA_FX.rings}.0);
    float r = 0.06 + 0.94 * k;
    float w = 0.05 + 0.06 * k;
    float x = (d - r) / w;
    float amp = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.12, k) / (0.6 + 0.8 * k);
    h += amp * exp(-x * x) * cos(x * 2.3);
  }
  return h;
}

// 桌面上的一点落在画面的哪里（0–1）
vec2 screen(vec3 p) {
  vec4 c = uVP * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}

// 折过去的那一点在画面上是手牌的话就不折，照原来这一点的颜色
vec3 under(vec2 uv, vec3 base) {
  vec3 c = texture2D(uTex, uv).rgb;
  float m = uMaskOn * texture2D(uMask, uv).r;
  return mix(c, base, smoothstep(0.05, 0.4, m));
}

void main() {
  vec2 e = (vPos.xz - uCenter.xz) / uR;
  float d = length(e);
  if (d > 1.0) discard;
  vec2 dir = d > 1e-4 ? e / d : vec2(1.0, 0.0);
  vec2 here = gl_FragCoord.xy / uRes;
  vec3 base = texture2D(uTex, here).rgb;

  float eps = 0.004;
  float h0 = wave(d);
  float hp = wave(d + eps);
  float hm = wave(max(d - eps, 0.0));
  float slope = (hp - hm) / (2.0 * eps);
  float curve = (hp - 2.0 * h0 + hm) / (eps * eps);
  // 越靠边越淡，到边上和原来的画面接上
  float edge = smoothstep(1.0, 0.78, d) * uA;
  float tilt = slope * uTilt * edge;

  // 折射：斜面把底下的桌面往波峰那边推开
  vec3 off = vec3(dir.x, 0.0, dir.y) * (-tilt * uRefract * uR * 0.1);
  vec3 col = vec3(
    under(screen(vPos + off * (1.0 + uDisperse)), base).r,
    under(screen(vPos + off), base).g,
    under(screen(vPos + off * (1.0 - uDisperse)), base).b
  );

  // 焦散：鼓起来的波像放大镜，把光聚到底下
  col *= 1.0 + clamp(-curve * uCaustic * edge, -0.12, 0.45);

  // 高光：斜面朝着镜头翘起来的地方照到天光。天光取在“平的水面反射过去的方向”再往上抬一点，平的地方照不到
  vec3 n = normalize(vec3(-tilt * dir.x, 1.0, -tilt * dir.y));
  vec3 v = normalize(uEye - vPos);
  vec3 still = reflect(-v, vec3(0.0, 1.0, 0.0));
  vec3 sky = normalize(still + vec3(0.0, 0.42, 0.0));
  float spec = pow(max(dot(reflect(-v, n), sky), 0.0), 90.0);
  float spec0 = pow(max(dot(still, sky), 0.0), 90.0);
  float glint = max(spec - spec0, 0.0) * uGlint * edge;
  col += vec3(0.92, 0.97, 1.0) * glint;

  gl_FragColor = vec4(mix(base, col, smoothstep(0.0, 0.02, edge)), 1.0);
}
`;

export class MayoigaFx {
  private tex: THREE.FramebufferTexture | null = null;
  // 手牌的剪影（半分辨率）
  private mask: THREE.WebGLRenderTarget | null = null;
  private white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private clear = new THREE.Color();
  private size = new THREE.Vector2();
  private scene = new THREE.Scene();
  private mesh: THREE.Mesh;
  private u = {
    uTex: { value: null as THREE.Texture | null },
    uMask: { value: null as THREE.Texture | null },
    uMaskOn: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uVP: { value: new THREE.Matrix4() },
    uCenter: { value: new THREE.Vector3() },
    uEye: { value: new THREE.Vector3() },
    uR: { value: 1 },
    uTime: { value: 0 },
    uA: { value: 0 },
    uPeriod: { value: MAYOIGA_FX.period },
    uTilt: { value: MAYOIGA_FX.tilt },
    uRefract: { value: MAYOIGA_FX.refract },
    uDisperse: { value: MAYOIGA_FX.disperse },
    uCaustic: { value: MAYOIGA_FX.caustic },
    uGlint: { value: MAYOIGA_FX.glint },
  };

  constructor() {
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 72), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  // 刚画好的桌子上，以 center（桌面上牌脚的位置）为圆心画一汪水。radius 荡多远（世界单位），time 秒，a 显出来多少（0–1）。
  // world 是刚才画的那个场景，hand 是画面里已经画上去的自己的手牌（没有就是空的）
  draw(r: THREE.WebGLRenderer, camera: THREE.Camera, world: THREE.Scene, hand: THREE.Object3D[], center: THREE.Vector3, radius: number, time: number, a: number): void {
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose();
      this.tex = new THREE.FramebufferTexture(w, h);
      this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    }
    r.copyFramebufferToTexture(this.tex);
    const u = this.u;
    u.uTex.value = this.tex;
    u.uMaskOn.value = hand.length ? 1 : 0;
    if (hand.length) u.uMask.value = this.drawMask(r, camera, world, hand, w, h);
    u.uRes.value.set(w, h);
    camera.updateMatrixWorld();
    u.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    camera.getWorldPosition(u.uEye.value);
    u.uCenter.value.copy(center);
    u.uR.value = radius;
    u.uTime.value = time;
    u.uA.value = a;
    this.mesh.position.copy(center);
    this.mesh.scale.setScalar(radius);
    this.mesh.updateMatrixWorld();
    const auto = r.autoClear;
    const shadows = r.shadowMap.autoUpdate;
    r.autoClear = false;
    r.shadowMap.autoUpdate = false;
    r.render(this.scene, camera);
    r.autoClear = auto;
    r.shadowMap.autoUpdate = shadows;
  }

  // 只画手牌、全白，画到一张半分辨率的图上
  private drawMask(r: THREE.WebGLRenderer, camera: THREE.Camera, world: THREE.Scene, hand: THREE.Object3D[], w: number, h: number): THREE.Texture {
    const mw = Math.max(1, Math.floor(w / 2));
    const mh = Math.max(1, Math.floor(h / 2));
    if (!this.mask || this.mask.width !== mw || this.mask.height !== mh) {
      this.mask?.dispose();
      this.mask = new THREE.WebGLRenderTarget(mw, mh, { depthBuffer: false });
    }
    const layers = new Map<THREE.Object3D, number>();
    for (const g of hand) g.traverse((o) => {
      layers.set(o, o.layers.mask);
      o.layers.set(4);
    });
    const mask = camera.layers.mask;
    const bg = world.background;
    const over = world.overrideMaterial;
    const shadows = r.shadowMap.autoUpdate;
    const alpha = r.getClearAlpha();
    r.getClearColor(this.clear);
    camera.layers.set(4);
    world.background = null;
    world.overrideMaterial = this.white;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.mask);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.render(world, camera);
    r.setRenderTarget(null);
    r.setClearColor(this.clear, alpha);
    r.shadowMap.autoUpdate = shadows;
    world.overrideMaterial = over;
    world.background = bg;
    camera.layers.mask = mask;
    for (const [o, m] of layers) o.layers.mask = m;
    return this.mask.texture;
  }

  dispose(): void {
    this.mask?.dispose();
    this.white.dispose();
    this.tex?.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

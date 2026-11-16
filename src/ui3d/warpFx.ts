import * as THREE from 'three';

// 把整幅画面扭一下再画（2.5D、3D）：先把刚画好的一帧抄成贴图，再用一个着色器扭着画回去。
// - 巨引力源（lens）：引力圆里的空间是弯的。圆边上一圈像透镜一样把后面的桌子折进去、带着色散，
//   圆里的东西被拖着绕圆心拧过一点，一圈圈波纹往圆心收；刚放出来那一下整个圆往中间猛地一缩再弹回来。
//   圆的位置、大小和以前那张黑色的圆一样（和四边牌山的外沿相切），罩住哪几墩照样看得出来
// - 平行宇宙（shift）：画面先裂成错开的几重影子、横着撕开，一道白光以后换到左右颠倒、泛着紫的“另一边”，
//   晃一会儿再合回来
// 只在这两个技能开着的时候才多画这一遍

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const LENS_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform mat4 uInv;
uniform mat4 uVP;
uniform vec3 uCenter;
uniform vec2 uRad;
uniform float uTime;
uniform float uA;
uniform float uKick;
varying vec2 vUv;
// 桌面上（按圆的半径量）离圆心 r、方向 dir 的地方，往里外挪 dr、绕圆心转 da 以后，落在画面的哪里
vec2 at(vec2 dir, float r, float dr, float da) {
  float c = cos(da), s = sin(da);
  vec2 e = vec2(dir.x * c - dir.y * s, dir.x * s + dir.y * c) * max(r + dr, 0.0);
  vec4 p = uVP * vec4(uCenter.x + e.x * uRad.x, uCenter.y, uCenter.z + e.y * uRad.y, 1.0);
  return p.xy / p.w * 0.5 + 0.5;
}
void main() {
  vec4 base = texture2D(uTex, vUv);
  gl_FragColor = base;
  // 这个像素看过去落在桌面的哪一点
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 a = uInv * vec4(ndc, -1.0, 1.0);
  vec4 b = uInv * vec4(ndc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w;
  vec3 rd = b.xyz / b.w - ro;
  if (rd.y > -1e-5) return;
  vec3 hit = ro + rd * ((uCenter.y - ro.y) / rd.y);
  vec2 e = (hit.xz - uCenter.xz) / uRad;
  float r = length(e);
  if (r > 1.4) return;
  vec2 dir = r > 1e-4 ? e / r : vec2(1.0, 0.0);
  float ang = atan(e.y, e.x);
  // 圆边那一圈透镜、圆里靠外的一带（牌山、牌河外沿）；正中间的点棒台和牌河基本不动，看得清
  float rim = exp(-pow((r - 0.965) / 0.06, 2.0));
  float mid = smoothstep(0.28, 0.9, r) * smoothstep(1.08, 0.98, r);
  float inside = smoothstep(1.02, 0.97, r);
  float breathe = 0.75 + 0.25 * sin(uTime * 1.3);
  float dr = -0.06 * rim * breathe + sin(r * 30.0 + uTime * 3.2) * 0.012 * mid + sin(ang * 5.0 - uTime * 1.7 + r * 9.0) * 0.007 * mid;
  float da = (0.085 + 0.035 * sin(uTime * 0.8)) * rim + (0.035 + 0.025 * sin(uTime * 0.9 + 1.0)) * mid;
  // 刚放出来：整个圆往中间一缩、狠狠拧一把，再弹回来
  float k = uKick * smoothstep(1.35, 0.9, r);
  dr += -0.5 * k * r * (1.0 - 0.45 * r) * (0.6 + 0.4 * cos(uKick * 9.0));
  da += 1.5 * k * (1.0 - 0.55 * r);
  dr *= uA;
  da *= uA;
  // 色散：红绿蓝折得不一样多
  float ca = (0.5 * rim + 0.5 * k) * uA;
  vec3 col = vec3(texture2D(uTex, at(dir, r, dr, da)).r, texture2D(uTex, at(dir, r, dr * (1.0 + 0.18 * ca), da * (1.0 + 0.05 * ca))).g, texture2D(uTex, at(dir, r, dr * (1.0 + 0.4 * ca), da * (1.0 + 0.1 * ca))).b);
  // 圆里暗一点、泛紫，越靠边越暗；几道往圆心卷的暗纹慢慢转
  float arms = 0.5 + 0.5 * sin(ang * 3.0 + r * 11.0 - uTime * 0.9);
  float shade = inside * (0.2 + 0.34 * smoothstep(0.4, 0.98, r) + 0.14 * arms * smoothstep(0.2, 0.7, r)) * uA;
  col = mix(col, col * vec3(0.42, 0.34, 0.74), shade);
  // 边上一圈光：细的一道亮线带着几段转着的高光，里外各一层晕
  float turn = 0.55 + 0.45 * sin(ang * 3.0 - uTime * 1.1) * sin(ang * 2.0 + uTime * 0.6 + 1.0);
  float line = exp(-pow((r - 1.0) / 0.012, 2.0));
  float glow = exp(-pow((r - 0.985) / 0.05, 2.0));
  col += (vec3(0.62, 0.45, 1.0) * line * (0.5 + 0.9 * turn) + vec3(0.3, 0.18, 0.75) * glow * 0.35 + vec3(0.9, 0.85, 1.0) * line * turn * turn * 0.5) * uA;
  col += vec3(0.55, 0.4, 1.0) * uKick * uA * smoothstep(1.1, 0.0, r) * 0.35;
  gl_FragColor = vec4(col, base.a);
}
`;

const SHIFT_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uK;
uniform float uTime;
varying vec2 vUv;
float h1(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
vec3 rgb(vec2 uv, float split) {
  return vec3(texture2D(uTex, uv + vec2(split, 0.0)).r, texture2D(uTex, uv).g, texture2D(uTex, uv - vec2(split, 0.0)).b);
}
void main() {
  // 进度 0–1：裂开 → 白光（0.46）→ 另一边 → 合回来
  float build = smoothstep(0.0, 0.42, uK);
  float settle = 1.0 - smoothstep(0.8, 1.0, uK);
  float amt = min(build, settle);
  float peak = exp(-pow((uK - 0.46) / 0.06, 2.0));
  float back = exp(-pow((uK - 0.84) / 0.05, 2.0));
  float other = smoothstep(0.43, 0.49, uK) * (1.0 - smoothstep(0.8, 0.88, uK));
  vec2 uv = vUv;
  // 整幅画面像隔着水一样晃
  uv.x += sin(uv.y * 9.0 + uTime * 5.0) * 0.012 * amt;
  uv.y += sin(uv.x * 7.0 - uTime * 4.0) * 0.008 * amt;
  // 横着撕开的几条
  float row = floor(uv.y * 26.0);
  float tick = floor(uTime * 14.0);
  uv.x += (h1(row * 3.1 + tick * 7.7) - 0.5) * step(0.7, h1(row + tick * 1.3)) * 0.16 * amt * amt;
  // 白光那一下往里一吸
  uv = (uv - 0.5) * (1.0 - 0.07 * peak - 0.04 * back - 0.015 * amt) + 0.5;
  float split = 0.03 * amt + 0.05 * peak + 0.03 * back;
  vec3 here = rgb(uv, split);
  // 另一边：左右颠倒，颜色往冷的紫蓝偏
  vec3 there = rgb(vec2(1.0 - uv.x, uv.y), -split);
  float l = dot(there, vec3(0.3, 0.55, 0.15));
  there = mix(there, vec3(l) * vec3(0.72, 0.68, 1.3) + vec3(0.03, 0.0, 0.08), 0.6);
  // 换过去之前，另一边先像重影一样透出来，越来越实
  float ghost = 0.42 * amt * (0.6 + 0.4 * sin(uTime * 23.0)) * (1.0 - other);
  vec3 col = mix(here, there, max(other, ghost));
  // 另一边的画面上滚着细细的横纹
  col *= 1.0 - 0.1 * other * (0.5 + 0.5 * sin(vUv.y * 420.0 + uTime * 30.0));
  col += vec3(0.86, 0.9, 1.0) * (peak * 0.95 + back * 0.6);
  float v = length(vUv - 0.5);
  col = mix(col, col * vec3(0.5, 0.4, 0.85), amt * smoothstep(0.25, 0.75, v) * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class SpaceWarp {
  private tex: THREE.FramebufferTexture | null = null;
  private size = new THREE.Vector2();
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private lensU = {
    uTex: { value: null as THREE.Texture | null },
    uInv: { value: new THREE.Matrix4() },
    uVP: { value: new THREE.Matrix4() },
    uCenter: { value: new THREE.Vector3() },
    uRad: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uA: { value: 0 },
    uKick: { value: 0 },
  };
  private shiftU = { uTex: { value: null as THREE.Texture | null }, uK: { value: 0 }, uTime: { value: 0 } };
  private lensMat: THREE.ShaderMaterial;
  private shiftMat: THREE.ShaderMaterial;

  constructor() {
    const mat = (uniforms: Record<string, THREE.IUniform>, frag: string) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false });
    this.lensMat = mat(this.lensU, LENS_FRAG);
    this.shiftMat = mat(this.shiftU, SHIFT_FRAG);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lensMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  // 把画好的这一帧抄下来
  private grab(r: THREE.WebGLRenderer): THREE.Texture {
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose();
      this.tex = new THREE.FramebufferTexture(w, h);
      this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    }
    r.copyFramebufferToTexture(this.tex);
    return this.tex;
  }

  private blit(r: THREE.WebGLRenderer, mat: THREE.ShaderMaterial): void {
    this.quad.material = mat;
    const auto = r.autoClear;
    const shadows = r.shadowMap.autoUpdate;
    r.autoClear = false;
    r.shadowMap.autoUpdate = false;
    r.render(this.scene, this.cam);
    r.autoClear = auto;
    r.shadowMap.autoUpdate = shadows;
  }

  // 引力圆：圆心 center（y 是折算用的高度，取牌的半高）、横竖半径 rx、rz；a 开了多少（0–1），kick 刚放出来的那一下（1 落到 0）
  lens(r: THREE.WebGLRenderer, camera: THREE.Camera, center: THREE.Vector3, rx: number, rz: number, time: number, a: number, kick: number): void {
    const u = this.lensU;
    u.uTex.value = this.grab(r);
    u.uVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    u.uInv.value.copy(u.uVP.value).invert();
    u.uCenter.value.copy(center);
    u.uRad.value.set(rx, rz);
    u.uTime.value = time;
    u.uA.value = a;
    u.uKick.value = kick;
    this.blit(r, this.lensMat);
  }

  // 平行宇宙：k 是进度（0–1）
  shift(r: THREE.WebGLRenderer, k: number, time: number): void {
    const u = this.shiftU;
    u.uTex.value = this.grab(r);
    u.uK.value = k;
    u.uTime.value = time;
    this.blit(r, this.shiftMat);
  }

  dispose(): void {
    this.tex?.dispose();
    this.quad.geometry.dispose();
    this.lensMat.dispose();
    this.shiftMat.dispose();
  }
}

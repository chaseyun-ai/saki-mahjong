import * as THREE from 'three';

// 鹤田姬子拿到钥匙的那一局（3D、2.5D）：
// 1. 配牌：她的每一张牌不从牌山飞过来，而是一道橙色光柱从天上直直砸下来，砸到哪里哪里就多出一张牌；
//    开头先有几道又宽又斜的大光柱交叉着落下来（原作里那个“W”的样子）。
// 2. 理完牌：一团火从她的右手边沿着手牌一路烧到左手边，火舌往上卷、火星往上飘，一盏橙色的点光跟着火头走，
//    把牌和桌面映成橙色。
// 光柱和火都是一张四边形实例化很多份，形状、位置、亮暗全在着色器里按时间算（一次画完，不用每帧改顶点）。
// 手法参考 Humpalumps/ultra-elements（MIT）：光柱是“白芯 + 橙色光晕”沿轴向朝镜头展开的光带，
// 火是按出生时刻解析地算轨迹的粒子（温度从白热冷成暗红），见 THIRD_PARTY_NOTICES.md

export const HIMEKO_FX = {
  drop: 0.2, // 光柱从天上落到牌上要多久（秒）
  fade: 0.55, // 落地以后光柱收细、淡掉要多久
  sky: 40, // 光柱从多高落下来
  sweep: 1.05, // 火头从右烧到左要多久
  burn: 1.1, // 火头过去以后火还烧多久
};

const BEAM_MAX = 24;
const FIRE_COUNT = 900;
const ORANGE = new THREE.Color('#ff7a18');

const BEAM_VERT = /* glsl */ `
attribute vec3 aBase;
attribute vec3 aAxis;
attribute vec4 aShape; // 长度、宽度、落地时刻、种类（0 光柱，1 落地的闪光）
uniform float uTime;
uniform float uDrop;
uniform float uFade;
varying vec2 vQ;
varying float vAlpha;
varying float vKind;
varying float vHead;
void main() {
  float len = aShape.x, width = aShape.y, at = aShape.z;
  vKind = aShape.w;
  vQ = position.xy * 2.0;
  float age = uTime - at;
  vec3 p;
  if (aShape.w < 0.5) {
    // 光柱：头从天上加速落下，落地以后亮一下、收细、淡掉
    float s = clamp((uTime - (at - uDrop)) / uDrop, 0.0, 1.0);
    float head = len * (1.0 - s * s);
    float f = clamp(age / uFade, 0.0, 1.0);
    float hit = age > 0.0 ? exp(-age * 9.0) : 0.0;
    vAlpha = (s <= 0.0 || f >= 1.0) ? 0.0 : (1.0 - f) * (1.0 - f) * (0.75 + 0.6 * hit);
    vHead = age < 0.0 ? 1.0 : exp(-age * 6.0);
    float w = width * (1.0 + 0.7 * hit) * (1.0 - 0.6 * f);
    float t = position.y + 0.5;
    p = aBase + aAxis * mix(head, len, t);
    vec3 view = normalize(cameraPosition - p);
    vec3 side = normalize(cross(aAxis, view));
    p += side * position.x * w;
  } else {
    // 落地的闪光：一团朝着镜头的光，一下撑开再暗下去
    vAlpha = (age < 0.0 || age > 0.6) ? 0.0 : exp(-age * 6.5);
    vHead = 0.0;
    float sz = width * (1.6 + age * 7.0);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p = aBase + (right * position.x + up * position.y) * sz;
  }
  if (vAlpha <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vQ;
varying float vAlpha;
varying float vKind;
varying float vHead;
void main() {
  vec3 hot = vec3(1.0, 0.84, 0.52);
  if (vKind < 0.5) {
    float x = vQ.x;
    float along = vQ.y * 0.5 + 0.5; // 0 是光柱的下端（头），1 是天上
    float core = exp(-x * x * 18.0);
    float glow = exp(-x * x * 2.2);
    // 往天上渐渐淡掉；落下来时头最亮
    float sky = 1.0 - smoothstep(0.35, 1.0, along);
    float head = exp(-along * 14.0) * vHead;
    float a = (glow * 0.85 + core * 0.55) * (0.4 + 0.6 * sky) + head * glow * 1.3;
    vec3 c = uColor * glow * 1.2 + hot * (core * 0.7 + head * 0.6);
    gl_FragColor = vec4(c * a * vAlpha, 1.0);
  } else {
    float r2 = dot(vQ, vQ);
    float a = exp(-r2 * 5.0) + 0.35 * exp(-pow(sqrt(r2) - 0.62, 2.0) * 90.0);
    vec3 c = mix(uColor, hot, exp(-r2 * 14.0));
    gl_FragColor = vec4(c * a * vAlpha, 1.0);
  }
}
`;

const FIRE_VERT = /* glsl */ `
attribute vec4 aSeed;  // 随机数
attribute vec2 aPart;  // 沿手牌的位置（0 右手边，1 左手边）、种类（0 火舌，1 火星）
uniform float uTime;   // 火从右边点着以后过了多久
uniform float uSweep;
uniform vec3 uFrom;    // 右手边那张牌的外沿（贴着牌底）
uniform vec3 uTo;      // 左手边
uniform vec3 uSide;    // 桌面上和这一排垂直的方向
uniform float uScale;  // 这一排牌放大了多少
varying vec2 vQ;
varying float vHeat;
varying float vAlpha;
varying float vSpark;
void main() {
  vQ = position.xy * 2.0;
  float u = aPart.x;
  float spark = aPart.y;
  vSpark = spark;
  float birth = u * uSweep + aSeed.x * 0.22 - 0.04;
  float life = spark > 0.5 ? 0.9 + aSeed.y * 0.8 : 0.55 + aSeed.y * 0.75;
  float age = uTime - birth;
  float k = age / life;
  if (k <= 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
  vec3 dir = normalize(uTo - uFrom);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = mix(uFrom, uTo, u) + uSide * ((aSeed.z - 0.35) * 1.1 * uScale);
  float s;
  if (spark > 0.5) {
    // 火星：飞得高、往前（往左）飘，越飞越小
    p += up * uScale * (0.4 + (2.5 + aSeed.w * 3.0) * k - 1.2 * k * k);
    p += dir * uScale * k * (0.6 + aSeed.z);
    p += right * sin(age * 7.0 + aSeed.x * 40.0) * 0.15 * uScale * k;
    s = uScale * 0.1 * (1.0 - k);
    vHeat = 1.0 - k * 0.6;
    vAlpha = smoothstep(0.0, 0.05, k) * (1.0 - k);
  } else {
    // 火舌：从牌底窜起来，往上卷、被火头带着往左倒，越往上越冷、越淡
    p += up * uScale * (0.2 + (2.0 + aSeed.w * 2.8) * pow(k, 0.8));
    p += dir * uScale * k * (0.35 + 0.5 * aSeed.z);
    p += right * sin(age * 11.0 + aSeed.x * 30.0) * 0.12 * uScale * k;
    s = uScale * (0.7 + aSeed.w * 0.8) * (1.0 - 0.45 * k) * smoothstep(0.0, 0.1, k);
    vHeat = (1.0 - k) * (0.55 + 0.35 * aSeed.y);
    vAlpha = (1.0 - k) * 0.42;
  }
  // 火舌是竖长的一团（在画面上竖着拉长）
  p += right * position.x * s + camUp * position.y * s * (spark > 0.5 ? 1.0 : 1.6);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FIRE_FRAG = /* glsl */ `
varying vec2 vQ;
varying float vHeat;
varying float vAlpha;
varying float vSpark;
void main() {
  vec2 q = vQ;
  float a;
  if (vSpark > 0.5) a = exp(-dot(q, q) * 4.0);
  else {
    // 下面圆、上面尖的火舌
    q.x *= 1.0 + max(q.y, 0.0) * 1.2;
    a = smoothstep(1.0, 0.1, length(q));
  }
  float h = vHeat;
  vec3 c = mix(vec3(0.5, 0.05, 0.0), vec3(1.0, 0.36, 0.03), smoothstep(0.05, 0.4, h));
  c = mix(c, vec3(1.0, 0.72, 0.22), smoothstep(0.4, 0.72, h));
  c = mix(c, vec3(1.0, 0.96, 0.82), smoothstep(0.78, 1.0, h) * a);
  gl_FragColor = vec4(c * a * vAlpha, 1.0);
}
`;

export interface DescentTile {
  pos: THREE.Vector3; // 牌的中心
  at: number; // 光柱砸到这张牌的时刻（和 update 用同一个时钟）
}

export class HimekoFx {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight(ORANGE, 0, 9, 1.6);
  private beams: THREE.Mesh;
  private beamGeo: THREE.InstancedBufferGeometry;
  private beamMat: THREE.ShaderMaterial;
  private fire: THREE.Mesh;
  private fireMat: THREE.ShaderMaterial;
  private fireAt = -1;
  private beamEnd = -1;
  private scale = 1;

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    // 光柱
    this.beamGeo = new THREE.InstancedBufferGeometry();
    this.beamGeo.index = quad.index;
    this.beamGeo.setAttribute('position', quad.getAttribute('position'));
    this.beamGeo.setAttribute('aBase', new THREE.InstancedBufferAttribute(new Float32Array(BEAM_MAX * 3), 3));
    this.beamGeo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(new Float32Array(BEAM_MAX * 3), 3));
    this.beamGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(new Float32Array(BEAM_MAX * 4), 4));
    this.beamGeo.instanceCount = 0;
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uTime: { value: 0 }, uDrop: { value: HIMEKO_FX.drop }, uFade: { value: HIMEKO_FX.fade }, uColor: { value: ORANGE.clone() } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.beams = new THREE.Mesh(this.beamGeo, this.beamMat);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 20;
    this.beams.visible = false;

    // 火：每一份实例是一个粒子
    const fireGeo = new THREE.InstancedBufferGeometry();
    fireGeo.index = quad.index;
    fireGeo.setAttribute('position', quad.getAttribute('position'));
    const seed = new Float32Array(FIRE_COUNT * 4);
    const part = new Float32Array(FIRE_COUNT * 2);
    // 固定的伪随机数：每一次烧起来样子都一样（截图、测试好对照）
    let r = 0x2f6b9d13;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < FIRE_COUNT; i++) {
      for (let j = 0; j < 4; j++) seed[i * 4 + j] = rnd();
      part[i * 2] = rnd() * 1.06 - 0.03;
      part[i * 2 + 1] = i % 5 === 0 ? 1 : 0;
    }
    fireGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    fireGeo.setAttribute('aPart', new THREE.InstancedBufferAttribute(part, 2));
    fireGeo.instanceCount = FIRE_COUNT;
    this.fireMat = new THREE.ShaderMaterial({
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSweep: { value: HIMEKO_FX.sweep },
        uFrom: { value: new THREE.Vector3() },
        uTo: { value: new THREE.Vector3() },
        uSide: { value: new THREE.Vector3() },
        uScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.fire = new THREE.Mesh(fireGeo, this.fireMat);
    this.fire.frustumCulled = false;
    this.fire.renderOrder = 21;
    this.fire.visible = false;
    // 点光一直在场景里（平时亮度 0），不会中途让材质重新编译
    this.group.add(this.beams, this.fire, this.light);
  }

  // 配牌的光柱。up 是天上的方向（世界的上方），side 是桌面上顺着这一排牌的方向（大光柱往两边斜）
  descend(tiles: DescentTile[], side: THREE.Vector3, scale: number): void {
    if (!tiles.length) return;
    const base = this.beamGeo.getAttribute('aBase') as THREE.InstancedBufferAttribute;
    const axis = this.beamGeo.getAttribute('aAxis') as THREE.InstancedBufferAttribute;
    const shape = this.beamGeo.getAttribute('aShape') as THREE.InstancedBufferAttribute;
    const first = Math.min(...tiles.map((t) => t.at));
    const mid = tiles.reduce((v, t) => v.add(t.pos), new THREE.Vector3()).multiplyScalar(1 / tiles.length);
    const span = Math.max(...tiles.map((t) => t.pos.clone().sub(mid).dot(side)));
    let n = 0;
    const put = (p: THREE.Vector3, ax: THREE.Vector3, len: number, width: number, at: number, kind: number) => {
      if (n >= BEAM_MAX) return;
      base.setXYZ(n, p.x, p.y, p.z);
      axis.setXYZ(n, ax.x, ax.y, ax.z);
      shape.setXYZW(n, len, width, at, kind);
      n++;
    };
    const up = new THREE.Vector3(0, 1, 0);
    // 先落下来的几道大光柱：又宽又斜，两两交叉
    const big = [-0.75, -0.25, 0.25, 0.75];
    big.forEach((f, i) => {
      const p = mid.clone().addScaledVector(side, f * span);
      const ax = up.clone().addScaledVector(side, (i % 2 ? 0.42 : -0.42)).normalize();
      put(p, ax, HIMEKO_FX.sky, 2.6 * scale, first - 0.05 + i * 0.07, 0);
    });
    for (const t of tiles) {
      const foot = t.pos.clone();
      put(foot, up, HIMEKO_FX.sky, 1.15 * scale, t.at, 0);
    }
    // 闪光只放几下（每张都闪太花）：头一张、正中、最后一张
    const sorted = [...tiles].sort((a, b) => a.at - b.at);
    for (const t of [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]]) put(t.pos, up, 0, 0.9 * scale, t.at, 1);
    base.needsUpdate = axis.needsUpdate = shape.needsUpdate = true;
    this.beamGeo.instanceCount = n;
    this.beamEnd = Math.max(...tiles.map((t) => t.at)) + HIMEKO_FX.fade + 0.1;
    this.beams.visible = true;
  }

  // 火从 from（她的右手边）烧到 to（左手边）。from、to 贴着牌底，side 是桌面上和这一排垂直的方向
  burn(from: THREE.Vector3, to: THREE.Vector3, side: THREE.Vector3, scale: number, at: number): void {
    const u = this.fireMat.uniforms;
    (u.uFrom.value as THREE.Vector3).copy(from);
    (u.uTo.value as THREE.Vector3).copy(to);
    (u.uSide.value as THREE.Vector3).copy(side).normalize();
    u.uScale.value = scale;
    this.scale = scale;
    this.fireAt = at;
    this.fire.visible = true;
  }

  // 什么时候放完（busyMs 用）
  get endsAt(): number {
    return Math.max(this.beamEnd, this.fireAt >= 0 ? this.fireAt + HIMEKO_FX.sweep + HIMEKO_FX.burn : -1);
  }

  stop(): void {
    this.beams.visible = this.fire.visible = false;
    this.beamGeo.instanceCount = 0;
    this.fireAt = this.beamEnd = -1;
    this.light.intensity = 0;
  }

  update(now: number): void {
    this.beamMat.uniforms.uTime.value = now;
    if (this.beams.visible && now > this.beamEnd) {
      this.beams.visible = false;
      this.beamGeo.instanceCount = 0;
    }
    if (!this.fire.visible) return;
    const t = now - this.fireAt;
    this.fireMat.uniforms.uTime.value = t;
    // 点光跟着火头走：点着时亮起来，烧到头以后慢慢暗下去
    const u = this.fireMat.uniforms;
    const k = THREE.MathUtils.clamp(t / HIMEKO_FX.sweep, 0, 1);
    this.light.position.lerpVectors(u.uFrom.value, u.uTo.value, k).y += 0.9 * this.scale;
    const env = t < 0 ? 0 : Math.min(1, t / 0.15) * (t < HIMEKO_FX.sweep ? 1 : Math.max(0, 1 - (t - HIMEKO_FX.sweep) / HIMEKO_FX.burn));
    this.light.intensity = 26 * env * (0.85 + 0.15 * Math.sin(t * 37));
    this.light.distance = 9 * this.scale;
    if (t > HIMEKO_FX.sweep + HIMEKO_FX.burn) {
      this.fire.visible = false;
      this.fireAt = -1;
      this.light.intensity = 0;
    }
  }
}

import * as THREE from 'three';

// 薄墨初美的里鬼门：牌桌中间画出来的鬼门法阵（东北都鸣出来以后出现）。
// 一张贴着桌布的平面，图案全在着色器里用距离场画：外圈两道圆、一圈后天八卦（艮卦在鬼门的方向，最亮）、
// 刻度圈、一笔画成的五芒星、里面两圈。小四喜的进度越高描得越多，像一支笔照顺序描过去：
// 外圈顺时针扫一圈 → 八卦一个个亮起 → 刻度圈反着扫 → 里圈 → 五芒星一笔一笔连起来。听牌时整个阵一明一暗。
// 线条是“中间发白的灯丝 + 外面一层紫色 + 柔和的光晕”（光晕的红比蓝散得开，边上偏粉），沿着圆有亮点在流动，
// 外圈甩出火星。和牌时 burst()：阵一下子爆亮、地上推开一圈冲击波，然后连风一起散掉。
// 画法参考了 Humpalumps/ultra-elements（MIT）的 Sigils.js / Shockwaves.js：距离场线条、
// 太细的线用变暗代替变细（不会断成虚线）、冲击波半径照 t^0.4 的爆炸波曲线。见 THIRD_PARTY_NOTICES.md

const PLANE = 1.15; // 平面半边长是外圈半径的几倍（给光晕留地方）
const SPARKS = 64;

const VERT = /* glsl */ `
varying vec2 vQ;
uniform float uPlane;
void main() {
  vQ = (uv * 2.0 - 1.0) * uPlane;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
#define PI 3.14159265
#define TAU 6.2831853
varying vec2 vQ;
uniform float uTime;
uniform float uReveal; // 0–1 描到哪里
uniform float uAmount; // 整体浓淡
uniform float uFlare;  // 和牌爆亮 0–1
uniform float uPulse;  // 听牌一明一暗的幅度
uniform float uSpin;   // 八卦圈转到的角度
uniform float uGen;    // 艮卦（鬼门）在第几格

// 后天八卦，从正上方顺时针：坎 艮 震 巽 离 坤 兑 乾。每个数的第 i 位是从里往外第 i 爻（1 是阳爻）
const int BITS[8] = int[8](2, 4, 1, 6, 5, 0, 3, 7);

float sat(float x) { return clamp(x, 0.0, 1.0); }
// 从正上方顺时针量的角度（从上往下看），0–TAU
float cwAngle(vec2 q) { float a = atan(q.x, q.y); return a < 0.0 ? a + TAU : a; }
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
vec2 polar(float a, float r) { return vec2(sin(a), cos(a)) * r; }

// 线条累加：E 是到线边缘的距离（负的在线里），C 是到灯丝的距离，B 是这条线额外亮多少
float E = 1e3, C = 1e3, B = 0.0, K = 0.0, SPK = 0.0;
void stroke(float d, float w, float boost) {
  float e = d - w;
  if (e < E) { E = e; B = boost; }
  C = min(C, d - w * 0.3);
}
// 一道圆，从 start 顺时针（dir=1）或逆时针（dir=-1）扫过 prog 圈
void ring(vec2 q, float r, float w, float prog, float start, float dir, float boost) {
  if (prog <= 0.0) return;
  float a = mod(dir * (cwAngle(q) - start), TAU);
  float d = abs(length(q) - r);
  if (a <= prog * TAU) stroke(d, w, boost);
  else {
    // 两端是圆头
    vec2 p0 = polar(start, r), p1 = polar(start + dir * prog * TAU, r);
    stroke(min(length(q - p0), length(q - p1)), w, boost);
  }
  if (prog < 1.0) SPK += exp(-length(q - polar(start + dir * prog * TAU, r)) / 0.018);
}

// 各段什么时候描（和 sigilParts 一样）
void main() {
  vec2 q = vQ;
  float r = length(q);
  float px = max(length(fwidth(q)) * 0.75, 1e-4);
  float ang = cwAngle(q);
  float rev = uReveal;

  // 外圈：两道，顺时针扫
  float p1 = sat(rev / 0.18);
  ring(q, 1.0, 0.009, p1, 0.0, 1.0, 0.0);
  ring(q, 0.965, 0.0035, sat((rev - 0.03) / 0.18), 0.0, 1.0, 0.0);

  // 八卦：笔扫过那一格时亮起来（刚亮的那一下特别亮）
  {
    float cell = TAU / 8.0;
    float rel = mod(ang - uSpin, TAU);
    int k = int(floor(rel / cell + 0.5)) % 8;
    float on = 0.16 + float(k) * 0.03;
    if (rev > on) {
      float a = uSpin + float(k) * cell;
      vec2 u = vec2(sin(a), cos(a));
      vec2 t = vec2(cos(a), -sin(a));
      vec2 l = vec2(dot(q, t), dot(q, u) - 0.885);
      int bits = BITS[k];
      float d = 1e3;
      for (int i = 0; i < 3; i++) {
        float y = (float(i) - 1.0) * 0.036;
        if (((bits >> i) & 1) == 1) d = min(d, seg(l, vec2(-0.07, y), vec2(0.07, y)));
        else d = min(d, min(seg(l, vec2(-0.07, y), vec2(-0.016, y)), seg(l, vec2(0.016, y), vec2(0.07, y))));
      }
      float gen = abs(float(k) - uGen) < 0.5 ? 1.0 : 0.0;
      float flash = 2.5 * exp(-(rev - on) * 30.0);
      stroke(d, 0.0075, flash + gen * (0.8 + 0.5 * sin(uTime * 3.0)));
    }
  }

  // 刻度圈：逆时针扫，48 道刻度，每 4 道一长
  {
    float p = sat((rev - 0.36) / 0.16);
    ring(q, 0.815, 0.003, p, PI, -1.0, 0.0);
    if (p > 0.0) {
      float a = mod(-(ang - PI), TAU);
      if (a <= p * TAU) {
        float n = ang * 48.0 / TAU;
        float f = fract(n + 0.5) - 0.5;
        float len = mod(floor(n + 0.5), 4.0) < 0.5 ? 0.035 : 0.018;
        float dt = abs(f) * TAU / 48.0 * r;
        float dr = max(abs(r - (0.815 - len * 0.5)) - len * 0.5, 0.0);
        stroke(length(vec2(dt, dr)), 0.0022, 0.0);
      }
    }
  }

  // 里面两圈：一道实线，一道慢慢倒转的虚线
  {
    float p = sat((rev - 0.5) / 0.16);
    ring(q, 0.42, 0.006, p, PI * 0.25, 1.0, 0.0);
    if (p > 0.0) {
      float a = ang + uTime * 0.25;
      float dash = abs(fract(a * 24.0 / TAU) - 0.5);
      // 到最近那一段虚线的距离（空当里量到虚线的端头，光晕才不会被切成一条条）
      float gap = max(0.18 - dash, 0.0) * TAU / 24.0 * r;
      if (mod(ang - PI * 1.25, TAU) <= p * TAU) stroke(length(vec2(gap, r - 0.55)), 0.0028, 0.0);
    }
  }

  // 五芒星：一笔画，0→2→4→1→3→0，顶点在 0.79 的圆上
  {
    float p = sat((rev - 0.64) / 0.34) * 5.0;
    if (p > 0.0) {
      for (int j = 0; j < 5; j++) {
        float fj = float(j);
        if (p <= fj) break;
        vec2 a = polar(fj * 2.0 * TAU / 5.0, 0.79);
        vec2 b = polar((fj + 1.0) * 2.0 * TAU / 5.0, 0.79);
        float f = min(1.0, p - fj);
        vec2 e = mix(a, b, f);
        stroke(seg(q, a, e), 0.0065, 0.0);
        if (f < 1.0) SPK += exp(-length(q - e) / 0.02) * 1.4;
      }
    }
  }

  // 沿外圈、里圈流动的亮点
  if (p1 > 0.0) {
    float ko = exp(-abs(r - 1.0) / 0.012) * pow(max(0.0, sin(ang * 5.0 - uTime * 1.7)), 40.0);
    float ki = exp(-abs(r - 0.42) / 0.01) * pow(max(0.0, sin(ang * 3.0 + uTime * 2.3)), 40.0) * sat((rev - 0.5) / 0.16);
    K = (ko + ki) * 1.6;
  }

  // 线比一个像素还细时，覆盖率自然变小：变暗而不是断成虚线
  float sheath = 1.0 - smoothstep(-px, px, E);
  float core = 1.0 - smoothstep(-px, px, C);
  float x = max(E, 0.0);
  vec3 halo = vec3(exp(-x / 0.034) * 0.85, exp(-x / 0.014) * 0.3, exp(-x / 0.024));
  vec3 white = vec3(1.0, 0.94, 1.0);
  vec3 purple = vec3(0.74, 0.32, 1.0);
  float lift = 1.0 + B;
  vec3 col = (white * core * 1.1 + purple * sheath * 0.95) * lift + halo * 0.5 * (0.7 + 0.3 * lift);
  col += vec3(1.0, 0.82, 1.0) * K;
  col += vec3(1.0, 0.9, 1.0) * min(SPK, 2.5);
  // 阵里铺一层很淡的紫
  col += purple * 0.05 * smoothstep(1.03, 0.97, r) * p1;
  float pulse = 1.0 + uPulse * (0.22 + 0.22 * sin(uTime * 3.2));
  col *= uAmount * pulse * (1.0 + uFlare * 2.2);
  col = mix(col, vec3(dot(col, vec3(0.33))), uFlare * 0.35);
  // 平面边上压一下，不露方角
  col *= smoothstep(${PLANE.toFixed(2)}, ${(PLANE - 0.08).toFixed(2)}, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

// 冲击波：贴着桌面的一圈，前沿锐利、后面拖着软尾；半径照爆炸波 r ∝ t^0.4 长，亮度 (1-x)^3 掉
const SHOCK_FRAG = /* glsl */ `
varying vec2 vQ;
uniform float uX;
void main() {
  float r = length(vQ);
  float x = uX;
  float rr = mix(0.15, 2.4, pow(x, 0.4));
  float d = r - rr;
  float prof = d > 0.0 ? exp(-d / 0.012) : exp(d / 0.16);
  float e = pow(1.0 - x, 3.0);
  vec3 col = mix(vec3(0.7, 0.3, 1.0), vec3(1.0, 0.92, 1.0), exp(-abs(d) / 0.015)) * prof * e * 1.6;
  col *= smoothstep(2.6, 2.45, r);
  gl_FragColor = vec4(col, 1.0);
}
`;

function sparkTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Spark {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  age: number;
}

// 级别 0–1（照小四喜进度）换成描到哪里：刚鸣出东北（0.2）外圈画满、亮起第一个卦；听牌（1）整个阵画完
export function sigilReveal(level: number): number {
  if (level <= 0) return 0;
  return Math.min(1, 0.22 + (0.78 * Math.max(0, level - 0.2)) / 0.8);
}

// 描到 reveal 时每一段描了多少（0–1）。着色器里写的是同一套数（改的时候两边一起改），2D 的法阵照这个画
export function sigilParts(rev: number): { outer: number; outer2: number; trig: boolean[]; ticks: number; inner: number; star: number } {
  const sat = (x: number) => Math.max(0, Math.min(1, x));
  return {
    outer: sat(rev / 0.18),
    outer2: sat((rev - 0.03) / 0.18),
    trig: Array.from({ length: 8 }, (_, k) => rev > 0.16 + k * 0.03),
    ticks: sat((rev - 0.36) / 0.16),
    inner: sat((rev - 0.5) / 0.16),
    star: sat((rev - 0.64) / 0.34),
  };
}

export class KimonSigil {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private mesh: THREE.Mesh;
  private shockMat: THREE.ShaderMaterial;
  private shock: THREE.Mesh;
  private shockT = -1;
  private sparkGeo = new THREE.BufferGeometry();
  private sparkPos = new Float32Array(SPARKS * 3);
  private sparkCol = new Float32Array(SPARKS * 3);
  private sparks: Spark[] = [];
  private sparkAcc = 0;
  private level = 0;
  private reveal = 0;
  private amount = 0;
  private flare = 0;
  private fade = 1; // burst 以后往 0 掉
  private t = 0;
  private spin: number;

  // radius：外圈半径（世界单位）；gen：艮卦（鬼门、东北）朝哪个方向（从上往下看、从桌子远端顺时针量的弧度）
  constructor(
    private radius: number,
    gen = Math.PI / 4,
  ) {
    this.spin = gen - Math.PI / 4;
    const u = {
      uTime: { value: 0 },
      uReveal: { value: 0 },
      uAmount: { value: 0 },
      uFlare: { value: 0 },
      uPulse: { value: 0 },
      // 让艮卦那一格正好落在 gen 的方向上；八卦圈只是轻轻晃，不整圈转
      uSpin: { value: this.spin },
      uGen: { value: 1 },
      uPlane: { value: PLANE },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2 * PLANE, radius * 2 * PLANE), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.04;
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;

    this.shockMat = new THREE.ShaderMaterial({
      uniforms: { uX: { value: 0 }, uPlane: { value: 2.6 } },
      vertexShader: VERT,
      fragmentShader: SHOCK_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.shock = new THREE.Mesh(new THREE.PlaneGeometry(radius * 5.2, radius * 5.2), this.shockMat);
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 0.06;
    this.shock.renderOrder = 7;
    this.shock.visible = false;

    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    const points = new THREE.Points(
      this.sparkGeo,
      new THREE.PointsMaterial({ size: 0.32, map: sparkTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    points.frustumCulled = false;
    points.renderOrder = 7;
    for (let i = 0; i < SPARKS; i++) this.sparks.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 1, age: 1 });

    this.group.add(this.mesh, this.shock, points);
    this.group.visible = false;
  }

  // 艮卦朝哪里（换了座位时）
  setGen(gen: number): void {
    this.spin = gen - Math.PI / 4;
  }

  setLevel(level: number): void {
    const v = Math.max(0, Math.min(1, level));
    if (v > 0 && this.level === 0) {
      // 新的一局又开了鬼门：从头描
      this.fade = 1;
      this.flare = 0;
      if (this.amount < 0.01) this.reveal = 0;
    }
    this.level = v;
  }

  // 和牌：阵爆亮，推开一圈冲击波，然后散掉
  burst(): void {
    this.flare = 1;
    this.fade = Math.min(this.fade, 0.999);
    this.shockT = 0;
    this.shock.visible = true;
    // 一下子甩出一圈火星
    for (let i = 0; i < SPARKS; i++) this.spawnSpark(this.sparks[i], 1.8);
  }

  private spawnSpark(s: Spark, power = 1): void {
    // 只从已经描出来的外圈上甩出来
    const span = Math.min(1, this.reveal / 0.18) * Math.PI * 2;
    const a = Math.random() * span;
    const dir = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    const tan = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    s.p.copy(dir).multiplyScalar(this.radius);
    s.p.y = 0.08;
    // 像砂轮甩出来的：顺着转的方向切出去，往外、往上
    s.v.copy(tan).multiplyScalar((1.5 + Math.random() * 2.5) * power).addScaledVector(dir, (0.8 + Math.random() * 1.6) * power);
    s.v.y = (1.5 + Math.random() * 3) * power;
    s.life = 0.35 + Math.random() * 0.5;
    s.age = 0;
  }

  update(dt: number): void {
    this.t += dt;
    // 浓淡跟着级别慢慢变；描的进度像笔一样匀速追上去
    const want = this.level > 0 ? 1 : 0;
    this.amount += (want - this.amount) * (1 - Math.exp(-dt * 2));
    const target = sigilReveal(this.level);
    const step = dt * 0.32;
    this.reveal += Math.max(-step * 3, Math.min(step, target - this.reveal));
    if (this.fade < 1) this.fade = Math.max(0, this.fade - dt * 0.9);
    this.flare = Math.max(0, this.flare - dt * 1.1);
    const amount = this.amount * this.fade;
    const live = this.shockT >= 0 || this.sparks.some((s) => s.age < s.life);
    this.group.visible = amount > 0.005 || live;
    if (!this.group.visible) return;

    const u = this.mat.uniforms;
    u.uTime.value = this.t;
    u.uReveal.value = this.reveal;
    u.uAmount.value = amount;
    u.uFlare.value = this.flare;
    u.uPulse.value = this.level >= 1 ? 1 : 0;
    u.uSpin.value = this.spin + Math.sin(this.t * 0.35) * 0.05;
    this.mesh.visible = amount > 0.005;
    this.mesh.scale.setScalar(1 + (1 - this.fade) * 0.12);

    if (this.shockT >= 0) {
      this.shockT += dt / 1.3;
      this.shockMat.uniforms.uX.value = Math.min(1, this.shockT);
      if (this.shockT >= 1) {
        this.shockT = -1;
        this.shock.visible = false;
      }
    }

    // 火星：描出外圈以后零零星星甩出来，听牌时多一点
    if (amount > 0.05 && this.fade === 1) {
      this.sparkAcc += dt * (6 + 14 * this.level) * Math.min(1, this.reveal / 0.18);
      while (this.sparkAcc >= 1) {
        this.sparkAcc -= 1;
        const s = this.sparks.find((x) => x.age >= x.life);
        if (s) this.spawnSpark(s);
      }
    }
    const hot = new THREE.Color('#fff0ff');
    const cool = new THREE.Color('#9b3cff');
    const c = new THREE.Color();
    for (let i = 0; i < SPARKS; i++) {
      const s = this.sparks[i];
      let b = 0;
      if (s.age < s.life) {
        s.age += dt;
        s.v.y -= 9 * dt;
        s.v.multiplyScalar(1 - dt * 1.5);
        s.p.addScaledVector(s.v, dt);
        if (s.p.y < 0.05) {
          s.p.y = 0.05;
          s.v.y *= -0.3;
        }
        const k = s.age / s.life;
        b = (1 - k) * (1 - k) * 1.4;
        c.copy(hot).lerp(cool, Math.min(1, k * 1.4));
      }
      this.sparkPos.set([s.p.x, s.p.y, s.p.z], i * 3);
      this.sparkCol.set([c.r * b, c.g * b, c.b * b], i * 3);
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.color.needsUpdate = true;
  }
}

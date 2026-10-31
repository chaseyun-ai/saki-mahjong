import * as THREE from 'three';
import { Effects, SPARK_FRAG, SPARK_VERT, TileBox, fireColor, fuseHead, fuseTrack, onTile } from './effects';

// 华丽版门清自摸「炎舞」：引线还是从左往右烧，烧到的牌上窜起一排着色器火焰、牌面被火舔过一遍、余烬往上飘；
// 烧到和的那张时整手牌一起爆燃：火环贴着桌面炸开、大团光晕（假的泛光）、震屏，再顿一下慢动作。
// 手机上（lite）火焰的噪声少算几层、牌面不烧、余烬少一半，画面构成不变

// 画面上的配合：慢动作、震屏、整屏的暗角和闪白（table3d.ts 给）
export interface BlazeStage {
  lite: boolean;
  slow(scale: number, secs: number): void;
  shake(amount: number): void;
  veil(kind: 'ignite' | 'burst'): void;
}

const NOISE = `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCT; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
// 火的颜色：暗红 → 橙 → 金黄 → 白
vec3 ramp(float f) {
  vec3 c = mix(vec3(0.55, 0.04, 0.0), vec3(1.0, 0.42, 0.04), smoothstep(0.1, 0.4, f));
  c = mix(c, vec3(1.0, 0.82, 0.35), smoothstep(0.4, 0.7, f));
  return mix(c, vec3(1.0, 1.0, 0.9), smoothstep(0.78, 1.0, f));
}`;

const UV_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// 一张牌上的火苗：底边在牌上，往上越来越窄；uHeight 是火苗高度（占整块的比例），噪声往上滚
const FLAME_FRAG = `
uniform float uTime, uSeed, uHeight, uFade;
varying vec2 vUv;
${NOISE}
void main() {
  float h = max(uHeight, 0.001);
  float y = vUv.y / h;
  if (y > 1.0 || uFade <= 0.0) discard;
  float x = vUv.x * 2.0 - 1.0;
  float n = fbm(vec2(vUv.x * 2.2 + uSeed, vUv.y * 1.8 - uTime * 2.6));
  float n2 = fbm(vec2(vUv.x * 3.4 + uSeed * 1.7 + n * 0.8, vUv.y * 2.6 - uTime * 3.4));
  x += (n - 0.5) * 0.5 * y;
  float shape = 1.0 - smoothstep(0.0, 1.0, abs(x) * (1.0 + y * 1.8));
  float f = clamp(shape * (1.25 - y) * 1.35 + (n2 - 0.5) * 1.1 - y * 0.35, 0.0, 1.0);
  float a = smoothstep(0.06, 0.4, f) * smoothstep(0.0, 0.12, vUv.y) * uFade * 0.8;
  gl_FragColor = vec4(ramp(f * 0.9), a);
}`;

// 牌面被火舔过：uFront 是火线在牌上的位置（0 左边沿，1 右边沿），火线后面留一片慢慢暗下去的余烬
const BURN_FRAG = `
uniform float uTime, uSeed, uFront, uFade;
varying vec2 vUv;
${NOISE}
void main() {
  float n = fbm(vUv * vec2(3.0, 5.0) + uSeed);
  float d = vUv.x - uFront + (n - 0.5) * 0.45;
  if (d > 0.08 || uFade <= 0.0) discard;
  float edge = exp(-abs(d) * 30.0);
  float ember = smoothstep(0.55, 0.8, fbm(vUv * vec2(6.0, 9.0) + vec2(uSeed, -uTime * 0.6))) * exp(d * 5.0);
  float f = clamp(edge * 0.95 + ember * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(ramp(f), clamp(edge * 0.8 + ember * 0.5, 0.0, 1.0) * uFade);
}`;

// 贴着桌面炸开的火环：uK 从 0 到 1，环往外扩、越来越淡，噪声把环撕成一条条火舌
const NOVA_FRAG = `
uniform float uK, uTime;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float n = fbm(vec2(ang * 3.0, r * 4.0 - uTime * 3.0));
  float R = 0.15 + 0.85 * (1.0 - pow(1.0 - uK, 2.4));
  float w = 0.05 + 0.12 * uK;
  float d = (r - R) / w + (n - 0.5) * 2.4;
  float f = exp(-d * d) * (1.0 - uK) * 0.95;
  f += smoothstep(R, 0.0, r) * 0.25 * (1.0 - uK) * n;
  if (f < 0.01) discard;
  f = clamp(f, 0.0, 1.0);
  gl_FragColor = vec4(ramp(f), smoothstep(0.02, 0.3, f));
}`;

const shader = (frag: string, uniforms: Record<string, THREE.IUniform>, oct: number) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: UV_VERT,
    fragmentShader: frag,
    defines: { OCT: oct },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

// 返回要等多少秒再出结算
export function blaze(fx: Effects, tiles: TileBox[], eye: THREE.Vector3, stage: BlazeStage, time = 0.95): number {
  const n = tiles.length;
  if (!n) return 0;
  const lite = stage.lite;
  const oct = lite ? 2 : 4;
  const unit = tiles[0].size.x;
  const tall = tiles[0].size.y;
  const { path, at, total, point } = fuseTrack(tiles);
  const linger = 1.15;
  const duration = time + linger;
  const group = new THREE.Group();
  const center = path[0].clone().lerp(path[path.length - 1], 0.5);
  const up = new THREE.Vector3(0, 1, 0);

  // 引线头、光尾、火星和牌底的光晕照旧
  fx.fuse(tiles, 'fire', '#ff9a2e', eye, time);
  stage.veil('ignite');

  // 每张牌一簇火苗：竖着、朝着镜头，从牌靠里的那条边窜起来，牌面还看得清
  const flameH = tall * (lite ? 2.8 : 3.6);
  const flames = tiles.map((b, i) => {
    const u = { uTime: { value: 0 }, uSeed: { value: i * 3.17 + Math.random() * 10 }, uHeight: { value: 0 }, uFade: { value: 1 } };
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(unit * 2.2, flameH), shader(FLAME_FRAG, u, oct));
    const base = onTile(b, 0, 0, b.size.z / 2);
    const away = base.clone().sub(eye).setY(0).normalize();
    base.addScaledVector(away, b.size.y * 0.45);
    mesh.position.copy(base);
    mesh.lookAt(eye);
    // 镜头往下看，竖起来的火苗往后仰一点，才像是从牌上长出来的
    const lean = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
    mesh.position.addScaledVector(lean.lerp(up, 0.5).normalize(), flameH * 0.45);
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    (mesh.material as THREE.ShaderMaterial).depthTest = false;
    group.add(mesh);
    return u;
  });

  // 牌面被火舔过（手机上不烧，光晕已经够了）
  const burns = lite
    ? []
    : tiles.map((b, i) => {
        const u = { uTime: { value: 0 }, uSeed: { value: i * 5.3 }, uFront: { value: -0.2 }, uFade: { value: 1 } };
        const mat = shader(BURN_FRAG, u, 3);
        mat.side = THREE.FrontSide;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.size.x, b.size.y), mat);
        mesh.quaternion.copy(b.quat);
        mesh.position.copy(onTile(b, 0, 0, b.size.z / 2 + 0.01));
        group.add(mesh);
        return u;
      });

  // 一大团跟着火势亮暗的光，盖住整手牌：没做真正的泛光，用它把画面烘亮
  const heat = new THREE.Sprite(new THREE.SpriteMaterial({ map: fx.glow, color: '#ff7a1e', blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
  heat.position.copy(center).addScaledVector(up, tall * 0.8);
  heat.renderOrder = 4;
  group.add(heat);

  // 余烬：从烧着的牌上慢慢往上飘，左右晃
  const count = lite ? 160 : 420;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const uniforms = { map: { value: fx.glow }, uHalfH: { value: 400 } };
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  const buf = new THREE.Vector2();
  pts.onBeforeRender = (r) => (uniforms.uHalfH.value = r.getDrawingBufferSize(buf).y / 2);
  group.add(pts);
  const sp = Array.from({ length: count }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, life: 0, s: 1, w: 0 }));
  let next = 0;
  const spawn = (p: THREE.Vector3, v: THREE.Vector3, life: number, s: number) => {
    const e = sp[next];
    next = (next + 1) % count;
    e.p.copy(p);
    e.v.copy(v);
    e.age = 0;
    e.life = life;
    e.s = s;
    e.w = Math.random() * 6.28;
  };

  // 烧到头：整手牌爆燃
  let burst = -1;
  const boom = () => {
    const end = path[path.length - 1];
    stage.shake(0.9);
    stage.slow(0.22, 0.38);
    stage.veil('burst');
    fx.flash(end, '#ffffff', unit * 5, 0.3);
    fx.flash(center.clone().addScaledVector(up, 0.5), '#ff8a2a', unit * 12, 0.8);
    const u = { uK: { value: 0 }, uTime: { value: 0 } };
    const nova = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shader(NOVA_FRAG, u, oct));
    nova.rotation.x = -Math.PI / 2;
    nova.position.copy(center).setY(center.y - tiles[0].size.z * 0.4);
    nova.scale.setScalar(Math.max(total * 0.6, unit * 8));
    nova.renderOrder = 3;
    fx.add(nova, 0.9, (k) => {
      u.uK.value = k;
      u.uTime.value = k * 0.9;
    });
    // 往外炸的一圈余烬
    for (let j = 0; j < (lite ? 50 : 140); j++) {
      const d = Math.random() * total;
      const a = Math.random() * Math.PI * 2;
      const r = (3 + Math.random() * 9) * unit;
      spawn(point(d), new THREE.Vector3(Math.cos(a) * r, (4 + Math.random() * 8) * unit, Math.sin(a) * r), 0.5 + Math.random() * 0.7, 1.4);
    }
  };

  let last = 0;
  let emitted = 0;
  const c = new THREE.Color();
  fx.add(group, duration, (k) => {
    const t = k * duration;
    const dt = Math.max(0, t - last);
    last = t;
    const d = fuseHead(total, time, t);
    if (t >= time && burst < 0) {
      burst = t;
      boom();
    }
    const sinceBurst = burst < 0 ? -1 : t - burst;
    // 爆燃时火苗一起窜高，之后整排慢慢收下去
    const flare = sinceBurst < 0 ? 0 : Math.exp(-sinceBurst * 5) * 0.4;
    const fade = sinceBurst < 0 ? 1 : Math.max(0, 1 - Math.max(0, sinceBurst - 0.35) / (linger - 0.35));
    flames.forEach((u, i) => {
      const age = (d - at[i + 1]) / unit; // 引线过了这张牌多少张牌宽
      const lit = age < -0.6 ? 0 : 1 - Math.exp(-(age + 0.6) * 2.2);
      const settle = 0.6 + 0.4 * Math.exp(-Math.max(0, age) * 0.35);
      u.uHeight.value = Math.min(1, lit * settle * (0.85 + 0.15 * Math.sin(t * 9 + i)) + flare);
      u.uTime.value = t;
      u.uFade.value = fade;
    });
    burns.forEach((u, i) => {
      u.uFront.value = (d - at[i + 1]) / tiles[i].size.x + 0.5;
      u.uTime.value = t;
      u.uFade.value = sinceBurst < 0 ? 1 : Math.max(0, 1 - sinceBurst / 0.6);
    });
    const heatK = Math.min(1, d / total);
    heat.scale.set(total * 1.5 + flare * unit * 10, tall * 4 + flare * unit * 6, 1);
    heat.material.opacity = (0.08 + 0.17 * heatK + flare * 0.5) * fade;
    // 余烬：烧过的牌上往外冒
    if (sinceBurst < 0.4) {
      const want = Math.floor(t * (lite ? 90 : 240));
      for (; emitted < want; emitted++) {
        const span = Math.max(0, d);
        if (span <= 0) continue;
        const p = point(Math.random() * span).addScaledVector(up, tall * 0.2);
        spawn(p, new THREE.Vector3((Math.random() - 0.5) * unit, (2.5 + Math.random() * 3.5) * unit, (Math.random() - 0.5) * unit), 0.6 + Math.random() * 0.7, 1);
      }
    }
    for (let j = 0; j < count; j++) {
      const s = sp[j];
      if (s.life <= 0 || s.age >= s.life) {
        size[j] = 0;
        continue;
      }
      s.age += dt;
      s.v.y -= 2 * unit * dt;
      s.v.x += Math.sin(s.age * 7 + s.w) * unit * 6 * dt;
      s.v.multiplyScalar(1 - dt * 1.2);
      s.p.addScaledVector(s.v, dt);
      const u = Math.min(1, s.age / s.life);
      pos[j * 3] = s.p.x;
      pos[j * 3 + 1] = s.p.y;
      pos[j * 3 + 2] = s.p.z;
      size[j] = unit * 0.3 * s.s * (1 - u * 0.5);
      fireColor(0.1 + u * 0.8, c);
      col[j * 3] = c.r;
      col[j * 3 + 1] = c.g;
      col[j * 3 + 2] = c.b;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  });
  return time + 0.6;
}

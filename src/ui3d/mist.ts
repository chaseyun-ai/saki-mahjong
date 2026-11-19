import * as THREE from 'three';

// 高鸭稳乃的深山：牌山上的雾（吉野的山里那种贴着山脊流的云海）。几级就有多浓，0 是没有。
// 每排牌山上叠几层沿着牌山的长条（着色器里画流动的分形噪声，扭一扭像一缕缕的雾），
// 最低一层压在上层牌的高度，牌挡住的地方看不见，雾像缠在牌山上；上面两层是飘在山顶的云海；
// 最底下一层贴着桌面往外漫一点。级数低时只有浓的几缕，级数越高连成一片。
// 只罩在牌山真的摆好了的墩上：新牌山还没升上来、牌还在飞的时候不起雾；一墩摸空了，它上面的雾慢慢散掉。
// 起雾、散雾都是一墩一墩地漫开，不是一下子出现。

export const STACKS = 17; // 每排牌山几墩
const MAX_LEVEL = 4;
// 每级雾的浓度（着色器里决定连成多大一片）
const DENSITY = [0, 0.38, 0.58, 0.76, 0.92];

// 一层雾：离牌山顶多高、横着多宽、噪声多细、流多快、多不透明、多碎（越大越只剩浓的几缕）
interface LayerSpec {
  y: number;
  width: number;
  scale: number;
  speed: number;
  opacity: number;
  wispy: number;
}
const LAYERS: LayerSpec[] = [
  { y: -1.5, width: 5.6, scale: 0.36, speed: 0.07, opacity: 0.32, wispy: 0.12 }, // 贴着桌面往外漫
  { y: -0.28, width: 3.6, scale: 0.62, speed: 0.1, opacity: 0.78, wispy: 0 }, // 缠在牌山上
  { y: 0.32, width: 3.1, scale: 0.34, speed: 0.12, opacity: 0.5, wispy: 0.1 }, // 山顶的云海（大团、软）
  { y: 0.95, width: 2.5, scale: 0.28, speed: 0.18, opacity: 0.4, wispy: 0.18 }, // 飘得高的几缕
];

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uDensity;
uniform float uOpacity;
uniform float uLen;
uniform float uMargin;
uniform float uSpacing;
uniform float uWidth;
uniform float uScale;
uniform float uSpeed;
uniform float uWispy;
uniform vec2 uSeed;
uniform vec3 uLight;
uniform vec3 uShade;
uniform float uMask[${STACKS}];
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = r * p * 2.03 + vec2(1.7, 9.2);
    a *= 0.46;
  }
  return v;
}

void main() {
  float x = vUv.x * uLen;
  float y = (vUv.y - 0.5) * uWidth;
  // 这里是第几墩（带小数），按两边的墩插值：摆好了几成
  float sf = (x - uMargin) / uSpacing;
  float i0 = clamp(floor(sf), 0.0, ${STACKS - 1}.0);
  float i1 = min(i0 + 1.0, ${STACKS - 1}.0);
  float m = mix(uMask[int(i0)], uMask[int(i1)], smoothstep(0.0, 1.0, clamp(sf - i0, 0.0, 1.0)));
  // 两头出了牌山也淡出去一点
  m *= smoothstep(-1.4, 0.2, sf) * smoothstep(${STACKS}.4, ${STACKS - 1.2}, sf);
  if (m < 0.002) discard;
  // 横着：牌山正上方浓，往两边淡
  float sig = uWidth * 0.26;
  float across = exp(-(y * y) / (2.0 * sig * sig));
  // 流动的雾：噪声再用噪声扭一下（一缕缕的），整片顺着牌山慢慢流
  vec2 p = vec2(x, y * 1.7) * uScale + uSeed;
  vec2 flow = vec2(uTime * uSpeed, uTime * uSpeed * 0.23);
  vec2 q = vec2(fbm(p + flow), fbm(p + vec2(5.2, 1.3) - flow * 0.6));
  float n = fbm(p + 1.8 * q + flow * 0.4);
  float body = across * m;
  float thr = mix(0.66, 0.2, uDensity) + uWispy;
  float a = smoothstep(thr, thr + 0.42, n * (0.55 + 0.45 * body) + 0.22 * body * uDensity);
  a *= smoothstep(0.0, 0.25, body);
  // 浓的地方被照亮发白，薄的边上带一点山里的青灰
  vec3 col = mix(uShade, uLight, smoothstep(0.35, 0.85, n + 0.15 * body));
  gl_FragColor = vec4(col, a * uOpacity);
  #include <colorspace_fragment>
}
`;

// 一墩牌山：雾放在哪（世界坐标，牌山顶上），牌山真的摆好了没有
export interface MistStack {
  pos: THREE.Vector3;
  filled: boolean;
}

interface Strip {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  layer: LayerSpec;
}

export class WallMist {
  readonly group = new THREE.Group();
  private walls: Strip[][] = [[], [], [], []];
  private masks: Float32Array[] = [0, 1, 2, 3].map(() => new Float32Array(STACKS));
  private level = 0;
  private shown = 0; // 现在显示的浓度（往 level 渐变）
  private stacks: MistStack[][] = [];
  private placed = ''; // 雾条按哪一套牌山位置摆的
  private t = 0;

  constructor() {
    this.group.visible = false;
  }

  // 四排牌山每一墩的位置和有没有摆好（stacks[wall][stack]，stack 0 是这排的第 1 墩）。牌局变了、每一帧都可以给
  setStacks(stacks: MistStack[][]): void {
    this.stacks = stacks;
    const key = stacks.map((row) => `${row[0]?.pos.toArray().map((v) => v.toFixed(2))}|${row[STACKS - 1]?.pos.toArray().map((v) => v.toFixed(2))}`).join(';');
    if (key !== this.placed && stacks.length === 4) {
      this.placed = key;
      this.build();
    }
  }

  // 有没有雾（要不要去看牌山摆好了没有）
  wanted(): boolean {
    return this.level > 0 || this.shown > 0;
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(MAX_LEVEL, level));
  }

  // 沿着每排牌山铺几层长条：从第 1 墩到第 17 墩，两头各多出一截
  private build(): void {
    for (const row of this.walls) for (const s of row) {
      s.mesh.removeFromParent();
      s.mesh.geometry.dispose();
      s.mat.dispose();
    }
    this.walls = [[], [], [], []];
    this.stacks.forEach((row, w) => {
      const a = row[0].pos;
      const b = row[STACKS - 1].pos;
      const along = b.clone().sub(a).setY(0);
      const span = along.length();
      if (span < 1e-3) return;
      const dir = along.normalize();
      const spacing = span / (STACKS - 1);
      const margin = spacing * 1.6;
      const len = span + margin * 2;
      // 横着的方向：往桌子中间那边（从牌山指向桌子中心）
      const mid = a.clone().add(b).multiplyScalar(0.5);
      let side = new THREE.Vector3(-dir.z, 0, dir.x);
      if (side.dot(mid.clone().setY(0).negate()) < 0) side = side.negate();
      LAYERS.forEach((layer, li) => {
        const geo = new THREE.PlaneGeometry(len, layer.width, 1, 1);
        // 平放（x 顺着牌山、y 横过牌山），再转到这排牌山的方向
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          uniforms: {
            uTime: { value: 0 },
            uDensity: { value: 0 },
            uOpacity: { value: 0 },
            uLen: { value: len },
            uMargin: { value: margin },
            uSpacing: { value: spacing },
            uWidth: { value: layer.width },
            uScale: { value: layer.scale },
            uSpeed: { value: layer.speed * (w % 2 ? -1 : 1) },
            uWispy: { value: layer.wispy },
            uSeed: { value: new THREE.Vector2(w * 17.3 + li * 5.1, li * 11.7) },
            uLight: { value: new THREE.Color('#f7fafc') },
            uShade: { value: new THREE.Color('#cbd6e1') },
            uMask: { value: this.masks[w] },
          },
        });
        const mesh = new THREE.Mesh(geo, mat);
        // 往桌子中间挪一点：牌山外侧贴着桌边，雾多往里漫
        const inward = layer.y < -1 ? 1.1 : 0.2;
        mesh.position.copy(mid).addScaledVector(side, inward);
        mesh.position.y = a.y + layer.y;
        // 平面的 +x 转到顺着牌山（从第 1 墩往第 17 墩），+z（uv 的 y 往下）转到朝外
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
        mesh.renderOrder = 5 + li;
        // 着色器里自己按牌山遮掉，不用按包围盒裁
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.walls[w].push({ mesh, mat, layer });
      });
    });
  }

  update(dt: number): void {
    this.t += dt;
    // 渐浓、渐淡：大约两秒到位
    this.shown += (this.level - this.shown) * (1 - Math.exp(-dt * 1.2));
    if (this.level === 0 && this.shown < 0.01) this.shown = 0;
    const lv = this.shown;
    const lo = Math.floor(lv);
    const f = lv - lo;
    const density = DENSITY[lo] + ((DENSITY[Math.min(MAX_LEVEL, lo + 1)] ?? DENSITY[lo]) - DENSITY[lo]) * f;
    // 一墩一墩漫开：摆好的墩雾慢慢起来（旁边已经有雾的起得快，像从旁边流过来），摸空的散得快一点
    let any = false;
    this.stacks.forEach((row, w) => {
      const mask = this.masks[w];
      for (let i = 0; i < STACKS; i++) {
        const want = row[i]?.filled ? 1 : 0;
        // 起雾时有的墩先冒出来（每墩快慢不一样），再往两边连成一片
        const near = Math.max(mask[i - 1] ?? 0, mask[i + 1] ?? 0);
        const rate = want > mask[i] ? 0.12 + 0.55 * seedOf(w, i) + 1.5 * near : 1.4;
        mask[i] += Math.sign(want - mask[i]) * Math.min(Math.abs(want - mask[i]), dt * rate);
        if (mask[i] > 0.002) any = true;
      }
    });
    this.group.visible = lv > 0.01 && any;
    if (!this.group.visible) return;
    // 刚起雾时整体也从淡到浓
    const fadeIn = Math.min(1, lv);
    for (const row of this.walls) {
      for (const s of row) {
        const u = s.mat.uniforms;
        u.uTime.value = this.t;
        u.uDensity.value = density;
        u.uOpacity.value = s.layer.opacity * fadeIn * (0.7 + 0.3 * density);
      }
    }
  }
}

// 每墩起雾的快慢（固定的，0–1）
function seedOf(w: number, i: number): number {
  const x = Math.sin(w * 91.7 + i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

import * as THREE from 'three';
import { PIXEL_ROWS, type PixelGrain } from '../ui/theme';

// 像素牌桌（theme.ts 的 pixel）的画法，做法参考 pixelfx（github.com/patch-gg/pixelfx，MIT）：
// 1. 低分辨率：画面按「画面高度折成多少行」（视觉设置里的像素颗粒）来画，canvas 用 image-rendering: pixelated 不插值放大，
//    一格像素就是整数个屏幕像素（至少两个）。table3d.ts 每次调尺寸时照 pixelStep 算 setPixelRatio
// 2. 画完一帧以后再过一遍（PixelGrade）：把这一帧抄下来，
//    - 饱和度提一点，暗处往冷、往紫偏，亮处往暖偏（像素画的色阶是“转色相”的，不是单纯变暗变亮）
//    - 描边：比上下左右的邻居暗很多的那一格再压暗、压紫，东西的轮廓多一圈深色的线（像素画的 outline）
//    - 色阶：每个通道只留几级，用 4×4 的 Bayer 矩阵抖动，渐变变成一级级的网点（pixelfx 的透明度也是这样抖的）
//    再画回去。只在像素牌桌上多这一遍

// 一格像素多少个屏幕（设备）像素：画面高 cssH，像素比 dpr
export function pixelStep(cssH: number, dpr: number, grain: PixelGrain): number {
  const g = PIXEL_ROWS[grain];
  return Math.max(g.min, Math.round((cssH * dpr) / g.rows));
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uLevels;
uniform float uDither;
uniform float uEdge;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// 4×4 Bayer 门槛（0–1），一格一个
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = luma(c);
  // 饱和度、对比度提一点
  c = mix(vec3(l), c, 1.28);
  c = (c - 0.5) * 1.06 + 0.5;
  // 暗处偏冷偏紫，亮处偏暖
  float dark = 1.0 - smoothstep(0.05, 0.45, l);
  float lit = smoothstep(0.55, 0.95, l);
  c += vec3(0.01, -0.012, 0.05) * dark + vec3(0.035, 0.018, -0.03) * lit;
  // 描边：四个邻居里最亮的比自己亮很多，这一格就在暗的那一侧，压暗、压紫一点
  float n = max(max(luma(texture2D(uTex, vUv + vec2(uTexel.x, 0.0)).rgb), luma(texture2D(uTex, vUv - vec2(uTexel.x, 0.0)).rgb)),
                max(luma(texture2D(uTex, vUv + vec2(0.0, uTexel.y)).rgb), luma(texture2D(uTex, vUv - vec2(0.0, uTexel.y)).rgb)));
  float e = smoothstep(uEdge, uEdge * 1.6, n - l);
  c = mix(c, c * vec3(0.42, 0.36, 0.58), e * 0.85);
  // 色阶：每个通道 uLevels 级。只有正好落在两级中间的那一小段才用 Bayer 网点抖过去（uDither 是这一段多宽），
  // 其余的就是一整片同一个颜色（像素画是一块块平涂，不是满屏网点）
  float b = (bayer4(gl_FragCoord.xy) - 0.5) * uDither;
  c = floor(clamp(c, 0.0, 1.0) * uLevels + 0.5 + b) / uLevels;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class PixelGrade {
  private tex: THREE.FramebufferTexture | null = null;
  private size = new THREE.Vector2();
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private u = {
    uTex: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
    // 每个通道几级（多一级就是 uLevels + 1 种值）
    uLevels: { value: 8 },
    // 两级之间抖动的那一段多宽（0 不抖，1 整段都抖）
    uDither: { value: 0.22 },
    // 邻居比自己亮多少才算轮廓
    uEdge: { value: 0.16 },
  };

  constructor() {
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  // 刚画好的这一帧过一遍再画回去
  apply(r: THREE.WebGLRenderer): void {
    r.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x));
    const h = Math.max(1, Math.floor(this.size.y));
    if (!this.tex || this.tex.image.width !== w || this.tex.image.height !== h) {
      this.tex?.dispose();
      this.tex = new THREE.FramebufferTexture(w, h);
      this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    }
    r.copyFramebufferToTexture(this.tex);
    this.u.uTex.value = this.tex;
    this.u.uTexel.value.set(1 / w, 1 / h);
    const auto = r.autoClear;
    const shadows = r.shadowMap.autoUpdate;
    r.autoClear = false;
    r.shadowMap.autoUpdate = false;
    r.render(this.scene, this.cam);
    r.autoClear = auto;
    r.shadowMap.autoUpdate = shadows;
  }

  dispose(): void {
    this.tex?.dispose();
    this.tex = null;
  }
}

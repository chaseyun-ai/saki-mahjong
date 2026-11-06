import * as THREE from 'three';
import type { Kind } from '../engine/tiles';
import { glowGlyph } from '../ui/tileArt';

// 初美鸣出来的东、北中间那张：从牌面往上投的一道「字形」光柱。
// 不是一根圆柱，而是一叠和牌面一样大的发光字，一层层往上叠：底下字形清楚、偏白，越往上越淡、越散开、稍微放大，
// 一道道亮纹顺着光柱往上走。叠的层都是牌的子物体，牌放在哪、怎么转，光柱都跟着。
// 从正上方看下去层层重合，着色器按视线和牌面的夹角自动压暗，2.5D 的俯视镜头也不会糊成一团白

const SLICES = 64;

const VERT = /* glsl */ `
attribute float iH;
uniform float uBase;
uniform float uHeight;
uniform float uSpread;
varying vec2 vUv;
varying float vH;
varying float vGain;
void main() {
  vUv = uv;
  vH = iH;
  float s = 1.0 + iH * iH * uSpread;
  vec3 p = vec3(position.xy * s, uBase + iH * uHeight);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec3 n = normalize((modelMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  float facing = abs(dot(normalize(cameraPosition - world.xyz), n));
  vGain = mix(1.0, 0.3, facing * facing);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uSharp;
uniform sampler2D uSoft;
uniform float uTime;
uniform float uA;
uniform float uSeed;
varying vec2 vUv;
varying float vH;
varying float vGain;
void main() {
  float sharp = texture2D(uSharp, vUv).a;
  float soft = texture2D(uSoft, vUv).a;
  // 一个个字从牌面浮起来往上走：亮纹很窄，每道亮纹就是一个清楚的字；中间连着一层淡淡的字形光
  float band = pow(0.5 + 0.5 * sin(vH * 24.0 - uTime * 2.6 + uSeed), 12.0);
  float m = mix(mix(sharp, soft, smoothstep(0.15, 0.9, vH)), sharp, band * 0.7);
  float fade = pow(1.0 - vH, 1.4) * smoothstep(0.0, 0.05, vH + 0.01);
  float flow = 0.3 + 1.7 * band;
  vec3 purple = vec3(0.72, 0.34, 1.0);
  vec3 col = mix(purple, vec3(1.0, 0.93, 1.0), sharp * (0.35 + 0.65 * band) * (1.0 - vH));
  gl_FragColor = vec4(col * m * fade * flow * vGain * uA, 1.0);
}
`;

// 每种字一套贴图：清楚的字形，和糊开的字形（光往上散开时用）
const textures = new Map<Kind, { sharp: THREE.CanvasTexture; soft: THREE.CanvasTexture }>();

function glyphTextures(kind: Kind): { sharp: THREE.CanvasTexture; soft: THREE.CanvasTexture } {
  const hit = textures.get(kind);
  if (hit) return hit;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 224;
    const tex = new THREE.CanvasTexture(c);
    return { c, tex };
  };
  const a = make();
  const b = make();
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(glowGlyph(kind, '#ffffff').replace('width="100%" height="100%"', 'width="160" height="224"'))}`;
  void img.decode().then(() => {
    // 和牌面贴图一样缩进 6% 画，层层对齐牌面上的字
    const draw = (ctx: CanvasRenderingContext2D, blur: number, alpha: number) => {
      ctx.filter = blur ? `blur(${blur}px)` : 'none';
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, 160 * 0.06, 224 * 0.06, 160 * 0.88, 224 * 0.88);
    };
    const sa = a.c.getContext('2d')!;
    draw(sa, 2.5, 0.8);
    draw(sa, 0.8, 1);
    const sb = b.c.getContext('2d')!;
    draw(sb, 9, 1);
    draw(sb, 5, 1);
    draw(sb, 2, 0.6);
    a.tex.needsUpdate = true;
    b.tex.needsUpdate = true;
  });
  const out = { sharp: a.tex, soft: b.tex };
  textures.set(kind, out);
  return out;
}

const geometries = new Map<string, THREE.InstancedBufferGeometry>();

function slices(w: number, h: number): THREE.InstancedBufferGeometry {
  const key = `${w}x${h}`;
  const hit = geometries.get(key);
  if (hit) return hit;
  const plane = new THREE.PlaneGeometry(w, h);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.getAttribute('position'));
  g.setAttribute('uv', plane.getAttribute('uv'));
  g.setAttribute('iH', new THREE.InstancedBufferAttribute(Float32Array.from({ length: SLICES }, (_, i) => i / (SLICES - 1)), 1));
  g.instanceCount = SLICES;
  geometries.set(key, g);
  return g;
}

export class GlyphBeam {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  // w、h：牌面上字那块的大小；base：牌面离牌中心多远（光柱从这里往上）；height：光柱多高
  constructor(kind: Kind, w: number, h: number, base: number, height = 3.4) {
    const tex = glyphTextures(kind);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSharp: { value: tex.sharp },
        uSoft: { value: tex.soft },
        uTime: { value: 0 },
        uA: { value: 0 },
        uSeed: { value: Math.random() * 6.28 },
        uBase: { value: base + 0.01 },
        uHeight: { value: height },
        uSpread: { value: 0.3 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(slices(w, h), this.mat);
    // 包围盒只有一层牌面那么大，往上叠的层会被误裁掉
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  // strength：0 关掉；一明一暗由调用的人给
  update(time: number, strength: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uA.value = strength * 0.7;
    this.mesh.visible = strength > 0.001;
  }
}

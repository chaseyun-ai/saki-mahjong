import * as THREE from 'three';

// 龙门渊透华的治水：牌桌平静如水。桌布上铺一层淡淡的水面：冷冷的蓝色，水底的光纹慢慢晃，
// 中间每隔几秒荡开一圈很轻的涟漪（只有一圈，马上平下去，水面很静）。
// 铺在桌布上、牌底下，不挡牌；浓淡渐变，不是一下子出现

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // 一圈一圈慢慢荡开的涟漪，越往外越淡
  float rings = 0.0;
  for (int i = 0; i < 2; i++) {
    float t = fract(uTime * 0.07 + float(i) * 0.5);
    float d = r - t * 1.35;
    rings += exp(-d * d * 900.0) * (1.0 - t) * (1.0 - t);
  }
  // 水底的光纹
  float c = sin(p.x * 7.0 + uTime * 0.35 + sin(p.y * 5.0 + uTime * 0.27) * 1.3)
          * sin(p.y * 6.5 - uTime * 0.3 + sin(p.x * 4.5 - uTime * 0.22) * 1.3);
  c = smoothstep(0.55, 1.0, c);
  // 四边淡出，不盖到桌框
  float edge = smoothstep(1.0, 0.82, max(abs(p.x), abs(p.y)));
  // 桌布本身常是蓝的：水面用偏白的浅青色，像一层透亮的冰水
  vec3 deep = vec3(0.55, 0.8, 0.95);
  vec3 light = vec3(0.92, 0.98, 1.0);
  vec3 col = mix(deep, light, clamp(rings * 0.9 + c * 0.6, 0.0, 1.0));
  float a = (0.14 + rings * 0.75 + c * 0.17) * edge * uLevel;
  gl_FragColor = vec4(col, a);
}
`;

export class StillWater {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private target = 0;
  private level = 0;
  private t = 0;

  constructor(half: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), this.mat);
    plane.rotation.x = -Math.PI / 2;
    // 贴着桌布，牌在上面
    plane.position.y = 0.004;
    plane.renderOrder = 1;
    this.group.add(plane);
    this.group.visible = false;
  }

  // on：这一局是不是治水
  setOn(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  update(dt: number): void {
    this.t += dt;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt * 1.2));
    if (this.target === 0 && this.level < 0.01) this.level = 0;
    this.group.visible = this.level > 0;
    this.mat.uniforms.uTime.value = this.t;
    this.mat.uniforms.uLevel.value = this.level;
  }
}

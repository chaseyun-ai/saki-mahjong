import * as THREE from 'three';

// 和牌时手牌一倒，上方几盏聚光灯一盏接一盏打开，均匀照在和了的那副牌上：
// 每盏一道从高处斜着打下来的淡淡光束（像舞台上雾里看得见的那种），落在桌上一圈柔边的光斑。
// 真正把牌照亮的是 table3d 里那盏 SpotLight（四周同时稍微暗一点），这里只画看得见的光束和光斑，
// level 告诉它现在亮到几成

// 只看横截面上的夹角（视线去掉顺着光束的分量）：正对视线的地方浓、侧边淡
const CONE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vec3 axis = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vec3 v = cameraPosition - world.xyz;
  v -= axis * dot(v, axis);
  vFacing = abs(dot(n, normalize(v + 1e-5)));
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

// v：0 在桌上，1 在灯口。灯口那头浓一点、往下慢慢散开变淡，到桌面前收掉（接上光斑）；雾里的灰尘慢慢飘
const CONE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uA;
uniform float uTime;
varying vec2 vUv;
varying float vFacing;
void main() {
  float v = vUv.y;
  float edge = pow(vFacing, 1.5);
  float along = smoothstep(0.0, 0.12, v) * (0.5 + 0.5 * v) * (1.0 - smoothstep(0.9, 1.0, v));
  float ang = vUv.x * 6.2831853;
  float dust = 0.86 + 0.14 * sin(v * 23.0 - uTime * 0.9 + ang * 3.0) * sin(v * 7.0 + uTime * 0.4 + ang);
  gl_FragColor = vec4(uColor * edge * along * dust * uA, 1.0);
  #include <colorspace_fragment>
}
`;

const POOL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 桌上的光斑：椭圆，边缘柔但看得出是一盏灯打出来的一圈，中间略亮
const POOL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uA;
uniform vec2 uR;
varying vec2 vP;
void main() {
  float d = length(vP / uR);
  if (d > 1.0) discard;
  float m = (1.0 - smoothstep(0.7, 1.0, d)) * (0.75 + 0.25 * (1.0 - d * d));
  gl_FragColor = vec4(uColor * m * uA, 1.0);
  #include <colorspace_fragment>
}
`;

// 一副要照的牌：中心、沿着这排牌的方向、朝桌子中间的方向（水平单位向量），半长
export interface SpotRow {
  center: THREE.Vector3;
  side: THREE.Vector3;
  inward: THREE.Vector3;
  half: number;
}

// 一盏灯打开要多久、相邻两盏隔多久、关掉要多久
const ON_TIME = 0.07;
const ON_STAGGER = 0.13;
const OFF_TIME = 0.45;

const glow = (frag: string, vert: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

interface Spot {
  on: number;
  cone: THREE.ShaderMaterial;
  pool: THREE.ShaderMaterial;
}

export class WinSpots {
  readonly group = new THREE.Group();
  readonly rows: SpotRow[];
  level = 0;
  private t = 0;
  private stopAt = -1;
  private spots: Spot[] = [];

  // lamp：灯离桌面多高；每副牌按长短分成几盏（三盏或四盏）均匀排开
  constructor(rows: SpotRow[], color: THREE.ColorRepresentation = '#fff0d2', lamp = 11) {
    this.rows = rows;
    const coneGeo = new THREE.CylinderGeometry(0.07, 1, 1, 40, 1, true);
    coneGeo.translate(0, 0.5, 0);
    let k = 0;
    for (const row of rows) {
      const n = row.half > 5 ? 4 : 3;
      const cell = row.half / n;
      for (let i = 0; i < n; i++) {
        const x = -row.half + (2 * i + 1) * cell;
        const at = row.center.clone().addScaledVector(row.side, x).setY(0.03);
        // 灯在牌的上方、往桌子中间那边退一点，几盏灯往中间收拢一点，光束斜着打下来
        const lampPos = row.center
          .clone()
          .addScaledVector(row.side, x * 0.55)
          .addScaledVector(row.inward, 2)
          .setY(lamp);
        const rx = cell * 1.25;
        const rz = 2;
        const cu = { uColor: { value: new THREE.Color(color) }, uA: { value: 0 }, uTime: { value: 0 } };
        const cone = new THREE.Mesh(coneGeo, glow(CONE_FRAG, CONE_VERT, cu));
        const Y = lampPos.clone().sub(at);
        const L = Y.length();
        Y.divideScalar(L);
        const X = row.side.clone().addScaledVector(Y, -row.side.dot(Y)).normalize();
        const Z = new THREE.Vector3().crossVectors(X, Y);
        cone.matrixAutoUpdate = false;
        cone.matrix.makeBasis(X, Y, Z).scale(new THREE.Vector3(rx, L, rz)).setPosition(at);
        const pu = { uColor: { value: new THREE.Color(color) }, uA: { value: 0 }, uR: { value: new THREE.Vector2(rx, rz) } };
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(rx * 2, rz * 2), glow(POOL_FRAG, POOL_VERT, pu));
        // 平放在桌上，平面的 x 顺着这排牌
        const up = new THREE.Vector3(0, 1, 0);
        pool.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(row.side, new THREE.Vector3().crossVectors(up, row.side), up));
        pool.position.copy(at);
        for (const m of [cone, pool]) {
          m.frustumCulled = false;
          m.renderOrder = 2;
          this.group.add(m);
        }
        this.spots.push({ on: k++ * ON_STAGGER, cone: cone.material, pool: pool.material });
      }
    }
  }

  get done(): boolean {
    return this.stopAt >= 0 && this.t >= this.stopAt + OFF_TIME;
  }

  stop(): void {
    if (this.stopAt < 0) this.stopAt = this.t;
  }

  update(dt: number): void {
    this.t += dt;
    const off = this.stopAt < 0 ? 1 : Math.max(0, 1 - (this.t - this.stopAt) / OFF_TIME);
    let sum = 0;
    for (const s of this.spots) {
      const u = (this.t - s.on) / ON_TIME;
      // 啪地一下打开：冲过头一点再落回来，之后很轻地呼吸
      const b = u <= 0 ? 0 : u < 1 ? u : 1 + 0.35 * Math.exp(-(this.t - s.on - ON_TIME) / 0.12) + 0.03 * Math.sin(this.t * 2.1 + s.on * 7);
      const v = b * off;
      s.cone.uniforms.uA.value = 0.16 * v;
      s.cone.uniforms.uTime.value = this.t;
      s.pool.uniforms.uA.value = 0.3 * v;
      sum += Math.min(v, 1.2);
    }
    this.level = this.spots.length ? sum / this.spots.length : 0;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.group.removeFromParent();
  }
}

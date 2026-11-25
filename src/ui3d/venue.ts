import * as THREE from 'three';

// 牌桌四周的场地：一眼看得出是在部室里练习、在比赛会场，还是站在决赛的舞台上。
//
// 镜头看得到的只有桌子后面那一小块：3D 是对家身后、地面到大约 1 米高的一条（竖屏时高一些，能看到窗户、白板）；
// 2.5D、俯视只露出桌子四角和上沿外面的地面。东西都摆在这些地方，看不到的（天花板、镜头背后的墙）不做。
//
// 省电：每个场地只画三到五次——
//   · 墙、家具合成一个网格，共用一张现画的图集，不受光（MeshBasicMaterial），明暗、贴地的阴影事先算进顶点颜色；
//   · 地面一个网格，一张现画的贴图（木地板、地毯、舞台面），桌子底下的影子画在贴图里；
//   · 发光的东西（荧光棒、灯条、窗外的光）一个网格，叠加混合；
//   · 决赛另有两个：看台上的观众（图集里画好的小人，一人一个四边形，抠图），围挡上滚动的字幕。
// 不投影子、不吃雾、不另外下载素材：贴图都是建牌桌时用 canvas 现画的。

export type VenueKind = 'club' | 'match' | 'final';
// 部室跟主页一样分清晨、白天、黄昏、夜里（主页那张图是哪个时间，部室就是哪个时间）
export type VenueTod = 'dawn' | 'day' | 'dusk' | 'night';

export interface VenueSpec {
  kind: VenueKind;
  // 比赛、决赛的牌子上写什么：大赛名、哪一轮、哪一桌（不给就只写大赛名）
  title?: string;
  round?: string;
  table?: string;
  tod?: VenueTod;
}

// 场地按人的尺寸（米）摆，乘 scale 换成世界单位（人物 1 米是多少个单位，跟着人物大小走）
export interface VenueFrame {
  scale: number;
  floorY: number; // 牌桌脚下的地面（世界单位）
}

export const VENUE_TITLE = '全国高中麻将大赛';

// 这一场在哪儿打（App 照牌局的来路填）：全国大赛团体赛的哪一轮、哪一桌、哪个位置；个人赛的哪一场；自己组的团体赛；平时的单局
export type VenueWhere =
  | { kind: 'national'; round: string; table: string; final: boolean; pos: string }
  | { kind: 'solo'; label: string; final: boolean }
  | { kind: 'team'; pos: string }
  | { kind: 'single' };

// 视觉设置里的「牌桌环境」加上这一场在哪儿打，定下摆哪种场地、牌子上写什么。
// 自动：单局在部室；团体赛、全国大赛在比赛会场；全国大赛的决赛（团体赛总决赛、个人赛决赛桌）上决赛舞台。
// 指定了哪种就一直摆哪种（牌子上照样写这一场；单局没有轮次，只写大赛名），off 是原来的纯色背景
export function chooseVenue(pick: 'auto' | VenueKind | 'off', where: VenueWhere, tod: VenueTod): VenueSpec | null {
  if (pick === 'off') return null;
  const club: VenueSpec = { kind: 'club', tod };
  if (pick === 'club') return club;
  let auto = club;
  if (where.kind === 'national') {
    // 总决赛那一桌就叫「决赛」，跟轮次重了，只写位置
    const table = where.table === where.round ? where.pos : `${where.table} · ${where.pos}`;
    auto = { kind: where.final ? 'final' : 'match', title: VENUE_TITLE, round: `团体赛 · ${where.round}`, table };
  } else if (where.kind === 'solo') auto = { kind: where.final ? 'final' : 'match', title: VENUE_TITLE, round: '个人赛', table: where.label };
  else if (where.kind === 'team') auto = { kind: 'match', title: VENUE_TITLE, round: '团体赛', table: where.pos };
  if (pick === 'auto') return auto;
  return auto.kind === 'club' ? { kind: pick, title: VENUE_TITLE } : { ...auto, kind: pick };
}

type V3 = readonly [number, number, number];
type UV = readonly [number, number, number, number]; // u0 v0 u1 v1（左下、右上）
type Rgb = THREE.Color;

const col = (hex: string): Rgb => new THREE.Color(hex);
// 顶点颜色按这个方向打光（和牌桌的主光一样从左前上方来），朝上的面最亮、背光的面暗一些
const LIGHT = new THREE.Vector3(-0.35, 0.8, 0.5).normalize();

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 网格 ----------

// 一个合成网格：坐标都写米（x 左右、h 离地多高、z 前后，+z 朝着镜头），顶点颜色里带着明暗
class Mesher {
  private P: number[] = [];
  private C: number[] = [];
  private T: number[] = [];
  private I: number[] = [];
  private xf = new THREE.Matrix4();
  private plain = true;
  ground = 0; // 贴地的那圈压暗从这个高度（米）算
  ao = 0.3;
  lit = true; // false：不按朝向打光（发光的东西）
  tint = new THREE.Color(1, 1, 1);

  constructor(
    private M: number,
    private FY: number,
  ) {}

  // 在 (x, z) 处、绕竖轴转 ry 摆一件东西：ry 0 时正面朝 +z（朝着镜头）；rx 再往前后倒（负的往后仰）
  at(x: number, z: number, ry: number, fn: () => void, h = 0, rx = 0): void {
    const keep = this.xf.clone();
    const keepPlain = this.plain;
    this.xf.multiply(new THREE.Matrix4().makeRotationY(ry).setPosition(x, h, z));
    if (rx) this.xf.multiply(new THREE.Matrix4().makeRotationX(rx));
    this.plain = false;
    fn();
    this.xf.copy(keep);
    this.plain = keepPlain;
  }

  private pt(v: V3): THREE.Vector3 {
    const p = new THREE.Vector3(v[0], v[1], v[2]);
    return this.plain ? p : p.applyMatrix4(this.xf);
  }

  private push(ps: THREE.Vector3[], cs: Rgb[], uvs: number[]): void {
    const n = new THREE.Vector3().subVectors(ps[1], ps[0]).cross(new THREE.Vector3().subVectors(ps[2], ps[0])).normalize();
    const s = this.lit ? 0.6 + 0.4 * Math.max(0, n.dot(LIGHT)) : 1;
    const base = this.P.length / 3;
    ps.forEach((p, k) => {
      const h = p.y - this.ground;
      const ao = this.ao > 0 ? 1 - this.ao * Math.exp(-Math.max(0, h) / 0.1) : 1;
      const c = cs[k];
      this.P.push(p.x * this.M, this.FY + p.y * this.M, p.z * this.M);
      this.C.push(c.r * s * ao * this.tint.r, c.g * s * ao * this.tint.g, c.b * s * ao * this.tint.b);
    });
    this.T.push(...uvs);
    if (ps.length === 4) this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.I.push(base, base + 1, base + 2);
  }

  // 四边形 a b c d：从正面看逆时针（a 左下、b 右下、c 右上、d 左上），贴图照 uv 铺
  quad(a: V3, b: V3, c: V3, d: V3, color: Rgb | Rgb[], uv: UV = WHITE): void {
    const cs = Array.isArray(color) ? color : [color, color, color, color];
    this.push([a, b, c, d].map((v) => this.pt(v)), cs, [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]]);
  }

  tri(a: V3, b: V3, c: V3, color: Rgb | Rgb[], uv: UV = WHITE): void {
    const cs = Array.isArray(color) ? color : [color, color, color];
    this.push([a, b, c].map((v) => this.pt(v)), cs, [uv[0], uv[1], uv[2], uv[1], (uv[0] + uv[2]) / 2, uv[3]]);
  }

  // 三角形，每个点各给一个贴图坐标
  triUv(a: V3, b: V3, c: V3, color: Rgb, ta: [number, number], tb: [number, number], tc: [number, number]): void {
    this.push([a, b, c].map((v) => this.pt(v)), [color, color, color], [...ta, ...tb, ...tc]);
  }

  // 两面都看得见的薄片（叶子、纸）
  sheet(a: V3, b: V3, c: V3, d: V3, color: Rgb | Rgb[], uv: UV = WHITE): void {
    this.quad(a, b, c, d, color, uv);
    const cs = Array.isArray(color) ? [color[1], color[0], color[3], color[2]] : color;
    this.quad(b, a, d, c, cs, [uv[2], uv[1], uv[0], uv[3]]);
  }

  // 方盒：front/top 可以贴图，不给就是纯色；背面、底面默认不画（贴着墙、地看不到）
  box(x0: number, x1: number, h0: number, h1: number, z0: number, z1: number, color: Rgb, o: { front?: UV; top?: UV; back?: boolean; bottom?: boolean; sides?: boolean; topColor?: Rgb } = {}): void {
    this.quad([x0, h0, z1], [x1, h0, z1], [x1, h1, z1], [x0, h1, z1], color, o.front ?? WHITE);
    this.quad([x0, h1, z1], [x1, h1, z1], [x1, h1, z0], [x0, h1, z0], o.topColor ?? color, o.top ?? WHITE);
    if (o.sides !== false) {
      this.quad([x1, h0, z1], [x1, h0, z0], [x1, h1, z0], [x1, h1, z1], color);
      this.quad([x0, h0, z0], [x0, h0, z1], [x0, h1, z1], [x0, h1, z0], color);
    }
    if (o.back) this.quad([x1, h0, z0], [x0, h0, z0], [x0, h1, z0], [x1, h1, z0], color);
    if (o.bottom) this.quad([x0, h0, z0], [x1, h0, z0], [x1, h0, z1], [x0, h0, z1], color);
  }

  // 竖着的圆柱 / 圆台（r0 底、r1 顶），a0–a1 是从 +z 往 +x 转的角度；inward 时面朝里（看台的竖面）
  cyl(cx: number, cz: number, r0: number, r1: number, h0: number, h1: number, seg: number, color: Rgb | [Rgb, Rgb], o: { top?: boolean; a0?: number; a1?: number; inward?: boolean; uv?: UV; topColor?: Rgb } = {}): void {
    const a0 = o.a0 ?? 0;
    const a1 = o.a1 ?? Math.PI * 2;
    const [cb, ct] = Array.isArray(color) ? color : [color, color];
    const at = (r: number, a: number, h: number): V3 => [cx + r * Math.sin(a), h, cz + r * Math.cos(a)];
    const uv = o.uv ?? WHITE;
    for (let i = 0; i < seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const b = a0 + ((a1 - a0) * (i + 1)) / seg;
      if (o.inward) {
        // 从里面看 a 越大越靠左：贴图倒着铺，字才是从左往右读
        const u0 = uv[2] - ((uv[2] - uv[0]) * (i + 1)) / seg;
        const u1 = uv[2] - ((uv[2] - uv[0]) * i) / seg;
        this.quad(at(r0, b, h0), at(r0, a, h0), at(r1, a, h1), at(r1, b, h1), [cb, cb, ct, ct], [u0, uv[1], u1, uv[3]]);
      } else {
        const u0 = uv[0] + ((uv[2] - uv[0]) * i) / seg;
        const u1 = uv[0] + ((uv[2] - uv[0]) * (i + 1)) / seg;
        this.quad(at(r0, a, h0), at(r0, b, h0), at(r1, b, h1), at(r1, a, h1), [cb, cb, ct, ct], [u0, uv[1], u1, uv[3]]);
      }
      if (o.top) this.tri([cx, h1, cz], at(r1, a, h1), at(r1, b, h1), o.topColor ?? ct);
    }
  }

  // 平放的圆环（朝上），r0 内 r1 外，uv 的 u 沿着圆周铺 turns 圈
  ring(cx: number, cz: number, r0: number, r1: number, h: number, seg: number, color: Rgb | [Rgb, Rgb], o: { a0?: number; a1?: number; uv?: UV; turns?: number } = {}): void {
    const a0 = o.a0 ?? 0;
    const a1 = o.a1 ?? Math.PI * 2;
    const [ci, co] = Array.isArray(color) ? color : [color, color];
    const uv = o.uv ?? WHITE;
    const turns = o.turns ?? 1;
    const at = (r: number, a: number): V3 => [cx + r * Math.sin(a), h, cz + r * Math.cos(a)];
    for (let i = 0; i < seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      const b = a0 + ((a1 - a0) * (i + 1)) / seg;
      // 字从外圈看是正的：沿着 a 增大的方向（从上往下看顺时针）往前读
      const fa = ((i * turns) / seg) % 1;
      const fb = fa + turns / seg;
      const u0 = uv[0] + (uv[2] - uv[0]) * fa;
      const u1 = uv[0] + (uv[2] - uv[0]) * fb;
      this.quad(at(r1, a), at(r1, b), at(r0, b), at(r0, a), [co, co, ci, ci], [u1, uv[3], u0, uv[1]]);
    }
  }

  // 凸的截面沿一根轴拉出来，两头封口：axis 'x' 时截面在 (z, h) 里，'z' 时在 (x, h) 里。
  // 截面用 rounded() 做成圆角，靠每个面朝向不同的明暗显出圆鼓鼓的样子（沙发、书包、镜头）
  extrude(profile: [number, number][], d0: number, d1: number, axis: 'x' | 'z', color: Rgb, o: { caps?: boolean; capColor?: Rgb } = {}): void {
    const n = profile.length;
    const P = (p: number, q: number, d: number): V3 => (axis === 'x' ? [d, q, p] : [p, q, d]);
    const cp = profile.reduce((s, v) => s + v[0], 0) / n;
    const cq = profile.reduce((s, v) => s + v[1], 0) / n;
    // 三个点围成的面是不是朝着 out 那边（截面顺时针、逆时针给都行）
    const facing = (a: V3, b: V3, c: V3, out: V3) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      return (u[1] * v[2] - u[2] * v[1]) * out[0] + (u[2] * v[0] - u[0] * v[2]) * out[1] + (u[0] * v[1] - u[1] * v[0]) * out[2] > 0;
    };
    for (let i = 0; i < n; i++) {
      const a = profile[i];
      const b = profile[(i + 1) % n];
      const q: V3[] = [P(a[0], a[1], d0), P(a[0], a[1], d1), P(b[0], b[1], d1), P(b[0], b[1], d0)];
      if (facing(q[0], q[1], q[2], P((a[0] + b[0]) / 2 - cp, (a[1] + b[1]) / 2 - cq, 0))) this.quad(q[0], q[1], q[2], q[3], color);
      else this.quad(q[1], q[0], q[3], q[2], color);
    }
    if (o.caps === false) return;
    const cap = o.capColor ?? color;
    for (const [d, s] of [[d0, -1], [d1, 1]] as const) {
      const out: V3 = axis === 'x' ? [s, 0, 0] : [0, 0, s];
      const c = P(cp, cq, d);
      for (let i = 0; i < n; i++) {
        const a = profile[i];
        const b = profile[(i + 1) % n];
        const pa = P(a[0], a[1], d);
        const pb = P(b[0], b[1], d);
        if (facing(c, pa, pb, out)) this.tri(c, pa, pb, cap);
        else this.tri(c, pb, pa, cap);
      }
    }
  }

  // 靠垫：正面朝 +z 的鼓包，四角圆中带尖，宽 w 高 h 厚 t，底边中点在原点
  pillow(w: number, h: number, t: number, color: Rgb): void {
    const n = 16;
    const ring = (k: number, z: number): V3[] =>
      Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        // 方中带圆（超椭圆），边上往里收一点，像塞满了棉花的样子
        const e = 0.55;
        const pinch = 1 - 0.05 * (1 - Math.abs(Math.sin(2 * a)));
        return [Math.sign(c) * Math.abs(c) ** e * (w / 2) * k * pinch, h / 2 + Math.sign(s) * Math.abs(s) ** e * (h / 2) * k * pinch, z];
      });
    for (const side of [1, -1]) {
      const rim = ring(1, 0);
      const mid = ring(0.66, side * t * 0.38);
      const top: V3 = [0, h / 2, side * t * 0.5];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (side > 0) {
          this.quad(rim[i], rim[j], mid[j], mid[i], color);
          this.tri(mid[i], mid[j], top, color);
        } else {
          this.quad(rim[j], rim[i], mid[i], mid[j], color);
          this.tri(mid[j], mid[i], top, color);
        }
      }
    }
  }

  get empty(): boolean {
    return this.I.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.T, 2));
    g.setIndex(this.I);
    g.computeBoundingSphere();
    return g;
  }
}

// 圆角矩形的截面（逆时针）：横 a0–a1、竖 b0–b1，四个角的半径按 右下、右上、左上、左下 给，每个角 seg 段
function rounded(a0: number, a1: number, b0: number, b1: number, r: number | [number, number, number, number], seg = 3): [number, number][] {
  const [rbr, rtr, rtl, rbl] = typeof r === 'number' ? [r, r, r, r] : r;
  const out: [number, number][] = [];
  const corner = (cx: number, cy: number, rad: number, start: number) => {
    if (rad <= 0) {
      out.push([cx, cy]);
      return;
    }
    for (let i = 0; i <= seg; i++) {
      const t = start + (i / seg) * (Math.PI / 2);
      out.push([cx + Math.cos(t) * rad, cy + Math.sin(t) * rad]);
    }
  };
  corner(a1 - rbr, b0 + rbr, rbr, -Math.PI / 2);
  corner(a1 - rtr, b1 - rtr, rtr, 0);
  corner(a0 + rtl, b1 - rtl, rtl, Math.PI / 2);
  corner(a0 + rbl, b0 + rbl, rbl, Math.PI);
  return out;
}

// 圆的截面（逆时针），n 边形
function circle(cx: number, cy: number, r: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });
}

// ---------- 画贴图 ----------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

// 图集：每块地方用像素矩形划出来，换成贴图坐标（canvas 左上是原点，three 的 v 从下往上）
class Atlas {
  readonly cv: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  constructor(
    readonly W: number,
    readonly H: number,
  ) {
    [this.cv, this.g] = canvas(W, H);
    this.g.fillStyle = '#ffffff';
    this.g.fillRect(0, 0, 32, 32);
  }
  uv(x: number, y: number, w: number, h: number, inset = 1.5): UV {
    return [(x + inset) / this.W, 1 - (y + h - inset) / this.H, (x + w - inset) / this.W, 1 - (y + inset) / this.H];
  }
}
// 图集左上角 32×32 是白的：不贴图的东西都指着这里，颜色全靠顶点颜色
const WHITE: UV = [4 / 2048, 1 - 28 / 1024, 28 / 2048, 1 - 4 / 1024];

const FONT_SANS = "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const FONT_HAND = "'Long Cang', 'Ma Shan Zheng', 'KaiTi', 'STKaiti', cursive";
const FONT_BRUSH = "'Ma Shan Zheng', 'Long Cang', 'KaiTi', 'STKaiti', serif";
const FONT_LATIN = "'Barlow Condensed', 'Arial Narrow', sans-serif";
// 牌子上的字要等字体下载好再画（没下载好先用系统字体画一遍，下载好重画）
export const VENUE_FONTS = [`900 40px ${FONT_SANS}`, `700 40px ${FONT_LATIN}`, `40px ${FONT_HAND}`, `40px ${FONT_BRUSH}`];

// 字太长就缩到放得下
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: (px: number) => string): void {
  let px = size;
  g.font = font(px);
  while (px > 8 && g.measureText(text).width > maxW) {
    px *= 0.94;
    g.font = font(px);
  }
  g.fillText(text, x, y);
}

function grain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, n: number, color: string, r: () => number, size = 2): void {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillRect(x + r() * w, y + r() * h, size * (0.5 + r()), size * (0.5 + r()));
}

function softBlob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, alpha: number): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, color.replace('A', String(alpha)));
  gr.addColorStop(1, color.replace('A', '0'));
  g.fillStyle = gr;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

// 圆角矩形的路径
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 大赛的徽章（原创）：一筒那样的同心圆，外面一圈八道光，中间一颗星
function emblem(g: CanvasRenderingContext2D, x: number, y: number, r: number, ink: string, accent: string, paper: string): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = ink;
  for (let i = 0; i < 8; i++) {
    g.save();
    g.rotate((i * Math.PI) / 4);
    g.beginPath();
    g.moveTo(-r * 0.13, -r * 0.78);
    g.lineTo(0, -r);
    g.lineTo(r * 0.13, -r * 0.78);
    g.fill();
    g.restore();
  }
  g.beginPath();
  g.arc(0, 0, r * 0.78, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = paper;
  g.beginPath();
  g.arc(0, 0, r * 0.64, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = ink;
  g.lineWidth = r * 0.07;
  g.beginPath();
  g.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = accent;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr2 = i % 2 ? r * 0.17 : r * 0.38;
    g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
  }
  g.closePath();
  g.fill();
  g.restore();
}

function texture(c: HTMLCanvasElement, aniso: number, mip = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}

// ---------- 部室 ----------
// 跟主页那间是同一间：木地板、灰蓝的墙裙、大窗户、推拉门、白板、收音机。桌子摆在屋子中间，
// 对家背后靠墙是一排矮书柜（左）和窗下的沙发（右），白板、推拉门在两边更远的地方（宽屏、竖屏才看得到）

const CLUB = {
  back: -2.3, // 后墙
  side: 3.2, // 两边的墙
  front: 2.8, // 地板往镜头这边铺到哪
  wallH: 2.8,
  rail: 0.92, // 墙裙上沿
  win: [-0.6, 2.4] as const, // 窗户左右
  sill: 0.95,
  winTop: 2.3,
  shelf: [-1.5, -0.42] as const, // 书柜左右
  shelfD: 0.38,
  shelfH: 0.88,
  sofa: [0.35, 1.95] as const,
  sofaD: 0.8,
  floorF: 3.2, // 地板贴图铺满 [-F, F]
};

interface TodLook {
  tint: Rgb; // 整间屋子的色调
  sky: [string, string, string]; // 窗外：天顶、中间、地平线
  sun: { color: string; alpha: number; reach: number } | null; // 地上的阳光：颜色、多亮、从墙根往前照多远（米）
  far: string; // 远处房子、树的颜色
  lit: boolean; // 夜里窗外的房子亮几盏灯
}

const TODS: Record<VenueTod, TodLook> = {
  dawn: { tint: col('#f4efff').multiplyScalar(0.97), sky: ['#9fb9e6', '#f2c9c6', '#fbe2c4'], sun: { color: '255,226,190', alpha: 0.22, reach: 2.6 }, far: '#9aa3b8', lit: false },
  day: { tint: col('#ffffff'), sky: ['#5fa8ee', '#a9d3f7', '#e2f1fb'], sun: { color: '255,244,214', alpha: 0.26, reach: 1.8 }, far: '#c9cfd6', lit: false },
  dusk: { tint: col('#ffe2c8').multiplyScalar(0.98), sky: ['#5b4f8c', '#e98a5c', '#f8c98a'], sun: { color: '255,170,96', alpha: 0.34, reach: 3.4 }, far: '#6b5866', lit: false },
  night: { tint: col('#c9d4f0').multiplyScalar(0.8), sky: ['#0b1230', '#1a2850', '#2c3d66'], sun: null, far: '#151c33', lit: true },
};

function clubAtlas(a: Atlas, tod: TodLook, r: () => number): Record<string, UV> {
  const g = a.g;
  const out: Record<string, UV> = {};
  // 书柜两层的正面：深色的柜膛里一排书（1000 像素约 1 米宽）
  const books = (x: number, y: number, w: number, h: number, seed: number) => {
    const rr2 = rng(seed);
    const bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, '#2a1d14');
    bg.addColorStop(1, '#46321f');
    g.fillStyle = bg;
    g.fillRect(x, y, w, h);
    const palette = ['#2f4a7a', '#8c2f2f', '#3e6b4a', '#c99a3a', '#e8e0cc', '#5a5f6a', '#2e7a7a', '#7a4a8c', '#d0662f', '#f1ece0'];
    let px = x + 10;
    while (px < x + w - 20) {
      // 偶尔空一段、放一个横躺的牌盒或者文件盒
      if (rr2() < 0.08) {
        const bw = 120 + rr2() * 60;
        if (px + bw > x + w - 10) break;
        const bh = 70 + rr2() * 20;
        g.fillStyle = '#e9e4d6';
        g.fillRect(px, y + h - bh - 4, bw, bh);
        g.fillStyle = '#b8402f';
        g.fillRect(px, y + h - bh - 4, bw, 12);
        g.fillStyle = '#3a2a20';
        g.font = `700 ${Math.round(bh * 0.36)}px ${FONT_SANS}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(rr2() < 0.5 ? '麻将牌' : '牌谱', px + bw / 2, y + h - bh / 2);
        px += bw + 8;
        continue;
      }
      const bw = 22 + rr2() * 30;
      const bh = h * (0.55 + rr2() * 0.35);
      const c = palette[Math.floor(rr2() * palette.length)];
      const lean = rr2() < 0.1 ? (rr2() - 0.5) * 0.25 : 0;
      g.save();
      g.translate(px + bw / 2, y + h - 4);
      g.rotate(lean);
      g.fillStyle = c;
      g.fillRect(-bw / 2, -bh, bw, bh);
      // 书脊上的两道烫金线、书名一小条
      g.fillStyle = 'rgba(255,240,200,0.55)';
      g.fillRect(-bw / 2, -bh + bh * 0.08, bw, 3);
      g.fillRect(-bw / 2, -bh * 0.12, bw, 3);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(-bw * 0.22, -bh * 0.72, bw * 0.44, bh * 0.38);
      // 左边亮一点、右边暗一点，书是圆脊的
      const sh = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      sh.addColorStop(0, 'rgba(255,255,255,0.18)');
      sh.addColorStop(0.5, 'rgba(255,255,255,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.3)');
      g.fillStyle = sh;
      g.fillRect(-bw / 2, -bh, bw, bh);
      g.restore();
      px += bw + 1 + (rr2() < 0.15 ? 6 : 0);
    }
    // 柜膛顶上一道阴影
    const top = g.createLinearGradient(0, y, 0, y + h * 0.3);
    top.addColorStop(0, 'rgba(0,0,0,0.55)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = top;
    g.fillRect(x, y, w, h * 0.3);
    return a.uv(x, y, w, h);
  };
  out.booksA = books(40, 0, 1000, 360, 11);
  out.booksB = books(40, 370, 1000, 360, 23);

  // 收音机正面（和主页上那台一样的老式木壳）：左边圆喇叭网，右边刻度窗和两个旋钮
  {
    const x = 1050;
    const y = 0;
    const w = 280;
    const h = 180;
    g.fillStyle = '#7a4a2c';
    rr(g, x, y, w, h, 18);
    g.fill();
    g.fillStyle = '#4a2c1a';
    rr(g, x + 12, y + 12, w - 24, h - 24, 12);
    g.fill();
    g.fillStyle = '#c9b48c';
    g.beginPath();
    g.arc(x + 90, y + 90, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(70,45,25,0.6)';
    g.lineWidth = 3;
    for (let i = -56; i <= 56; i += 9) {
      const half = Math.sqrt(62 * 62 - i * i);
      g.beginPath();
      g.moveTo(x + 90 + i, y + 90 - half);
      g.lineTo(x + 90 + i, y + 90 + half);
      g.stroke();
    }
    g.fillStyle = '#efe2b8';
    g.fillRect(x + 170, y + 40, 90, 44);
    g.fillStyle = '#b8402f';
    g.fillRect(x + 210, y + 42, 3, 40);
    for (const kx of [x + 190, x + 240]) {
      g.fillStyle = '#2a1a10';
      g.beginPath();
      g.arc(kx, y + 128, 16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c9a66a';
      g.beginPath();
      g.arc(kx - 4, y + 124, 5, 0, Math.PI * 2);
      g.fill();
    }
    out.radio = a.uv(x, y, w, h);
  }

  // 窗外：天、云、远处的教学楼和树
  {
    const x = 1340;
    const y = 0;
    const w = 700;
    const h = 380;
    const sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, tod.sky[0]);
    sky.addColorStop(0.55, tod.sky[1]);
    sky.addColorStop(1, tod.sky[2]);
    g.fillStyle = sky;
    g.fillRect(x, y, w, h);
    if (!tod.lit) {
      for (let i = 0; i < 5; i++) softBlob(g, x + r() * w, y + 40 + r() * 140, 60 + r() * 60, 18 + r() * 10, 'rgba(255,255,255,A)', 0.7);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 40; i++) g.fillRect(x + r() * w, y + r() * h * 0.5, 2, 2);
    }
    // 教学楼：一长条，两排窗
    const by = y + h * 0.58;
    g.fillStyle = tod.far;
    g.fillRect(x + 60, by, 380, h * 0.3);
    g.fillRect(x + 440, by + 30, 180, h * 0.3 - 30);
    g.fillStyle = tod.lit ? 'rgba(255,214,140,0.9)' : 'rgba(80,100,130,0.45)';
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 14; i++) {
        if (tod.lit && r() < 0.6) continue;
        g.fillRect(x + 74 + i * 26, by + 14 + row * 34, 16, 18);
      }
    }
    // 树
    g.fillStyle = tod.lit ? '#0f1a1c' : tod === TODS.dusk ? '#4a4a3a' : '#5d8f5a';
    for (let i = 0; i < 9; i++) softBlob(g, x + 20 + i * 80 + r() * 30, y + h * 0.86, 44 + r() * 20, 30, tod.lit ? 'rgba(15,26,28,A)' : 'rgba(93,143,90,A)', 0.95);
    g.fillStyle = tod.lit ? '#1a1f2a' : '#d9cfa8';
    g.fillRect(x, y + h * 0.9, w, h * 0.1);
    out.window = a.uv(x, y, w, h);
  }

  // 白板：半张写着练习安排的纸，一排磁铁，马克笔写的字
  {
    const x = 1340;
    const y = 400;
    const w = 700;
    const h = 525;
    g.fillStyle = '#f7f8f8';
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(150,160,170,0.12)';
    for (let i = 0; i < 6; i++) softBlob(g, x + r() * w, y + r() * h, 80, 30, 'rgba(150,160,170,A)', 0.12);
    // 纸
    g.save();
    g.translate(x + 470, y + 70);
    g.rotate(0.03);
    g.fillStyle = '#efe3c2';
    g.fillRect(0, 0, 190, 250);
    g.fillStyle = 'rgba(60,50,40,0.55)';
    for (let i = 0; i < 9; i++) g.fillRect(18, 34 + i * 22, 120 + ((i * 37) % 40), 3);
    g.restore();
    const mag = ['#d64545', '#d6a92a', '#8a4fc9', '#3f74d6', '#3aa860'];
    mag.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(x + 70 + i * 52, y + 430, 17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.beginPath();
      g.arc(x + 64 + i * 52, y + 424, 5, 0, Math.PI * 2);
      g.fill();
    });
    for (const [px, py] of [[478, 74], [648, 80], [474, 312], [644, 318]]) {
      g.fillStyle = '#3f74d6';
      g.beginPath();
      g.arc(x + px, y + py, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#2f55b8';
    fitText(g, '今日练习：东南战 ×3', x + 40, y + 90, 400, 54, (px) => `${px}px ${FONT_HAND}`);
    g.fillStyle = '#c23a3a';
    fitText(g, '目标：全国大赛！', x + 40, y + 180, 400, 64, (px) => `${px}px ${FONT_HAND}`);
    g.fillStyle = '#333a44';
    fitText(g, '立直之前先看牌河', x + 40, y + 260, 400, 42, (px) => `${px}px ${FONT_HAND}`);
    // 画了一张牌（一筒）
    g.strokeStyle = '#333a44';
    g.lineWidth = 4;
    rr(g, x + 70, y + 290, 70, 96, 10);
    g.stroke();
    g.beginPath();
    g.arc(x + 105, y + 338, 22, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#c23a3a';
    g.beginPath();
    g.arc(x + 105, y + 338, 9, 0, Math.PI * 2);
    g.fill();
    out.board = a.uv(x, y, w, h);
  }

  // 推拉门上贴的纸：毛笔写的「麻将部」
  {
    const x = 1050;
    const y = 190;
    const w = 240;
    const h = 330;
    g.fillStyle = '#f4ecd8';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(120,90,60,0.35)';
    g.lineWidth = 4;
    g.strokeRect(x + 10, y + 10, w - 20, h - 20);
    g.fillStyle = '#1e1a16';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `92px ${FONT_BRUSH}`;
    ['麻', '将', '部'].forEach((ch, i) => g.fillText(ch, x + w / 2, y + 70 + i * 96));
    out.poster = a.uv(x, y, w, h);
  }

  // 发光贴图：中间亮四周黑的圆斑（叠加混合用）
  out.glow = glowSprite(a, 40, 740);
  return out;
}

function glowSprite(a: Atlas, x: number, y: number): UV {
  const g = a.g;
  g.fillStyle = '#000';
  g.fillRect(x, y, 128, 128);
  const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 62);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(x, y, 128, 128);
  return a.uv(x, y, 128, 128, 2);
}

function clubFloor(tod: TodLook, size: number): HTMLCanvasElement {
  const F = CLUB.floorF;
  const [c, g] = canvas(size, size);
  const px = size / (2 * F);
  const X = (x: number) => (x + F) * px;
  const Z = (z: number) => (z + F) * px;
  const r = rng(5);
  // 木地板：前后方向铺的长条，接缝错开，每条颜色差一点
  const pw = 0.13 * px;
  for (let i = 0; i * pw < size; i++) {
    let y = -r() * 1.6 * px;
    while (y < size) {
      const len = (1.1 + r() * 1.3) * px;
      const l = 0.9 + r() * 0.16;
      g.fillStyle = `rgb(${Math.round(196 * l)},${Math.round(150 * l)},${Math.round(104 * l)})`;
      g.fillRect(i * pw, y, pw, len);
      for (let k = 0; k < 5; k++) {
        g.fillStyle = `rgba(110,72,38,${0.05 + r() * 0.08})`;
        g.fillRect(i * pw + r() * pw, y, 0.6 + r() * 1.2, len);
      }
      g.fillStyle = 'rgba(80,52,28,0.55)';
      g.fillRect(i * pw, y, pw, 1.2);
      y += len;
    }
    g.fillStyle = 'rgba(80,52,28,0.5)';
    g.fillRect(i * pw, 0, 1.2, size);
  }
  // 地毯：桌子底下一块砖红的，米色的双线边（不要太浅：竖屏时手牌下面那一截全是它，提示字要看得清）
  const R = 1.2;
  g.fillStyle = '#7e4236';
  g.fillRect(X(-R), Z(-R), 2 * R * px, 2 * R * px);
  grain(g, X(-R), Z(-R), 2 * R * px, 2 * R * px, 3200, 'rgba(40,16,10,0.16)', r, 2);
  grain(g, X(-R), Z(-R), 2 * R * px, 2 * R * px, 1600, 'rgba(255,210,180,0.05)', r, 2);
  g.fillStyle = '#6a362d';
  g.fillRect(X(-R + 0.08), Z(-R + 0.08), 2 * (R - 0.08) * px, 2 * (R - 0.08) * px);
  g.fillStyle = '#7e4236';
  g.fillRect(X(-R + 0.2), Z(-R + 0.2), 2 * (R - 0.2) * px, 2 * (R - 0.2) * px);
  g.strokeStyle = '#d8c29a';
  g.lineWidth = 0.022 * px;
  g.strokeRect(X(-R + 0.08), Z(-R + 0.08), 2 * (R - 0.08) * px, 2 * (R - 0.08) * px);
  g.lineWidth = 0.012 * px;
  g.strokeRect(X(-R + 0.2), Z(-R + 0.2), 2 * (R - 0.2) * px, 2 * (R - 0.2) * px);
  // 流苏：前后两头一排短线
  g.strokeStyle = 'rgba(216,194,154,0.8)';
  g.lineWidth = 0.008 * px;
  for (const z of [-R, R]) {
    for (let x = -R + 0.03; x < R; x += 0.035) {
      g.beginPath();
      g.moveTo(X(x), Z(z));
      g.lineTo(X(x), Z(z + Math.sign(z) * 0.05));
      g.stroke();
    }
  }
  // 窗户照进来的阳光：后墙上两扇窗，往镜头这边投成两块（中间窗框隔开）
  if (tod.sun) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    const [w0, w1] = CLUB.win;
    const near = CLUB.back + 0.25;
    const far = CLUB.back + 0.25 + tod.sun.reach;
    const skew = 0.35;
    const panes = 4;
    for (let k = 0; k < panes; k++) {
      const a = w0 + ((w1 - w0) * k) / panes + 0.05;
      const b = w0 + ((w1 - w0) * (k + 1)) / panes - 0.05;
      const gr = g.createLinearGradient(0, Z(near), 0, Z(far));
      gr.addColorStop(0, `rgba(${tod.sun.color},${tod.sun.alpha})`);
      gr.addColorStop(1, `rgba(${tod.sun.color},${tod.sun.alpha * 0.55})`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(X(a), Z(near));
      g.lineTo(X(b), Z(near));
      g.lineTo(X(b + skew * tod.sun.reach), Z(far));
      g.lineTo(X(a + skew * tod.sun.reach), Z(far));
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  // 贴地的阴影：桌子底下、书柜和沙发底下、墙根
  g.save();
  g.globalCompositeOperation = 'multiply';
  softBlob(g, X(0), Z(0), 0.95 * px, 0.95 * px, 'rgba(60,40,25,A)', 0.55);
  const under = (x0: number, x1: number, z0: number, z1: number, a: number) => {
    g.filter = `blur(${Math.round(0.06 * px)}px)`;
    g.fillStyle = `rgba(60,40,25,${a})`;
    g.fillRect(X(x0), Z(z0), (x1 - x0) * px, (z1 - z0) * px);
    g.filter = 'none';
  };
  under(CLUB.shelf[0] - 0.03, CLUB.shelf[1] + 0.03, CLUB.back, CLUB.back + CLUB.shelfD + 0.06, 0.6);
  under(CLUB.sofa[0], CLUB.sofa[1], CLUB.back, CLUB.back + CLUB.sofaD + 0.04, 0.55);
  const wallShade = g.createLinearGradient(0, Z(CLUB.back), 0, Z(CLUB.back + 0.5));
  wallShade.addColorStop(0, 'rgba(60,40,25,0.45)');
  wallShade.addColorStop(1, 'rgba(60,40,25,0)');
  g.fillStyle = wallShade;
  g.fillRect(0, Z(CLUB.back), size, 0.5 * px);
  g.restore();
  // 整间屋子的时段色调
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `#${tod.tint.clone().convertLinearToSRGB().getHexString()}`;
  g.fillRect(0, 0, size, size);
  g.restore();
  return c;
}

function buildClub(m: Mesher, glow: Mesher, uv: Record<string, UV>, tod: TodLook): void {
  m.tint.copy(tod.tint);
  glow.tint.copy(tod.tint);
  const { back, side, wallH, rail } = CLUB;
  const wallTop = col('#ebe7df');
  const wallLow = col('#b7c2c9');
  const wood = col('#9b7450');
  const woodLight = col('#b88d62');
  const alu = col('#cfd5da');
  // 后墙：上半截米白，下半截灰蓝的墙裙，中间一道木条，底下踢脚板
  const wall = (x0: number, x1: number) => {
    m.quad([x0, 0, back], [x1, 0, back], [x1, rail, back], [x0, rail, back], [wallLow.clone().multiplyScalar(0.86), wallLow.clone().multiplyScalar(0.86), wallLow, wallLow]);
    m.quad([x0, rail, back], [x1, rail, back], [x1, wallH, back], [x0, wallH, back], [wallTop, wallTop, wallTop.clone().multiplyScalar(0.94), wallTop.clone().multiplyScalar(0.94)]);
  };
  wall(-side, side);
  m.box(-side, side, rail - 0.01, rail + 0.035, back, back + 0.025, woodLight);
  m.box(-side, side, 0, 0.08, back, back + 0.018, wood);
  // 两边的墙（宽屏、和牌转镜头时才露出一点）
  for (const s of [-1, 1]) {
    const x = s * side;
    const zs = s < 0 ? [CLUB.front, back] : [back, CLUB.front];
    m.quad([x, 0, zs[0]], [x, 0, zs[1]], [x, rail, zs[1]], [x, rail, zs[0]], wallLow.clone().multiplyScalar(0.9));
    m.quad([x, rail, zs[0]], [x, rail, zs[1]], [x, wallH, zs[1]], [x, wallH, zs[0]], wallTop.clone().multiplyScalar(0.92));
  }

  // 窗户：两大扇，铝窗框，窗台，两边扎起来的窗帘
  const [w0, w1] = CLUB.win;
  const { sill, winTop } = CLUB;
  const glassZ = back + 0.012;
  m.lit = false;
  const span = w1 - w0;
  const pane = (a: number, b: number) => {
    const u0 = uv.window[0] + ((uv.window[2] - uv.window[0]) * (a - w0)) / span;
    const u1 = uv.window[0] + ((uv.window[2] - uv.window[0]) * (b - w0)) / span;
    m.quad([a, sill, glassZ], [b, sill, glassZ], [b, winTop, glassZ], [a, winTop, glassZ], col('#ffffff'), [u0, uv.window[1], u1, uv.window[3]]);
  };
  pane(w0, w1);
  m.lit = true;
  const bar = (x0: number, x1: number, h0: number, h1: number) => m.box(x0, x1, h0, h1, back, back + 0.045, alu);
  bar(w0 - 0.05, w1 + 0.05, winTop, winTop + 0.05);
  for (let k = 0; k <= 4; k++) {
    const x = w0 + (span * k) / 4;
    bar(x - (k % 4 === 0 ? 0.05 : 0.025), x + (k % 4 === 0 ? 0.05 : 0.025), sill, winTop);
  }
  bar(w0, w1, sill + 0.62, sill + 0.65);
  m.box(w0 - 0.08, w1 + 0.08, sill - 0.035, sill, back, back + 0.13, col('#e7e3da'));
  const curtain = col('#efe5d0');
  for (const [x0, x1] of [[w0 - 0.32, w0 - 0.04], [w1 + 0.04, w1 + 0.32]]) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n;
      const b = x0 + ((x1 - x0) * (i + 1)) / n;
      const c = curtain.clone().multiplyScalar(i % 2 ? 0.86 : 1);
      m.quad([a, sill - 0.25, back + 0.06 + (i % 2) * 0.03], [b, sill - 0.25, back + 0.06 + ((i + 1) % 2) * 0.03], [b, winTop + 0.12, back + 0.06 + ((i + 1) % 2) * 0.03], [a, winTop + 0.12, back + 0.06 + (i % 2) * 0.03], c);
    }
  }
  m.box(w0 - 0.4, w1 + 0.4, winTop + 0.12, winTop + 0.16, back, back + 0.08, col('#d7d2c8'));
  // 窗外的光：窗下的墙、地上一层很淡的亮（夜里没有）
  if (tod.sun) {
    const k = tod === TODS.dusk ? col('#ff9a50') : col('#fff1d0');
    glow.quad([w0, sill + 0.02, glassZ + 0.01], [w1, sill + 0.02, glassZ + 0.01], [w1, winTop, glassZ + 0.01], [w0, winTop, glassZ + 0.01], k.clone().multiplyScalar(0.18), uv.glowWide);
  }

  // 推拉门（左边远处）：木框，下半木板，上半磨砂玻璃，贴着「麻将部」
  {
    const d0 = -2.95;
    const d1 = -1.85;
    const top = 1.98;
    m.box(d0 - 0.06, d1 + 0.06, top, top + 0.07, back, back + 0.05, wood);
    m.box(d0 - 0.06, d0, 0, top, back, back + 0.05, wood);
    m.box(d1, d1 + 0.06, 0, top, back, back + 0.05, wood);
    const mid = (d0 + d1) / 2;
    m.box(d0, d1, 0, 0.95, back, back + 0.03, woodLight);
    m.box(mid - 0.025, mid + 0.025, 0, top, back, back + 0.045, wood);
    m.box(d0, d1, 0.95, 1.0, back, back + 0.04, wood);
    m.quad([d0, 1.0, back + 0.02], [d1, 1.0, back + 0.02], [d1, top, back + 0.02], [d0, top, back + 0.02], [col('#cdd6dc'), col('#cdd6dc'), col('#e7edf0'), col('#e7edf0')]);
    m.quad([d0 + 0.12, 1.12, back + 0.035], [d0 + 0.42, 1.12, back + 0.035], [d0 + 0.42, 1.53, back + 0.035], [d0 + 0.12, 1.53, back + 0.035], col('#ffffff'), uv.poster);
  }

  // 矮书柜（左）：两层，上面放着收音机、一摞文件夹、一盆小仙人掌
  {
    const [x0, x1] = CLUB.shelf;
    const z0 = back + 0.02;
    const z1 = z0 + CLUB.shelfD;
    const H = CLUB.shelfH;
    const t = 0.03;
    m.box(x0, x1, H - t, H, z0, z1, woodLight);
    m.box(x0, x0 + t, 0, H - t, z0, z1, wood);
    m.box(x1 - t, x1, 0, H - t, z0, z1, wood);
    m.box(x0 + t, x1 - t, 0, 0.06, z0, z1, wood);
    m.box(x0 + t, x1 - t, 0.44, 0.47, z0, z1, woodLight);
    m.lit = false;
    m.quad([x0 + t, 0.06, z1 - 0.012], [x1 - t, 0.06, z1 - 0.012], [x1 - t, 0.44, z1 - 0.012], [x0 + t, 0.44, z1 - 0.012], col('#ffffff'), uv.booksA);
    m.quad([x0 + t, 0.47, z1 - 0.012], [x1 - t, 0.47, z1 - 0.012], [x1 - t, H - t, z1 - 0.012], [x0 + t, H - t, z1 - 0.012], col('#ffffff'), uv.booksB);
    m.lit = true;
    m.ground = H;
    // 收音机
    m.box(x0 + 0.1, x0 + 0.4, H, H + 0.19, z0 + 0.12, z0 + 0.26, col('#7a4a2c'), { front: uv.radio });
    m.box(x0 + 0.33, x0 + 0.335, H + 0.19, H + 0.36, z0 + 0.15, z0 + 0.155, col('#b8b8b8'));
    // 文件夹
    m.box(x0 + 0.48, x0 + 0.8, H, H + 0.05, z0 + 0.06, z0 + 0.32, col('#2f5d9a'));
    m.box(x0 + 0.5, x0 + 0.78, H + 0.05, H + 0.09, z0 + 0.08, z0 + 0.3, col('#d8d2c2'));
    // 小仙人掌
    m.cyl(x1 - 0.13, z0 + 0.19, 0.055, 0.065, H, H + 0.09, 10, col('#b8653f'), { top: true, topColor: col('#5a3a22') });
    m.cyl(x1 - 0.13, z0 + 0.19, 0.04, 0.03, H + 0.09, H + 0.2, 8, col('#4f8a4a'), { top: true });
    m.ground = 0;
  }

  // 沙发（右，窗户下面）：墨绿的布面，圆鼓鼓的扶手、靠背、坐垫，两个靠垫，扔着一个书包
  {
    const [x0, x1] = CLUB.sofa;
    const z0 = back + 0.04;
    const z1 = z0 + CLUB.sofaD;
    const fab = col('#6f8a68');
    const fabLight = col('#7c9774');
    const fabDark = col('#58704f');
    const arm = 0.17;
    const seat = 0.44;
    for (const lx of [x0 + 0.07, x1 - 0.07]) m.box(lx - 0.025, lx + 0.025, 0, 0.08, z1 - 0.1, z1 - 0.05, col('#3a2a1e'));
    // 底座（坐垫底下那一截）
    m.extrude(rounded(z0, z1 - 0.03, 0.08, 0.3, [0.04, 0.03, 0, 0]), x0 + arm - 0.02, x1 - arm + 0.02, 'x', fabDark);
    // 靠背：往后仰一点，上沿圆的
    m.extrude(
      [
        [z0, 0.28],
        [z0 + 0.26, 0.28],
        [z0 + 0.21, 0.74],
        [z0 + 0.18, 0.81],
        [z0 + 0.12, 0.85],
        [z0 + 0.05, 0.84],
        [z0 + 0.01, 0.79],
      ],
      x0 + arm - 0.02,
      x1 - arm + 0.02,
      'x',
      fab,
    );
    // 扶手：上面卷成圆的，从前看是圆头
    for (const s of [-1, 1]) {
      const a0 = s < 0 ? x0 : x1 - arm;
      m.extrude(rounded(a0, a0 + arm, 0.08, 0.63, s < 0 ? [0.02, 0.07, 0.08, 0.02] : [0.02, 0.08, 0.07, 0.02]), z0, z1, 'z', fab, { capColor: fabLight });
    }
    // 两块坐垫：前沿圆的，中间一道缝
    const mid = (x0 + x1) / 2;
    for (const [c0, c1] of [
      [x0 + arm, mid - 0.006],
      [mid + 0.006, x1 - arm],
    ]) {
      m.extrude(rounded(z0 + 0.2, z1, 0.29, seat, [0.04, 0.07, 0.03, 0]), c0, c1, 'x', fabLight);
    }
    // 靠垫：一个芥末黄、一个珊瑚色，斜靠在靠背上
    m.ground = seat;
    m.at(x0 + arm + 0.25, z0 + 0.3, 0.22, () => m.pillow(0.38, 0.36, 0.13, col('#c7a15e')), seat - 0.01, -0.32);
    m.at(x1 - arm - 0.23, z0 + 0.3, -0.2, () => m.pillow(0.35, 0.33, 0.13, col('#c4796a')), seat - 0.01, -0.3);
    // 书包：深蓝，圆角，盖子盖下来一截，一个金色的扣
    m.at(mid + 0.06, z0 + 0.55, -0.14, () => {
      const navyBag = col('#2e3c5c');
      m.extrude(rounded(-0.18, 0.18, 0, 0.26, [0.025, 0.06, 0.06, 0.025]), -0.07, 0.07, 'z', navyBag);
      m.extrude(rounded(-0.175, 0.175, 0.11, 0.265, [0.04, 0.06, 0.06, 0.04]), 0.068, 0.082, 'z', col('#3b4b70'));
      m.box(-0.028, 0.028, 0.115, 0.155, 0.082, 0.09, col('#c9a64a'));
      m.extrude(rounded(-0.06, 0.06, 0.26, 0.3, [0, 0.02, 0.02, 0]), -0.012, 0.012, 'z', col('#24304a'));
    }, seat);
    m.ground = 0;
  }

  // 白板（右边远处）：带轮子的架子，板槽里几支马克笔
  m.at(2.55, -1.55, -0.42, () => {
    const W = 0.62;
    m.box(-W, W, 0.86, 1.78, -0.02, 0.02, col('#f5f6f6'), { front: uv.board });
    m.box(-W - 0.025, W + 0.025, 1.78, 1.81, -0.025, 0.025, alu);
    m.box(-W - 0.025, W + 0.025, 0.83, 0.86, -0.025, 0.025, alu);
    m.box(-W - 0.025, -W, 0.86, 1.78, -0.025, 0.025, alu);
    m.box(W, W + 0.025, 0.86, 1.78, -0.025, 0.025, alu);
    m.box(-W, W, 0.83, 0.85, 0.025, 0.08, alu);
    ['#2f55b8', '#c23a3a', '#222'].forEach((c, i) => m.box(-0.3 + i * 0.14, -0.18 + i * 0.14, 0.85, 0.865, 0.04, 0.06, col(c)));
    for (const s of [-1, 1]) {
      m.box(s * (W + 0.05) - 0.02, s * (W + 0.05) + 0.02, 0.06, 1.95, -0.02, 0.02, col('#9aa0a6'));
      m.box(s * (W + 0.05) - 0.03, s * (W + 0.05) + 0.03, 0.04, 0.07, -0.3, 0.3, col('#9aa0a6'));
      for (const z of [-0.28, 0.28]) m.box(s * (W + 0.05) - 0.025, s * (W + 0.05) + 0.025, 0, 0.045, z - 0.025, z + 0.025, col('#2a2a2a'));
    }
  });

  // 高的绿植（书柜左边）
  m.at(-1.82, back + 0.32, 0, () => {
    m.cyl(0, 0, 0.13, 0.17, 0, 0.32, 12, col('#b8653f'), { top: true, topColor: col('#4a3020') });
    const r = rng(17);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r();
      const lean = 0.15 + r() * 0.25;
      const h0 = 0.3;
      const h1 = 0.75 + r() * 0.55;
      const dx = Math.sin(a) * lean;
      const dz = Math.cos(a) * lean;
      const w = 0.07;
      const leaf = col(i % 2 ? '#4f8a4a' : '#3f7a44');
      m.sheet([-Math.cos(a) * w * 0.4, h0, Math.sin(a) * w * 0.4], [Math.cos(a) * w * 0.4, h0, -Math.sin(a) * w * 0.4], [dx + Math.cos(a) * w, h1, dz - Math.sin(a) * w], [dx - Math.cos(a) * w, h1, dz + Math.sin(a) * w], [leaf.clone().multiplyScalar(0.7), leaf.clone().multiplyScalar(0.7), leaf, leaf]);
    }
  });
}

// ---------- 比赛会场 ----------
// 大厅里搭一块矮台子，台面浅灰地毯描白边；对家背后一排围挡广告牌，写着大赛名、这一轮、这一桌；
// 一边是裁判席，一边是转播的摄像机。大厅远处暗下来，墙上挂着横幅

const MATCH = {
  stage: 1.65, // 台子半宽
  stageH: 0.12, // 台子多高（台面就是牌桌脚下的地面，大厅的地面低这么多）
  board: -2.05, // 围挡广告牌的位置
  boardW: 2.7,
  boardH: 1.0,
  hallBack: -4.8,
  hallSide: 5.2,
  floorF: 3.0,
};

function matchAtlas(a: Atlas, spec: VenueSpec): Record<string, UV> {
  const g = a.g;
  const out: Record<string, UV> = {};
  const title = spec.title ?? VENUE_TITLE;
  const round = spec.round ?? '';
  const table = spec.table ?? '';
  const navy = '#14284f';
  const accent = '#1fa3d6';
  const gold = '#e0a92a';
  // 围挡广告牌正面：5.4 米 × 1 米，2048 × 380 像素（约 380 像素一米）
  {
    const x = 0;
    const y = 40;
    const w = 2048;
    const h = 380;
    const pm = w / (MATCH.boardW * 2);
    const bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.75, '#e9f0f8');
    bg.addColorStop(1, '#dce6f2');
    g.fillStyle = bg;
    g.fillRect(x, y, w, h);
    // 底下一条深蓝带子，上面一道青色细线；顶上一道深蓝边
    const band = h * 0.2;
    g.fillStyle = navy;
    g.fillRect(x, y + h - band, w, band);
    g.fillStyle = accent;
    g.fillRect(x, y + h - band - 10, w, 6);
    g.fillStyle = navy;
    g.fillRect(x, y, w, 10);
    // 斜着的几道浅蓝色块（运动会场的样子）
    g.save();
    g.beginPath();
    g.rect(x, y + 10, w, h - band - 20);
    g.clip();
    g.fillStyle = 'rgba(31,163,214,0.08)';
    for (let i = 0; i < 9; i++) {
      const sx = x + i * 260 - 60;
      g.beginPath();
      g.moveTo(sx, y + h);
      g.lineTo(sx + 120, y + h);
      g.lineTo(sx + 260, y);
      g.lineTo(sx + 140, y);
      g.fill();
    }
    g.restore();
    // 板上的位置换成米：画面中间是 2.7 米
    const at = (m: number) => x + (m + MATCH.boardW) * pm;
    const textY = y + (h - band) * 0.55;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // 对家左边：大赛名
    g.fillStyle = navy;
    fitText(g, title, at(-0.82), textY, 0.86 * pm, 0.15 * pm, (px) => `900 ${px}px ${FONT_SANS}`);
    // 对家右边：这一轮、这一桌
    if (round || table) {
      g.fillStyle = navy;
      fitText(g, round || table, at(0.82), textY - (round && table ? 0.09 * pm : 0), 0.86 * pm, 0.13 * pm, (px) => `900 ${px}px ${FONT_SANS}`);
      if (round && table) {
        g.fillStyle = accent;
        fitText(g, table, at(0.82), textY + 0.11 * pm, 0.86 * pm, 0.09 * pm, (px) => `900 ${px}px ${FONT_SANS}`);
      }
    } else {
      emblem(g, at(0.82), textY, 0.22 * pm, navy, gold, '#ffffff');
    }
    // 对家正后面：徽章
    emblem(g, at(0), textY, 0.25 * pm, navy, gold, '#ffffff');
    // 两头（宽屏才看得到）：英文名和徽章
    for (const s of [-1, 1]) {
      emblem(g, at(s * 1.55), textY, 0.18 * pm, navy, gold, '#ffffff');
      g.fillStyle = navy;
      fitText(g, 'NATIONAL HIGH SCHOOL', at(s * 2.15), textY - 0.07 * pm, 0.95 * pm, 0.1 * pm, (px) => `700 ${px}px ${FONT_LATIN}`);
      g.fillStyle = accent;
      fitText(g, 'MAHJONG CHAMPIONSHIP', at(s * 2.15), textY + 0.07 * pm, 0.95 * pm, 0.1 * pm, (px) => `700 ${px}px ${FONT_LATIN}`);
    }
    // 底下的带子：一排小字（2.5D 只露出这一截）
    g.fillStyle = '#ffffff';
    const line = [title, round, table].filter(Boolean).join('  ·  ');
    g.font = `700 ${Math.round(band * 0.5)}px ${FONT_SANS}`;
    const step = g.measureText(line).width + band * 1.6;
    for (let sx = x + band; sx < x + w; sx += step) {
      g.textAlign = 'left';
      g.fillText(line, sx, y + h - band / 2);
      g.fillStyle = gold;
      g.beginPath();
      g.arc(sx + step - band * 0.8, y + h - band / 2, band * 0.12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
    }
    out.board = a.uv(x, y, w, h);
  }
  // 远处墙上的横幅：深蓝底白字
  {
    const x = 0;
    const y = 430;
    const w = 1400;
    const h = 380;
    g.fillStyle = navy;
    g.fillRect(x, y, w, h);
    g.fillStyle = accent;
    g.fillRect(x, y + h - 40, w, 12);
    emblem(g, x + 190, y + h / 2 - 10, 120, '#ffffff', gold, navy);
    g.fillStyle = '#ffffff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    fitText(g, title, x + 340, y + h / 2 - 60, w - 380, 120, (px) => `900 ${px}px ${FONT_SANS}`);
    g.fillStyle = '#bfe6f7';
    fitText(g, [round, table].filter(Boolean).join('  ·  ') || 'NATIONAL HIGH SCHOOL MAHJONG CHAMPIONSHIP', x + 344, y + h / 2 + 70, w - 380, 64, (px) => `700 ${px}px ${FONT_SANS}`);
    out.banner = a.uv(x, y, w, h);
  }
  // 裁判席的桌布正面（白布印徽章）和桌上的台卡
  {
    const x = 1420;
    const y = 430;
    const w = 600;
    const h = 300;
    g.fillStyle = '#f4f6f8';
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 12; i++) g.fillRect(x + i * 50 + 20, y, 8, h);
    emblem(g, x + w / 2, y + h * 0.45, 80, navy, gold, '#f4f6f8');
    g.fillStyle = navy;
    g.fillRect(x, y + h - 26, w, 26);
    out.cloth = a.uv(x, y, w, h);
  }
  {
    const x = 1420;
    const y = 740;
    const w = 300;
    const h = 120;
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, w, h);
    g.fillStyle = navy;
    g.fillRect(x, y, 16, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, '裁判席', x + w / 2 + 8, y + h / 2, w - 40, 76, (px) => `900 ${px}px ${FONT_SANS}`);
    out.placard = a.uv(x, y, w, h);
  }
  out.glow = glowSprite(a, 1740, 740);
  return out;
}

function matchFloor(size: number, spec: VenueSpec): HTMLCanvasElement {
  const F = MATCH.floorF;
  const [c, g] = canvas(size, size);
  const px = size / (2 * F);
  const X = (x: number) => (x + F) * px;
  const r = rng(9);
  // 大厅的地毯：深灰蓝，细细的菱形花纹
  g.fillStyle = '#2c3446';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(120,140,180,0.08)';
  g.lineWidth = 2;
  const step = 0.3 * px;
  for (let i = -size; i < size * 2; i += step) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + size, size);
    g.moveTo(i, size);
    g.lineTo(i + size, 0);
    g.stroke();
  }
  grain(g, 0, 0, size, size, 9000, 'rgba(0,0,0,0.12)', r, 2);
  // 台面：灰蓝的地毯（不能太浅：竖屏时手牌下面那一截全是它，提示字要看得清），离边 10 厘米一道白线，
  // 四角和桌子后面正中印着大赛的徽章，徽章底下一行大赛名（竖屏、2.5D 从桌子上沿看得到）
  const S = MATCH.stage;
  const carpet = '#4d586d';
  g.fillStyle = carpet;
  g.fillRect(X(-S), X(-S), 2 * S * px, 2 * S * px);
  grain(g, X(-S), X(-S), 2 * S * px, 2 * S * px, 6000, 'rgba(10,16,28,0.16)', r, 2);
  grain(g, X(-S), X(-S), 2 * S * px, 2 * S * px, 2500, 'rgba(255,255,255,0.04)', r, 2);
  g.strokeStyle = '#e6edf5';
  g.lineWidth = 0.05 * px;
  g.strokeRect(X(-S + 0.1), X(-S + 0.1), 2 * (S - 0.1) * px, 2 * (S - 0.1) * px);
  g.globalAlpha = 0.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) emblem(g, X(sx * (S - 0.36)), X(sz * (S - 0.36)), 0.2 * px, '#dfe6ee', '#e0a92a', carpet);
  g.globalAlpha = 0.6;
  emblem(g, X(0), X(-1.12), 0.2 * px, '#e6edf5', '#e0a92a', carpet);
  g.fillStyle = '#e6edf5';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, spec.title ?? VENUE_TITLE, X(0), X(-0.8), 1.0 * px, 0.11 * px, (fpx) => `900 ${fpx}px ${FONT_SANS}`);
  g.globalAlpha = 1;
  // 灯光打在台子上：中间亮，往外暗；桌子底下一块影子
  g.save();
  g.globalCompositeOperation = 'multiply';
  const vig = g.createRadialGradient(size / 2, size / 2, S * px * 0.6, size / 2, size / 2, F * px * 1.05);
  vig.addColorStop(0, 'rgba(255,255,255,1)');
  vig.addColorStop(1, 'rgba(70,80,100,1)');
  g.fillStyle = vig;
  g.fillRect(0, 0, size, size);
  softBlob(g, size / 2, size / 2, 0.95 * px, 0.95 * px, 'rgba(30,34,44,A)', 0.6);
  g.restore();
  // 转播摄像机的线：从左边的摄像机拖到画面外
  g.strokeStyle = 'rgba(10,12,16,0.8)';
  g.lineWidth = 0.02 * px;
  g.beginPath();
  g.moveTo(X(-2.05), X(-1.25));
  g.bezierCurveTo(X(-2.4), X(-0.6), X(-1.9), X(0.2), X(-2.9), X(1.2));
  g.stroke();
  return c;
}

function buildMatch(m: Mesher, glow: Mesher, uv: Record<string, UV>): void {
  const { stage: S, stageH: SH, board: BZ, boardW: BW, boardH: BH, hallBack, hallSide } = MATCH;
  const navy = col('#14284f');
  const dark = col('#1a2030');
  // 大厅的地面（地板贴图铺不到的远处）：和贴图边上一样的暗色
  m.ao = 0;
  const hall = col('#1d2433');
  const F = MATCH.floorF;
  m.quad([-hallSide, -SH, F], [hallSide, -SH, F], [hallSide, -SH, hallBack], [-hallSide, -SH, hallBack], hall);
  // 台子四边的立面
  m.ao = 0.3;
  m.ground = -SH;
  const side = col('#232a38');
  m.quad([-S, -SH, S], [S, -SH, S], [S, 0, S], [-S, 0, S], side);
  m.quad([S, -SH, -S], [-S, -SH, -S], [-S, 0, -S], [S, 0, -S], side);
  m.quad([S, -SH, S], [S, -SH, -S], [S, 0, -S], [S, 0, S], side);
  m.quad([-S, -SH, -S], [-S, -SH, S], [-S, 0, S], [-S, 0, -S], side);
  // 台子上沿一圈青白色的灯条
  const strip = col('#7fdcff').multiplyScalar(0.55);
  const e = 0.012;
  glow.quad([-S, -0.03, S + e], [S, -0.03, S + e], [S, -0.005, S + e], [-S, -0.005, S + e], strip, uv.glowWide);
  glow.quad([S, -0.03, -S - e], [-S, -0.03, -S - e], [-S, -0.005, -S - e], [S, -0.005, -S - e], strip, uv.glowWide);
  glow.quad([S + e, -0.03, S], [S + e, -0.03, -S], [S + e, -0.005, -S], [S + e, -0.005, S], strip, uv.glowWide);
  glow.quad([-S - e, -0.03, -S], [-S - e, -0.03, S], [-S - e, -0.005, S], [-S - e, -0.005, -S], strip, uv.glowWide);

  // 围挡广告牌：一长排在对家背后，略往后仰；两头各一块斜着朝里
  m.ground = -SH;
  const lean = 0.12;
  const board = (x0: number, x1: number, u: UV) => {
    const zb = BZ;
    const zt = BZ - BH * Math.sin(lean);
    const hb = 0.03 - SH;
    const ht = hb + BH * Math.cos(lean);
    m.lit = false;
    m.quad([x0, hb, zb], [x1, hb, zb], [x1, ht, zt], [x0, ht, zt], [col('#e8ecf2'), col('#e8ecf2'), col('#ffffff'), col('#ffffff')], u);
    m.lit = true;
    m.quad([x0, ht, zt], [x1, ht, zt], [x1, ht, zt - 0.06], [x0, ht, zt - 0.06], navy);
    m.quad([x1, hb, zb - 0.06], [x0, hb, zb - 0.06], [x0, ht, zt - 0.06], [x1, ht, zt - 0.06], dark);
    m.quad([x1, hb, zb], [x1, hb, zb - 0.06], [x1, ht, zt - 0.06], [x1, ht, zt], navy);
    m.quad([x0, hb, zb - 0.06], [x0, hb, zb], [x0, ht, zt], [x0, ht, zt - 0.06], navy);
    for (const fx of [x0 + 0.2, x1 - 0.2]) m.box(fx - 0.05, fx + 0.05, -SH, hb, zb - 0.35, zb + 0.02, dark);
  };
  board(-BW, BW, uv.board);
  // 两头的斜板用正面图的两端（徽章、英文）
  const endW = (uv.board[2] - uv.board[0]) * (1.1 / (2 * BW));
  for (const s of [-1, 1]) {
    m.at(s * (BW + 0.5), BZ + 0.75, -s * 0.85, () => {
      const u: UV = s < 0 ? [uv.board[0], uv.board[1], uv.board[0] + endW, uv.board[3]] : [uv.board[2] - endW, uv.board[1], uv.board[2], uv.board[3]];
      board(-0.55, 0.55, u);
    });
  }

  // 裁判席（右前）：白桌布的长桌，台卡，笔记本电脑，一把椅子
  m.ground = -SH;
  m.at(2.25, -1.05, -0.95, () => {
    const h = 0.74 - SH;
    m.lit = false;
    m.quad([-0.55, -SH, 0.27], [0.55, -SH, 0.27], [0.55, h, 0.27], [-0.55, h, 0.27], col('#ffffff'), uv.cloth);
    m.lit = true;
    m.box(-0.55, 0.55, h - 0.002, h, -0.27, 0.27, col('#f4f6f8'), { sides: false });
    m.quad([0.55, -SH, 0.27], [0.55, -SH, -0.27], [0.55, h, -0.27], [0.55, h, 0.27], col('#e6e9ee'));
    m.quad([-0.55, -SH, -0.27], [-0.55, -SH, 0.27], [-0.55, h, 0.27], [-0.55, h, -0.27], col('#e6e9ee'));
    m.ground = h;
    // 台卡（立着的 A 字）
    m.quad([-0.17, h, 0.2], [0.17, h, 0.2], [0.17, h + 0.12, 0.16], [-0.17, h + 0.12, 0.16], col('#ffffff'), uv.placard);
    // 笔记本电脑
    m.box(-0.45, -0.15, h, h + 0.015, -0.12, 0.08, col('#3a3f48'));
    m.lit = false;
    m.quad([-0.45, h + 0.015, -0.12], [-0.15, h + 0.015, -0.12], [-0.15, h + 0.2, -0.16], [-0.45, h + 0.2, -0.16], col('#2a2f38'));
    m.lit = true;
    m.ground = -SH;
    m.box(-0.2, 0.2, -SH, 0.45 - SH, -0.75, -0.4, col('#20242c'));
    m.box(-0.2, 0.2, 0.45 - SH, 0.95 - SH, -0.78, -0.72, col('#20242c'));
  });

  // 转播摄像机（左后）：三脚架、机身、镜头冲着牌桌，侧面的取景器，机身顶上一盏红灯（在录）
  {
    const cx = -2.05;
    const cz = -1.25;
    const face = Math.atan2(-cx, -cz);
    const top = 1.35;
    m.at(cx, cz, face, () => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.3;
        const fx = Math.sin(a) * 0.38;
        const fz = Math.cos(a) * 0.38;
        m.sheet([fx - 0.015, -SH, fz], [fx + 0.015, -SH, fz], [0.015, top - 0.3, 0], [-0.015, top - 0.3, 0], col('#2a2d33'));
      }
      m.box(-0.025, 0.025, top - 0.35, top - 0.05, -0.025, 0.025, col('#2a2d33'));
      m.extrude(rounded(-0.12, 0.12, top - 0.05, top + 0.2, 0.03), -0.32, 0.18, 'z', col('#3b3f47'));
      m.extrude(circle(0, top + 0.07, 0.075, 10), 0.18, 0.42, 'z', col('#1b1d22'));
      m.extrude(circle(0, top + 0.07, 0.092, 10), 0.4, 0.47, 'z', col('#121317'), { capColor: col('#2c3440') });
      m.box(0.12, 0.2, top + 0.06, top + 0.19, -0.27, -0.06, col('#2a2d33'), { back: true });
      m.box(-0.04, 0.04, top + 0.2, top + 0.23, 0.08, 0.14, col('#5a1414'));
      // 摇杆：从机身后面斜着往下伸
      m.at(-0.06, -0.32, -0.35, () => m.box(-0.012, 0.012, top - 0.06, top - 0.03, -0.42, 0, col('#2a2d33')));
    });
    glow.at(cx, cz, face, () => glow.quad([-0.07, top + 0.17, 0.11], [0.07, top + 0.17, 0.11], [0.07, top + 0.3, 0.11], [-0.07, top + 0.3, 0.11], col('#ff3030').multiplyScalar(0.8), uv.glow));
  }

  // 大厅远处：暗墙、挂着横幅；两边的墙
  m.ao = 0;
  const wallC = col('#151b28');
  m.quad([-hallSide, -SH, hallBack], [hallSide, -SH, hallBack], [hallSide, 4.5, hallBack], [-hallSide, 4.5, hallBack], [wallC.clone().multiplyScalar(0.8), wallC.clone().multiplyScalar(0.8), wallC, wallC]);
  for (const s of [-1, 1]) {
    const x = s * hallSide;
    const zs = s < 0 ? [F, hallBack] : [hallBack, F];
    m.quad([x, -SH, zs[0]], [x, -SH, zs[1]], [x, 4.5, zs[1]], [x, 4.5, zs[0]], wallC.clone().multiplyScalar(0.85));
  }
  m.lit = false;
  m.quad([-3.2, 1.9, hallBack + 0.02], [3.2, 1.9, hallBack + 0.02], [3.2, 3.64, hallBack + 0.02], [-3.2, 3.64, hallBack + 0.02], col('#ffffff'), uv.banner);
  m.lit = true;
}

// ---------- 决赛 ----------
// 牌桌摆在一座圆形的高台上（台面就是牌桌脚下的地面），四周落下去一米是场地，再往外一圈圈看台坐满了观众，
// 挥着荧光棒；看台前的围挡上一条 LED 字幕滚着「决赛」。台面是黑的，中间一片暖光，金色的圆圈和一圈字

const FINAL = {
  stage: 2.25, // 高台半径
  drop: 1.0, // 场地比台面低多少
  barrier: 3.45, // 看台前的围挡
  tier0: 3.6,
  tierD: 0.55,
  tierRise: 0.4,
  tiers: 6,
  arc: 1.95, // 看台从正后方往两边各铺多少弧度
  floorF: 2.3,
};

// ---------- 决赛的观众 ----------
// 观众是图集里画好的一个个小人（一格 128×208 像素，代表 0.52 米宽、0.845 米高，格子底边在看台地面往上 0.45 米），
// 坐在红椅子上看台子：校服、卫衣、应援的法被，各种发型；有的举荧光棒、挥手、鼓掌、举毛巾，偶尔两个人拉一条横幅。
// 一格贴一个四边形，抠图（alphaTest）不排序，整片看台一次画完

const FAN_W = 128;
const FAN_H = 208;
const FAN_M = 0.52; // 一格多宽（米）
const FAN_PX = FAN_W / FAN_M;
const FAN_TALL = FAN_H / FAN_PX;
const FAN_BASE = 0.45; // 格子底边离看台地面多高
const CROWD = { x: 1024, y: 290, cols: 8 }; // 在图集里的位置

type FanHair = 'bob' | 'long' | 'twin' | 'pony' | 'short' | 'bun' | 'side';
type FanTop = 'sailor' | 'blazer' | 'hoodie' | 'tee' | 'happi' | 'cardigan';
type FanArms = 'down' | 'stickL' | 'stickR' | 'both' | 'clap' | 'towel' | 'wave';
interface FanLook {
  skin: string;
  hair: string;
  style: FanHair;
  top: FanTop;
  main: string;
  accent: string;
  arms: FanArms;
  sticks?: string[];
  mouth?: 'open' | 'smile';
}

const SKIN = ['#f3d6bf', '#efcaae', '#e8bf9f', '#f6dfcf'];
const FANS: FanLook[] = [
  { skin: SKIN[0], hair: '#231c22', style: 'long', top: 'sailor', main: '#1f2a48', accent: '#c8363c', arms: 'stickR', sticks: ['#ffcf4a'] },
  { skin: SKIN[1], hair: '#5e3f2e', style: 'bob', top: 'blazer', main: '#28324f', accent: '#c8363c', arms: 'clap', mouth: 'smile' },
  { skin: SKIN[2], hair: '#3a2a24', style: 'short', top: 'hoodie', main: '#8d8a86', accent: '#5a5856', arms: 'down' },
  { skin: SKIN[3], hair: '#231c22', style: 'twin', top: 'happi', main: '#c8303a', accent: '#f4efe6', arms: 'both', sticks: ['#ff3b5c', '#ffffff'], mouth: 'open' },
  { skin: SKIN[0], hair: '#7a4f35', style: 'pony', top: 'sailor', main: '#eeeef0', accent: '#1d2742', arms: 'stickL', sticks: ['#ff7ad1'] },
  { skin: SKIN[2], hair: '#231c22', style: 'short', top: 'blazer', main: '#4a4c55', accent: '#3a5aa8', arms: 'down' },
  { skin: SKIN[1], hair: '#c9a25e', style: 'side', top: 'tee', main: '#7fa6c9', accent: '#f0c64a', arms: 'towel', mouth: 'open' },
  { skin: SKIN[3], hair: '#3a2a24', style: 'long', top: 'cardigan', main: '#cbb795', accent: '#c8363c', arms: 'clap' },
  { skin: SKIN[0], hair: '#231c22', style: 'bob', top: 'sailor', main: '#1f2a48', accent: '#2f8f5a', arms: 'stickR', sticks: ['#5ad1ff'] },
  { skin: SKIN[2], hair: '#5e3f2e', style: 'short', top: 'happi', main: '#2f62c4', accent: '#f0c64a', arms: 'wave', mouth: 'open' },
  { skin: SKIN[1], hair: '#c27a92', style: 'twin', top: 'blazer', main: '#5a4535', accent: '#2f8f5a', arms: 'stickL', sticks: ['#ffcf4a'] },
  { skin: SKIN[3], hair: '#231c22', style: 'bun', top: 'hoodie', main: '#2b3550', accent: '#1d2438', arms: 'down', mouth: 'smile' },
  { skin: SKIN[0], hair: '#5e3f2e', style: 'bob', top: 'tee', main: '#b8434a', accent: '#f4efe6', arms: 'stickR', sticks: ['#ffffff'] },
  { skin: SKIN[1], hair: '#8a72b0', style: 'long', top: 'sailor', main: '#22202a', accent: '#c8363c', arms: 'down', mouth: 'open' },
  { skin: SKIN[2], hair: '#7a4f35', style: 'short', top: 'blazer', main: '#28324f', accent: '#b8303a', arms: 'clap', mouth: 'smile' },
  { skin: SKIN[3], hair: '#231c22', style: 'pony', top: 'happi', main: '#e0a92a', accent: '#1f1a1a', arms: 'both', sticks: ['#ffcf4a', '#ffcf4a'], mouth: 'open' },
  { skin: SKIN[0], hair: '#c9a25e', style: 'long', top: 'cardigan', main: '#8f939c', accent: '#c8363c', arms: 'stickL', sticks: ['#ff3b5c'] },
  { skin: SKIN[2], hair: '#3a2a24', style: 'short', top: 'tee', main: '#e6e2da', accent: '#3a5aa8', arms: 'down' },
  { skin: SKIN[1], hair: '#3c4a78', style: 'twin', top: 'sailor', main: '#1f2a48', accent: '#c8363c', arms: 'towel', mouth: 'smile' },
  { skin: SKIN[3], hair: '#5e3f2e', style: 'long', top: 'blazer', main: '#2f4a3a', accent: '#c8363c', arms: 'stickR', sticks: ['#ff7ad1'] },
  { skin: SKIN[0], hair: '#231c22', style: 'bob', top: 'hoodie', main: '#d98f9c', accent: '#b86a78', arms: 'wave', mouth: 'open' },
];
const FAN_EMPTY = FANS.length; // 空座位
const FAN_BANNER = 22; // 横幅占两格：22、23
const BANNER_PAIR: [FanLook, FanLook] = [
  { skin: SKIN[1], hair: '#231c22', style: 'pony', top: 'happi', main: '#c8303a', accent: '#f4efe6', arms: 'down', mouth: 'open' },
  { skin: SKIN[0], hair: '#5e3f2e', style: 'bob', top: 'happi', main: '#c8303a', accent: '#f4efe6', arms: 'down', mouth: 'open' },
];

// 举着的荧光棒在格子里的位置（离格子中线多少、离格子底边多高，米）
function fanSticks(L: FanLook): { x: number; y: number; c: Rgb }[] {
  const sides = L.arms === 'stickL' ? [-1] : L.arms === 'stickR' ? [1] : L.arms === 'both' ? [-1, 1] : [];
  return sides.map((s, i) => ({ x: (s * 48) / FAN_PX, y: (FAN_H - 17) / FAN_PX, c: col(L.sticks?.[i] ?? '#ffcf4a') }));
}

const tone = (hex: string, k: number) => `#${col(hex).multiplyScalar(k).getHexString()}`;

// 画一个坐着的人：cx 是这人在格子里的中线（像素）
function drawFan(g: CanvasRenderingContext2D, L: FanLook, cx: number): void {
  const X = (d: number) => cx + d;
  const ink = 'rgba(22,14,20,0.9)';
  const path = (fill: string, line = 1.8) => {
    g.fillStyle = fill;
    g.fill();
    if (line > 0) {
      g.strokeStyle = ink;
      g.lineWidth = line;
      g.stroke();
    }
  };
  const lightTop = L.top === 'sailor' && L.main === '#eeeef0';
  const sleeve = L.main;
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // 红椅子的椅背（肩膀两边露出来）
  rr(g, X(-56), 101, 112, 130, 16);
  path('#4c1a24', 1.5);
  rr(g, X(-47), 110, 94, 120, 10);
  path('#5e2330', 0);
  g.fillStyle = 'rgba(255,190,170,0.16)';
  g.fillRect(X(-44), 103, 88, 4);

  // 披下来的头发（在身子后面）
  if (L.style === 'long' || L.style === 'bob') {
    const bottom = L.style === 'long' ? 130 : 90;
    g.beginPath();
    g.moveTo(X(-25), 48);
    g.bezierCurveTo(X(-31), 74, X(-31), bottom - 12, X(-24), bottom);
    g.lineTo(X(24), bottom);
    g.bezierCurveTo(X(31), bottom - 12, X(31), 74, X(25), 48);
    g.closePath();
    path(tone(L.hair, 0.8));
  }
  // 脖子
  g.beginPath();
  g.rect(X(-7), 80, 14, 22);
  path(L.skin, 1.4);
  g.fillStyle = 'rgba(150,80,70,0.3)';
  g.fillRect(X(-6), 81, 12, 7);

  // 身子：肩膀圆一点，两条胳膊垂着
  g.beginPath();
  g.moveTo(X(-11), 97);
  g.quadraticCurveTo(X(-34), 99, X(-44), 115);
  g.lineTo(X(-49), 212);
  g.lineTo(X(49), 212);
  g.lineTo(X(44), 115);
  g.quadraticCurveTo(X(34), 99, X(11), 97);
  g.closePath();
  path(L.main);
  if (L.arms === 'down' || L.arms === 'wave' || L.arms === 'stickL' || L.arms === 'stickR') {
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (const s of [-1, 1]) {
      if ((L.arms === 'stickL' && s < 0) || (L.arms === 'stickR' && s > 0) || (L.arms === 'wave' && s > 0)) continue;
      g.beginPath();
      g.moveTo(X(s * 33), 126);
      g.lineTo(X(s * 35), 212);
      g.stroke();
    }
  }
  // 衣服的样子
  if (L.top === 'sailor') {
    const collar = lightTop ? L.accent : tone(L.main, 0.85);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(X(s * 11), 97);
      g.lineTo(X(0), 134);
      g.lineTo(X(s * 7), 137);
      g.lineTo(X(s * 40), 118);
      g.lineTo(X(s * 32), 102);
      g.closePath();
      path(collar, 1.4);
      g.strokeStyle = '#f2f2f4';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(X(s * 15), 99);
      g.lineTo(X(s * 4), 128);
      g.moveTo(X(s * 34), 112);
      g.lineTo(X(s * 8), 131);
      g.stroke();
    }
    // 领巾
    g.beginPath();
    g.moveTo(X(-9), 128);
    g.lineTo(X(9), 128);
    g.lineTo(X(3), 138);
    g.lineTo(X(-3), 138);
    g.closePath();
    path(lightTop ? '#c8363c' : L.accent, 1.2);
    g.beginPath();
    g.moveTo(X(-3), 137);
    g.lineTo(X(-7), 158);
    g.lineTo(X(0), 150);
    g.lineTo(X(7), 158);
    g.lineTo(X(3), 137);
    g.closePath();
    path(lightTop ? '#c8363c' : L.accent, 1.2);
  } else if (L.top === 'blazer' || L.top === 'cardigan') {
    g.beginPath();
    g.moveTo(X(-11), 97);
    g.lineTo(X(0), L.top === 'blazer' ? 146 : 136);
    g.lineTo(X(11), 97);
    g.closePath();
    path('#f1f1f3', 1.2);
    if (L.top === 'blazer') {
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(X(-13), 99);
      g.lineTo(X(-5), 146);
      g.moveTo(X(13), 99);
      g.lineTo(X(5), 146);
      g.stroke();
    } else {
      g.fillStyle = tone(L.main, 0.6);
      for (const y of [146, 166, 186]) {
        g.beginPath();
        g.arc(X(2), y, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 领结
    g.beginPath();
    g.moveTo(X(0), 104);
    g.lineTo(X(-8), 99);
    g.lineTo(X(-8), 110);
    g.closePath();
    g.moveTo(X(0), 104);
    g.lineTo(X(8), 99);
    g.lineTo(X(8), 110);
    g.closePath();
    path(L.accent, 1.1);
  } else if (L.top === 'hoodie') {
    g.beginPath();
    g.moveTo(X(-22), 99);
    g.quadraticCurveTo(X(0), 124, X(22), 99);
    g.quadraticCurveTo(X(0), 110, X(-22), 99);
    path(L.accent, 1.4);
    g.strokeStyle = '#eeeeee';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(X(-5), 110);
    g.lineTo(X(-6), 134);
    g.moveTo(X(5), 110);
    g.lineTo(X(6), 134);
    g.stroke();
    rr(g, X(-24), 176, 48, 40, 8);
    path(tone(L.main, 0.85), 1.2);
  } else if (L.top === 'tee') {
    g.beginPath();
    g.moveTo(X(-11), 97);
    g.quadraticCurveTo(X(0), 110, X(11), 97);
    g.strokeStyle = tone(L.main, 0.6);
    g.lineWidth = 3;
    g.stroke();
    // 胸口一颗星
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? 4.5 : 11;
      g.lineTo(X(Math.cos(a) * rad), 150 + Math.sin(a) * rad);
    }
    g.closePath();
    path(L.accent, 0);
  } else if (L.top === 'happi') {
    g.beginPath();
    g.moveTo(X(-9), 97);
    g.lineTo(X(0), 150);
    g.lineTo(X(9), 97);
    g.closePath();
    path('#2a2428', 0);
    g.strokeStyle = L.accent;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(X(-12), 98);
    g.lineTo(X(-4), 212);
    g.moveTo(X(12), 98);
    g.lineTo(X(4), 212);
    g.stroke();
    // 背后印的字在前襟上露一个
    g.fillStyle = L.accent;
    g.font = `900 15px ${FONT_SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('应', X(-25), 160);
    g.fillText('援', X(25), 160);
  }

  // 双马尾、单边马尾（挂在肩膀两边）
  const tail = (s: number, len: number) => {
    g.beginPath();
    g.moveTo(X(s * 19), 40);
    g.bezierCurveTo(X(s * 41), 44, X(s * 46), 90, X(s * 37), len);
    g.bezierCurveTo(X(s * 31), len - 22, X(s * 25), 82, X(s * 17), 56);
    g.closePath();
    path(L.hair);
    g.beginPath();
    g.arc(X(s * 23), 43, 3.6, 0, Math.PI * 2);
    path(L.accent === '#f4efe6' ? '#c8363c' : L.accent, 1);
  };
  if (L.style === 'twin') for (const s of [-1, 1]) tail(s, 126);
  if (L.style === 'side') tail(-1, 134);

  // 举起来的胳膊：荧光棒、挥手
  const raise = (s: number, stick?: string, open = false) => {
    g.beginPath();
    g.moveTo(X(s * 39), 116);
    g.quadraticCurveTo(X(s * 55), 82, X(s * 47), 36);
    g.strokeStyle = ink;
    g.lineWidth = 15;
    g.stroke();
    g.strokeStyle = sleeve;
    g.lineWidth = 12;
    g.stroke();
    if (stick) {
      g.beginPath();
      g.moveTo(X(s * 47), 34);
      g.lineTo(X(s * 48), 3);
      g.strokeStyle = ink;
      g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = stick;
      g.lineWidth = 5.5;
      g.stroke();
    }
    g.beginPath();
    if (open) g.ellipse(X(s * 47), 30, 7, 9, 0, 0, Math.PI * 2);
    else g.arc(X(s * 47), 33, 6.5, 0, Math.PI * 2);
    path(L.skin, 1.5);
    if (open) {
      g.strokeStyle = 'rgba(120,60,50,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      for (const d of [-3, 0, 3]) {
        g.moveTo(X(s * 47 + d), 22);
        g.lineTo(X(s * 47 + d), 28);
      }
      g.stroke();
    }
  };
  if (L.arms === 'stickL') raise(-1, L.sticks?.[0]);
  if (L.arms === 'stickR') raise(1, L.sticks?.[0]);
  if (L.arms === 'both') {
    raise(-1, L.sticks?.[0]);
    raise(1, L.sticks?.[1]);
  }
  if (L.arms === 'wave') raise(1, undefined, true);

  // 头：脸、丸子、马尾尖、刘海
  if (L.style === 'bun') {
    g.beginPath();
    g.arc(X(0), 25, 9.5, 0, Math.PI * 2);
    path(L.hair);
  }
  if (L.style === 'pony') {
    g.beginPath();
    g.ellipse(X(21), 33, 7, 11, 0.6, 0, Math.PI * 2);
    path(L.hair);
  }
  g.beginPath();
  g.moveTo(X(-19), 58);
  g.bezierCurveTo(X(-19), 74, X(-9), 86, X(0), 87);
  g.bezierCurveTo(X(9), 86, X(19), 74, X(19), 58);
  g.bezierCurveTo(X(19), 38, X(-19), 38, X(-19), 58);
  g.closePath();
  path(L.skin, 1.6);
  const side = L.style === 'short' ? 64 : 76;
  g.beginPath();
  g.moveTo(X(-23), side);
  g.bezierCurveTo(X(-29), 40, X(-16), 27, X(0), 27);
  g.bezierCurveTo(X(16), 27, X(29), 40, X(23), side);
  g.lineTo(X(19), 62);
  for (const [bx, by] of [
    [17, 52],
    [12, 58],
    [8, 47],
    [3, 57],
    [-3, 46],
    [-8, 57],
    [-12, 48],
    [-17, 58],
    [-19, 62],
  ])
    g.lineTo(X(bx), by);
  g.closePath();
  path(L.hair);
  // 头发上一道亮（天使环）
  g.strokeStyle = tone(L.hair, 2.2);
  g.globalAlpha = 0.55;
  g.lineWidth = 2.6;
  g.beginPath();
  g.ellipse(X(0), 41, 15, 6, 0, Math.PI * 1.08, Math.PI * 1.92);
  g.stroke();
  g.globalAlpha = 1;
  // 眼睛、嘴、脸红
  const iris = L.hair === '#231c22' || L.hair === '#3a2a24' ? '#5a3a30' : tone(L.hair, 0.7);
  for (const s of [-1, 1]) {
    const ex = X(s * 8);
    g.beginPath();
    g.ellipse(ex, 67.5, 3.5, 4.6, 0, 0, Math.PI * 2);
    path(iris, 0);
    g.beginPath();
    g.ellipse(ex, 68.6, 2, 2.6, 0, 0, Math.PI * 2);
    path('#1a1018', 0);
    // 上眼线：弯的，眼尾翘一点
    g.beginPath();
    g.moveTo(ex - s * 4.4, 64.4);
    g.quadraticCurveTo(ex, 61.2, ex + s * 5, 63.2);
    g.strokeStyle = '#1a1018';
    g.lineWidth = 1.8;
    g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(ex - 1.2, 65.8, 1.3, 0, Math.PI * 2);
    g.fill();
  }
  if (L.mouth === 'open') {
    g.beginPath();
    g.ellipse(X(0), 79.5, 2.8, 2.4, 0, 0, Math.PI * 2);
    path('#8a2f38', 0);
  } else if (L.mouth === 'smile') {
    g.beginPath();
    g.arc(X(0), 76.5, 3, 0.2 * Math.PI, 0.8 * Math.PI);
    g.strokeStyle = '#7a3a3a';
    g.lineWidth = 1.3;
    g.stroke();
  } else {
    g.fillStyle = '#9a5050';
    g.fillRect(X(-2), 78.6, 4, 1.2);
  }
  g.fillStyle = 'rgba(240,120,120,0.3)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(X(s * 11), 73.5, 3.6, 1.8, 0, 0, Math.PI * 2);
    g.fill();
  }

  // 胳膊在胸前：鼓掌、举毛巾
  if (L.arms === 'clap') {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(X(s * 41), 132);
      g.quadraticCurveTo(X(s * 32), 160, X(s * 8), 150);
      g.strokeStyle = ink;
      g.lineWidth = 14;
      g.stroke();
      g.strokeStyle = sleeve;
      g.lineWidth = 11;
      g.stroke();
    }
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(X(s * 4), 145, 5, 7.5, s * 0.25, 0, Math.PI * 2);
      path(L.skin, 1.3);
    }
  }
  if (L.arms === 'towel') {
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(X(s * 42), 130);
      g.lineTo(X(s * 34), 148);
      g.strokeStyle = ink;
      g.lineWidth = 14;
      g.stroke();
      g.strokeStyle = sleeve;
      g.lineWidth = 11;
      g.stroke();
    }
    rr(g, X(-42), 138, 84, 30, 3);
    path(L.top === 'sailor' ? '#f0c64a' : L.accent, 1.5);
    g.fillStyle = '#c8363c';
    g.font = `900 20px ${FONT_SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('必胜', X(0), 154);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(X(s * 36), 142, 6, 0, Math.PI * 2);
      path(L.skin, 1.3);
    }
  }
}

// 图集里画一整张观众：21 个人、一张空椅子、一条两个人拉着的横幅
function crowdSheet(a: Atlas): Record<string, UV> {
  const g = a.g;
  const out: Record<string, UV> = {};
  const cell = (i: number, n = 1) => {
    const x = CROWD.x + (i % CROWD.cols) * FAN_W;
    const y = CROWD.y + Math.floor(i / CROWD.cols) * FAN_H;
    g.clearRect(x, y, FAN_W * n, FAN_H);
    g.save();
    g.beginPath();
    g.rect(x, y, FAN_W * n, FAN_H);
    g.clip();
    g.translate(x, y);
    return () => {
      g.restore();
      return a.uv(x, y, FAN_W * n, FAN_H, 1);
    };
  };
  FANS.forEach((L, i) => {
    const done = cell(i);
    drawFan(g, L, FAN_W / 2);
    out[`fan${i}`] = done();
  });
  {
    // 空座位：只有椅子，座位号的小牌子
    const done = cell(FAN_EMPTY);
    rr(g, 8, 101, 112, 130, 16);
    g.fillStyle = '#4c1a24';
    g.fill();
    g.strokeStyle = 'rgba(22,14,20,0.9)';
    g.lineWidth = 1.5;
    g.stroke();
    rr(g, 17, 110, 94, 120, 10);
    g.fillStyle = '#5e2330';
    g.fill();
    g.fillStyle = 'rgba(255,190,170,0.16)';
    g.fillRect(20, 103, 88, 4);
    g.fillStyle = '#c9a04a';
    g.fillRect(56, 116, 16, 8);
    out.fanEmpty = done();
  }
  {
    const done = cell(FAN_BANNER, 2);
    drawFan(g, BANNER_PAIR[0], FAN_W / 2);
    drawFan(g, BANNER_PAIR[1], FAN_W * 1.5);
    // 横幅：白布红字，两头攥在手里
    rr(g, 18, 122, FAN_W * 2 - 36, 52, 4);
    g.fillStyle = '#f4f0e8';
    g.fill();
    g.strokeStyle = 'rgba(22,14,20,0.9)';
    g.lineWidth = 1.8;
    g.stroke();
    g.fillStyle = '#c8303a';
    g.fillRect(18, 122, FAN_W * 2 - 36, 6);
    g.fillRect(18, 168, FAN_W * 2 - 36, 6);
    g.font = `900 34px ${FONT_SANS}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('加油！', FAN_W, 150);
    for (const x of [26, FAN_W * 2 - 26, FAN_W - 40, FAN_W + 40]) {
      g.beginPath();
      g.arc(x, 128, 6.5, 0, Math.PI * 2);
      g.fillStyle = SKIN[0];
      g.fill();
      g.strokeStyle = 'rgba(22,14,20,0.9)';
      g.lineWidth = 1.3;
      g.stroke();
    }
    out.fanBanner = done();
  }
  return out;
}

function finalAtlas(a: Atlas, spec: VenueSpec): Record<string, UV> {
  const g = a.g;
  const out: Record<string, UV> = {};
  const title = spec.title ?? VENUE_TITLE;
  const gold = '#f0c25a';
  // 台面一圈字：黑底金字
  {
    const x = 0;
    const y = 40;
    const w = 2048;
    const h = 96;
    g.fillStyle = '#0b0a0d';
    g.fillRect(x, y, w, h);
    g.fillStyle = gold;
    g.fillRect(x, y + 6, w, 4);
    g.fillRect(x, y + h - 10, w, 4);
    const line = `${title}  ★  决赛  ★  GRAND FINAL  ★  `;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `900 ${h * 0.5}px ${FONT_SANS}`;
    const step = g.measureText(line).width;
    // 一圈正好放整数遍，接缝对得上
    const reps = Math.max(1, Math.round(w / step));
    const k = w / (step * reps);
    g.save();
    g.translate(x, y + h / 2);
    g.scale(k, 1);
    for (let i = 0; i < reps; i++) g.fillText(line, i * step, 2);
    g.restore();
    out.ring = a.uv(x, y, w, h, 0);
  }
  // 看台后面高处的大屏幕：深红底，大大的「决赛」
  {
    const x = 0;
    const y = 150;
    const w = 1024;
    const h = 480;
    const bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, '#3a0610');
    bg.addColorStop(1, '#12030a');
    g.fillStyle = bg;
    g.fillRect(x, y, w, h);
    g.fillStyle = gold;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, '决赛', x + w / 2, y + h * 0.45, w * 0.8, 260, (px) => `900 ${px}px ${FONT_SANS}`);
    g.fillStyle = '#ffffff';
    fitText(g, [title, spec.round, spec.table].filter(Boolean).join('  ·  '), x + w / 2, y + h * 0.82, w * 0.9, 52, (px) => `700 ${px}px ${FONT_SANS}`);
    // LED 的格子
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < w; i += 6) g.fillRect(x + i, y, 2, h);
    for (let j = 0; j < h; j += 6) g.fillRect(x, y + j, w, 2);
    out.screen = a.uv(x, y, w, h);
  }
  out.glow = glowSprite(a, 1040, 150);
  return { ...out, ...crowdSheet(a) };
}

// 围挡上滚动的 LED 字幕（单独一张图，横着循环）
function ribbonCanvas(spec: VenueSpec): HTMLCanvasElement {
  const [c, g] = canvas(2048, 128);
  const bg = g.createLinearGradient(0, 0, 0, 128);
  bg.addColorStop(0, '#5a0a16');
  bg.addColorStop(0.5, '#8c1022');
  bg.addColorStop(1, '#5a0a16');
  g.fillStyle = bg;
  g.fillRect(0, 0, 2048, 128);
  const title = spec.title ?? VENUE_TITLE;
  const parts = ['决赛', 'FINAL', title, spec.round ?? '', spec.table ?? ''].filter(Boolean);
  const line = parts.join('   ★   ') + '   ★   ';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `900 64px ${FONT_SANS}`;
  const step = g.measureText(line).width;
  const reps = Math.max(1, Math.round(2048 / step));
  const k = 2048 / (step * reps);
  g.save();
  g.scale(k, 1);
  for (let i = 0; i < reps; i++) {
    let px = i * step;
    parts.forEach((p, j) => {
      g.fillStyle = j === 0 || j === 1 ? '#ffd76a' : '#ffffff';
      g.fillText(p, px, 66);
      px += g.measureText(p).width;
      g.fillStyle = '#ffd76a';
      g.fillText('   ★   ', px, 66);
      px += g.measureText('   ★   ').width;
    });
  }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.4)';
  for (let i = 0; i < 2048; i += 5) g.fillRect(i, 0, 1.5, 128);
  for (let j = 0; j < 128; j += 5) g.fillRect(0, j, 2048, 1.5);
  return c;
}

function finalFloor(size: number): HTMLCanvasElement {
  const F = FINAL.floorF;
  const [c, g] = canvas(size, size);
  const px = size / (2 * F);
  const cx = size / 2;
  const r = rng(13);
  // 黑色的台面，正中一大片暖光（灯打下来），往外越来越黑
  g.fillStyle = '#0a090c';
  g.fillRect(0, 0, size, size);
  const pool = g.createRadialGradient(cx, cx, 0, cx, cx, 2.1 * px);
  pool.addColorStop(0, 'rgba(120,84,46,0.95)');
  pool.addColorStop(0.45, 'rgba(70,46,26,0.7)');
  pool.addColorStop(1, 'rgba(10,9,12,0)');
  g.fillStyle = pool;
  g.fillRect(0, 0, size, size);
  grain(g, 0, 0, size, size, 2500, 'rgba(255,220,150,0.06)', r, 1.5);
  const ring = (rad: number, wpx: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = wpx;
    g.beginPath();
    g.arc(cx, cx, rad * px, 0, Math.PI * 2);
    g.stroke();
  };
  ring(1.1, 0.012 * px, '#c9973a');
  ring(1.16, 0.03 * px, '#e5b551');
  ring(1.5, 0.012 * px, '#c9973a');
  ring(1.82, 0.012 * px, '#c9973a');
  ring(2.2, 0.04 * px, '#e5b551');
  // 八个方向的金色刻度，正前后左右长一点
  g.strokeStyle = '#d9a947';
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const long = i % 4 === 0;
    g.lineWidth = (long ? 0.02 : 0.01) * px;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 1.18 * px, cx + Math.sin(a) * 1.18 * px);
    g.lineTo(cx + Math.cos(a) * (long ? 1.48 : 1.36) * px, cx + Math.sin(a) * (long ? 1.48 : 1.36) * px);
    g.stroke();
  }
  g.save();
  g.globalCompositeOperation = 'multiply';
  softBlob(g, cx, cx, 0.95 * px, 0.95 * px, 'rgba(10,8,8,A)', 0.7);
  g.restore();
  return c;
}

function buildFinal(m: Mesher, glow: Mesher, uv: Record<string, UV>, ribbon: Mesher, crowd: Mesher): void {
  const { stage: R, drop, barrier: B, tier0, tierD, tierRise, tiers, arc } = FINAL;
  const seg = 72;
  m.ao = 0;
  // 台子立面（站在场地上才看得到；从台上看出去是台沿，下面黑）
  m.cyl(0, 0, R, R, -drop, 0, seg, [col('#0c0b0f'), col('#1a1418')]);
  // 场地的地面：贴着台子那一圈被灯带照亮一点
  m.ring(0, 0, R, B, -drop, seg, [col('#2a1c14'), col('#0b0a0d')]);
  // 台面的一圈字（金字）
  m.lit = false;
  m.ring(0, 0, 1.56, 1.74, 0.002, 96, col('#ffffff'), { uv: uv.ring, turns: 2 });
  // 看台前的围挡：朝着台子，上沿是 LED 字幕（另一个网格）
  m.cyl(0, 0, B, B, -drop, -0.12, seg, [col('#08070a'), col('#141116')], { inward: true, a0: Math.PI - arc - 0.2, a1: Math.PI + arc + 0.2 });
  ribbon.lit = false;
  ribbon.ao = 0;
  ribbon.cyl(0, 0, B - 0.01, B - 0.01, -0.5, -0.2, seg, col('#ffffff'), { inward: true, a0: Math.PI - arc - 0.2, a1: Math.PI + arc + 0.2, uv: [0, 0, 3, 1] });
  m.lit = true;
  m.ring(0, 0, B - 0.05, B + 0.05, -0.12, seg, col('#1d181e'), { a0: Math.PI - arc - 0.2, a1: Math.PI + arc + 0.2 });
  // 看台：一级级台阶，竖面朝着台子
  const stepC = col('#16121a');
  const riserC = col('#100d13');
  const a0 = Math.PI - arc;
  const a1 = Math.PI + arc;
  for (let k = 0; k < tiers; k++) {
    const r0 = tier0 + k * tierD;
    const r1 = r0 + tierD;
    const h = -drop + 0.3 + k * tierRise;
    const below = k === 0 ? -drop : h - tierRise;
    m.cyl(0, 0, r0, r0, below, h, seg, [riserC, riserC.clone().multiplyScalar(1.3)], { inward: true, a0, a1 });
    m.ring(0, 0, r0, r1, h, seg, stepC, { a0, a1 });
  }
  // 看台最后面一道墙，高处挂大屏幕
  const backR = tier0 + tiers * tierD;
  m.cyl(0, 0, backR, backR, -drop + 0.3 + (tiers - 1) * tierRise, 4.6, seg, [col('#0d0b10'), col('#060509')], { inward: true, a0, a1 });
  m.lit = false;
  m.at(0, -(backR - 0.1), 0, () => m.quad([-3.2, 2.5, 0], [3.2, 2.5, 0], [3.2, 4.4, 0], [-3.2, 4.4, 0], col('#ffffff'), uv.screen));
  m.lit = true;

  // 观众：一格一个画好的人，朝着台子；越往后排越暗（光从台子上来），一部分人的荧光棒叠一层发光
  const r = rng(29);
  crowd.lit = false;
  crowd.ao = 0;
  // 前排被台上的暖光照着，往后越来越暗、越来越冷（跟台上的人物拉开，不抢眼）
  const warm = col('#ffe6cc');
  const cool = col('#8f9cd8');
  const seat = (x: number, z: number, face: number, h: number, w: number, u: UV, tint: Rgb, flip: boolean) =>
    crowd.at(x, z, face, () =>
      crowd.quad([-w / 2, h + FAN_BASE, 0], [w / 2, h + FAN_BASE, 0], [w / 2, h + FAN_BASE + FAN_TALL, 0], [-w / 2, h + FAN_BASE + FAN_TALL, 0], tint, flip ? [u[2], u[1], u[0], u[3]] : u),
    );
  for (let k = 0; k < tiers; k++) {
    const rad = tier0 + k * tierD + tierD * 0.42;
    const h = -drop + 0.3 + k * tierRise;
    const n = Math.floor(((a1 - a0) * rad) / FAN_M);
    const at = (i: number) => a0 + ((i + 0.5) / n) * (a1 - a0);
    // 过道：每隔一段空出来
    const aisle = (a: number) => {
      const f = Math.abs(((a - Math.PI) / 0.55) % 1);
      return f < 0.07 || f > 0.93;
    };
    for (let i = 0; i < n; i++) {
      const a = at(i);
      if (aisle(a)) continue;
      const shade = warm.clone().lerp(cool, k / (tiers - 1)).multiplyScalar((0.36 - k * 0.045) * (0.86 + r() * 0.22));
      // 偶尔两个人拉一条横幅（占两个座位）
      if (r() < 0.03 && i + 1 < n && !aisle(at(i + 1))) {
        const am = (a + at(i + 1)) / 2;
        seat(Math.sin(am) * rad, Math.cos(am) * rad, am + Math.PI, h, FAN_M * 2, uv.fanBanner, shade, false);
        i++;
        continue;
      }
      const x = Math.sin(a) * rad;
      const z = Math.cos(a) * rad;
      const face = a + Math.PI;
      if (r() < 0.07) {
        seat(x, z, face, h, FAN_M, uv.fanEmpty, shade, false);
        continue;
      }
      const pick = Math.floor(r() * FANS.length);
      // 身上有字的（毛巾、法被）不左右翻，翻了字就反了
      const flip = r() < 0.5 && FANS[pick].arms !== 'towel' && FANS[pick].top !== 'happi';
      seat(x, z, face, h, FAN_M, uv[`fan${pick}`], shade, flip);
      for (const st of fanSticks(FANS[pick])) {
        const gx = flip ? -st.x : st.x;
        const gy = h + FAN_BASE + st.y;
        glow.at(x, z, face, () => {
          glow.quad([gx - 0.028, gy - 0.07, 0.02], [gx + 0.028, gy - 0.07, 0.02], [gx + 0.028, gy + 0.09, 0.02], [gx - 0.028, gy + 0.09, 0.02], st.c, uv.glow);
          glow.quad([gx - 0.13, gy - 0.12, 0.025], [gx + 0.13, gy - 0.12, 0.025], [gx + 0.13, gy + 0.14, 0.025], [gx - 0.13, gy + 0.14, 0.025], st.c.clone().multiplyScalar(0.3), uv.glow);
        });
      }
      // 手机的闪光灯
      if (r() < 0.03) glow.at(x, z, face, () => glow.quad([0.1, h + 1.02, 0.03], [0.2, h + 1.02, 0.03], [0.2, h + 1.12, 0.03], [0.1, h + 1.12, 0.03], col('#ffffff'), uv.glow));
    }
  }
  // 过道的地灯（每级台阶的边上一颗小灯）
  for (let k = 0; k < tiers; k++) {
    const h = -drop + 0.3 + k * tierRise;
    const rad = tier0 + k * tierD + 0.04;
    for (let j = -3; j <= 3; j++) {
      const a = Math.PI + j * 0.55;
      if (a < a0 || a > a1) continue;
      const x = Math.sin(a) * rad;
      const z = Math.cos(a) * rad;
      glow.at(x, z, a + Math.PI, () => glow.quad([-0.07, h - 0.08, 0.02], [0.07, h - 0.08, 0.02], [0.07, h + 0.03, 0.02], [-0.07, h + 0.03, 0.02], col('#ffb347').multiplyScalar(0.8), uv.glow));
    }
  }

  // 台沿一圈金色的灯带，往下照亮台子立面的一点光晕
  glow.lit = false;
  glow.ao = 0;
  const gold = col('#ffc861');
  glow.ring(0, 0, R - 0.03, R + 0.03, 0.004, seg, gold.clone().multiplyScalar(0.9), { uv: uv.glowWide });
  glow.ring(0, 0, R + 0.02, R + 0.45, -drop + 0.004, seg, [gold.clone().multiplyScalar(0.35), col('#000000')], { uv: uv.glowFade });
}

// ---------- 场地 ----------

export class Venue {
  readonly group = new THREE.Group();
  // 画面外（墙后、看台外）的颜色：场景背景、雾都用它，桌子远处的雾就融进场地里
  readonly background: THREE.Color;
  // 镜头最远要看到多远（世界单位）
  readonly far: number;
  private mats: THREE.MeshBasicMaterial[] = [];
  private glowMat: THREE.MeshBasicMaterial | null = null;
  private textures: THREE.Texture[] = [];
  private ribbon: THREE.CanvasTexture | null = null;
  private redraw: (() => void) | null = null;
  private level = -1;
  private dark = -1;
  private disposed = false;

  constructor(
    readonly spec: VenueSpec,
    frame: VenueFrame,
    aniso: number,
  ) {
    const M = frame.scale;
    const FY = frame.floorY;
    const solid = new Mesher(M, FY);
    const glow = new Mesher(M, FY);
    glow.lit = false;
    glow.ao = 0;
    const floor = new Mesher(M, FY);
    floor.lit = false;
    floor.ao = 0;
    const atlas = new Atlas(2048, 1024);
    const kind = spec.kind;
    const tod = TODS[spec.tod ?? 'day'];
    const floorSize = 1024;
    let floorCanvas: HTMLCanvasElement;
    let F: number;
    let ribbonMesh: Mesher | null = null;
    let crowdMesh: Mesher | null = null;
    // 字体下载好以后重画一遍图集（牌子上的字）
    const drawAtlas = (): Record<string, UV> => {
      const g = atlas.g;
      g.clearRect(32, 0, atlas.W - 32, atlas.H);
      g.clearRect(0, 32, 32, atlas.H - 32);
      const uv = kind === 'club' ? clubAtlas(atlas, tod, rng(3)) : kind === 'match' ? matchAtlas(atlas, spec) : finalAtlas(atlas, spec);
      // 叠加混合用的长条光（灯带、窗光）：中间亮、两头淡的横条，和从亮到黑的渐变（地上的光晕）
      uv.glowWide = wideGlow(atlas, 1050, 940);
      uv.glowFade = fadeGlow(atlas, 1230, 940);
      return uv;
    };
    const uv = drawAtlas();
    if (kind === 'club') {
      F = CLUB.floorF;
      floorCanvas = clubFloor(tod, floorSize);
      buildClub(solid, glow, uv, tod);
      floor.quad([-CLUB.side, 0, CLUB.front], [CLUB.side, 0, CLUB.front], [CLUB.side, 0, CLUB.back], [-CLUB.side, 0, CLUB.back], col('#ffffff'), planar(-CLUB.side, CLUB.side, CLUB.back, CLUB.front, F));
      this.background = tod.tint.clone().multiply(col('#d9d4cb'));
      this.far = 6.5 * M;
    } else if (kind === 'match') {
      F = MATCH.floorF;
      floorCanvas = matchFloor(floorSize, spec);
      buildMatch(solid, glow, uv);
      const S = MATCH.stage;
      floor.quad([-S, 0, S], [S, 0, S], [S, 0, -S], [-S, 0, -S], col('#ffffff'), planar(-S, S, -S, S, F));
      // 台子外面一圈（低一截）：地毯
      const H = -MATCH.stageH;
      const ring = (x0: number, x1: number, z0: number, z1: number) => floor.quad([x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0], col('#ffffff'), planar(x0, x1, z0, z1, F));
      ring(-F, F, -F, -S);
      ring(-F, F, S, F);
      ring(-F, -S, -S, S);
      ring(S, F, -S, S);
      this.background = col('#121722');
      this.far = 8 * M;
    } else {
      F = FINAL.floorF;
      floorCanvas = finalFloor(floorSize);
      ribbonMesh = new Mesher(M, FY);
      crowdMesh = new Mesher(M, FY);
      buildFinal(solid, glow, uv, ribbonMesh, crowdMesh);
      // 台面：圆的，贴图照平面铺
      const R = FINAL.stage;
      const seg = 72;
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const b = ((i + 1) / seg) * Math.PI * 2;
        const pa: V3 = [Math.sin(a) * R, 0, Math.cos(a) * R];
        const pb: V3 = [Math.sin(b) * R, 0, Math.cos(b) * R];
        const toUv = (p: V3) => [(p[0] + F) / (2 * F), 1 - (p[2] + F) / (2 * F)];
        const [ua, va] = toUv(pa);
        const [ub, vb] = toUv(pb);
        floor.triUv([0, 0, 0], pa, pb, col('#ffffff'), [0.5, 0.5], [ua, va], [ub, vb]);
      }
      this.background = col('#050407');
      this.far = 9.5 * M;
    }

    const atlasTex = texture(atlas.cv, aniso);
    const floorTex = texture(floorCanvas, aniso);
    this.textures.push(atlasTex, floorTex);
    const basic = (map: THREE.Texture, extra: THREE.MeshBasicMaterialParameters = {}) => {
      const mat = new THREE.MeshBasicMaterial({ map, vertexColors: true, fog: false, ...extra });
      this.mats.push(mat);
      return mat;
    };
    const add = (mesh: THREE.Mesh, order = 0) => {
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.renderOrder = order;
      this.group.add(mesh);
    };
    add(new THREE.Mesh(floor.geometry(), basic(floorTex)));
    add(new THREE.Mesh(solid.geometry(), basic(atlasTex)));
    // 观众：抠图的小人（不透明、不排序，跟墙一样写深度）
    if (crowdMesh) add(new THREE.Mesh(crowdMesh.geometry(), basic(atlasTex, { alphaTest: 0.5 })));
    if (!glow.empty) {
      this.glowMat = basic(atlasTex, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      add(new THREE.Mesh(glow.geometry(), this.glowMat), 2);
    }
    if (ribbonMesh) {
      const rc = ribbonCanvas(spec);
      const rt = texture(rc, aniso);
      rt.wrapS = THREE.RepeatWrapping;
      this.ribbon = rt;
      this.textures.push(rt);
      add(new THREE.Mesh(ribbonMesh.geometry(), basic(rt)), 1);
    }
    this.group.name = 'venue';

    // 字体还没下载好：先用系统字体画着，下载好重画图集（字的位置、大小都照字体量的，换了字体要整个重画）
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    // 观众身上的字（毛巾、法被、横幅）也要等：按字分包下载的字体，没量过的字不会自己下
    const glyphs = `全国高中麻将大赛决赛团体个人第一二三四五六七八轮场桌东西区半裁判席必胜加油！应援 ★·${spec.round ?? ''}${spec.table ?? ''}${spec.title ?? ''}`;
    if (fonts && kind !== 'club' && !VENUE_FONTS.every((f) => fonts.check(f, glyphs))) {
      this.redraw = () => {
        if (this.disposed) return;
        drawAtlas();
        atlasTex.needsUpdate = true;
        if (kind === 'match') {
          floorTex.image = matchFloor(floorSize, spec);
          floorTex.needsUpdate = true;
        }
        if (this.ribbon) {
          this.ribbon.image = ribbonCanvas(spec);
          this.ribbon.needsUpdate = true;
        }
      };
      void Promise.all(VENUE_FONTS.map((f) => fonts.load(f, glyphs))).then(
        () => this.redraw?.(),
        () => {},
      );
    }
  }

  // 每帧：light 是和牌聚光灯、衣的夜里压暗多少（1 是原样），dark 是初美的风、淡的星空把四周压暗多少（1 是全黑）
  update(t: number, light: number, dark: number): void {
    if (this.ribbon) this.ribbon.offset.x = (t * 0.035) % 1;
    if (Math.abs(light - this.level) < 0.002 && Math.abs(dark - this.dark) < 0.002) return;
    this.level = light;
    this.dark = dark;
    const k = light * (1 - 0.92 * dark);
    for (const m of this.mats) m.color.setRGB(k * (1 - 0.25 * dark), k * (1 - 0.4 * dark), k);
  }

  dispose(): void {
    this.disposed = true;
    this.redraw = null;
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.mats) m.dispose();
    for (const t of this.textures) t.dispose();
    this.group.removeFromParent();
  }
}

// 平放的地面按平面铺贴图：地板贴图盖住 [-F, F] 见方
function planar(x0: number, x1: number, z0: number, z1: number, F: number): UV {
  return [(x0 + F) / (2 * F), 1 - (z1 + F) / (2 * F), (x1 + F) / (2 * F), 1 - (z0 + F) / (2 * F)];
}

// 横条光：左右两头淡、中间亮，上下也淡
function wideGlow(a: Atlas, x: number, y: number): UV {
  const g = a.g;
  g.fillStyle = '#000';
  g.fillRect(x, y, 160, 64);
  const gr = g.createLinearGradient(0, y, 0, y + 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(x, y, 160, 64);
  return a.uv(x, y, 160, 64, 4);
}

// 从亮到黑（v 方向）：地上一圈光晕用
function fadeGlow(a: Atlas, x: number, y: number): UV {
  const g = a.g;
  const gr = g.createLinearGradient(0, y, 0, y + 64);
  gr.addColorStop(0, '#000');
  gr.addColorStop(1, '#fff');
  g.fillStyle = gr;
  g.fillRect(x, y, 160, 64);
  return a.uv(x, y, 160, 64, 4);
}

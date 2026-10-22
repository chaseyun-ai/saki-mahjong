import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Game } from '../engine/game';
import type { Meld } from '../engine/score';
import { TILE_COUNT, TileId, WIND_CN } from '../engine/tiles';
import type { GameEvent } from '../engine/game';
import { FACE_TOTAL, FaceAtlas, faceIndex } from './faces';
import { Avatar } from './avatar';

// 3D 牌桌。规则状态全部来自 Game，这里只负责把每张牌摆到该在的位置，并做平滑移动。
//
// 坐标：桌面是 y = 0 的平面，桌子中心在原点。自己坐在 +z 一侧朝 -z 看，
// 下家在 +x，对家在 -z，上家在 -x。每个座位用“本地坐标”摆牌：本地 +z 指向座位的人，+x 是他的右手边，
// 再绕 y 轴转 seat × 90° 得到世界坐标。

export const TILE_W = 1;
export const TILE_H = 1.36;
export const TILE_T = 0.78;
const GAP = 0.04;

const HAND_Z = 9.8;
const POND_Z = 3.6;
const POND_COLS = 6;
const MELD_Z = 10.4;
const TABLE_HALF = 14;
const CONSOLE_HALF = 2.9;

// 角色：免费的 VRM 示例模型（署名见 README）
const AVATAR_MODELS = ['models/pixiv-sample.glb', 'models/seed-san.glb'];
const AVATAR_SCALE = 13;
const SEAT_Y = -4;
const SEAT_Z = TABLE_HALF + 5;

interface Character {
  seat: number;
  seatRoot: THREE.Group;
  avatar: Avatar | null;
}

const STANDING = new THREE.Euler(0, 0, 0);
const FACE_UP = new THREE.Euler(-Math.PI / 2, 0, 0);
const FACE_DOWN = new THREE.Euler(Math.PI / 2, 0, Math.PI);

interface Placement {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: number;
}

interface TileObj {
  group: THREE.Group;
  shown: boolean;
  target: Placement | null;
}

export interface SyncView {
  me: number;
  clickable: Set<TileId>;
  colors: string[];
}

export class Table3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private atlas = new FaceAtlas();
  private tiles: TileObj[] = [];
  private faceGeoms: THREE.PlaneGeometry[] = [];
  private consoleCanvas = document.createElement('canvas');
  private consoleTex: THREE.CanvasTexture;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-9, -9);
  private hovered: TileId | null = null;
  private clickable = new Set<TileId>();
  private lastSync: { g: Game; view: SyncView } | null = null;
  private clock = new THREE.Clock();
  private frame = 0;
  private characters: Character[] = [];
  private characterGen = 0;

  constructor(
    private container: HTMLElement,
    private onTileClick: (id: TileId) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.consoleCanvas.width = 512;
    this.consoleCanvas.height = 512;
    this.consoleTex = new THREE.CanvasTexture(this.consoleCanvas);
    this.consoleTex.colorSpace = THREE.SRGBColorSpace;

    this.buildRoom();
    this.buildTiles();
    void this.atlas.draw();

    this.resize();
    window.addEventListener('resize', this.resize);
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerleave', () => this.pointer.set(-9, -9));
    el.addEventListener('click', this.onClick);
    this.loop();
    // 调试用：?debug 时可以在控制台里拿到牌桌对象
    if (location.search.includes('debug')) (window as unknown as { table3d: Table3D }).table3d = this;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- 场景 ----------

  private buildRoom(): void {
    this.scene.background = new THREE.Color('#0d2024');
    this.scene.fog = new THREE.Fog('#0d2024', 40, 80);

    this.scene.add(new THREE.HemisphereLight('#dfefff', '#1b2a2c', 1.1));
    const key = new THREE.DirectionalLight('#fff4e0', 2.2);
    key.position.set(-6, 22, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    key.shadow.bias = -0.0005;
    this.scene.add(key);

    // 桌布
    const felt = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE_HALF * 2, TABLE_HALF * 2),
      new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }),
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // 木框
    const wood = new THREE.MeshStandardMaterial({ color: '#6b3f22', roughness: 0.55, metalness: 0.05 });
    for (let s = 0; s < 4; s++) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HALF * 2 + 2, 0.9, 1), wood);
      rail.position.set(0, 0.25, TABLE_HALF + 0.5);
      rail.castShadow = true;
      rail.receiveShadow = true;
      const holder = new THREE.Group();
      holder.add(rail);
      holder.rotation.y = (s * Math.PI) / 2;
      this.scene.add(holder);
    }

    // 中央控制台：顶面画点数和局数
    const consoleMats = [
      new THREE.MeshStandardMaterial({ color: '#10292e', roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ map: this.consoleTex, roughness: 0.35 }),
    ];
    const box = new THREE.Mesh(new RoundedBoxGeometry(CONSOLE_HALF * 2, 0.5, CONSOLE_HALF * 2, 4, 0.25), consoleMats[0]);
    box.position.y = 0.25;
    box.receiveShadow = true;
    box.castShadow = true;
    this.scene.add(box);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(CONSOLE_HALF * 2 - 0.3, CONSOLE_HALF * 2 - 0.3), consoleMats[1]);
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.505;
    this.scene.add(top);
  }

  private buildTiles(): void {
    for (let i = 0; i < FACE_TOTAL; i++) this.faceGeoms.push(this.atlas.faceGeometry(i, TILE_W * 0.9, TILE_H * 0.9));
    const bodyGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.62, 3, 0.12);
    const backGeom = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.42, 3, 0.12);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#f6f1e3', roughness: 0.35 });
    const backMat = new THREE.MeshStandardMaterial({ color: '#2f78a8', roughness: 0.4 });
    const faceMat = new THREE.MeshStandardMaterial({ map: this.atlas.texture, transparent: true, roughness: 0.35 });
    for (let id = 0; id < TILE_COUNT; id++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.z = TILE_T * 0.19;
      const back = new THREE.Mesh(backGeom, backMat);
      back.position.z = -TILE_T * 0.25;
      const face = new THREE.Mesh(this.faceGeoms[faceIndex(id)], faceMat);
      face.position.z = TILE_T / 2 + 0.002;
      for (const m of [body, back]) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
      group.add(body, back, face);
      group.userData.tileId = id;
      group.visible = false;
      this.scene.add(group);
      this.tiles.push({ group, shown: false, target: null });
    }
  }

  private buildCharacters(colors: string[], me: number): void {
    for (const c of this.characters) this.scene.remove(c.seatRoot);
    this.characters = [];
    const gen = ++this.characterGen;
    let n = 0;
    for (let s = 0; s < 4; s++) {
      if (s === me) continue;
      const seatRoot = new THREE.Group();
      const local = new THREE.Vector3(0, 0, SEAT_Z);
      seatRoot.position.copy(local.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatAngle(s, me)));
      seatRoot.rotation.y = this.seatAngle(s, me);
      // 模型加载完之前先放一个简单的占位人物
      const holder = placeholder(colors[s]);
      seatRoot.add(holder);
      this.scene.add(seatRoot);
      const ch: Character = { seat: s, seatRoot, avatar: null };
      this.characters.push(ch);
      const url = AVATAR_MODELS[n++ % AVATAR_MODELS.length];
      Avatar.load(url)
        .then((av) => {
          if (gen !== this.characterGen) return;
          seatRoot.remove(holder);
          av.root.scale.setScalar(AVATAR_SCALE);
          av.root.position.y = SEAT_Y - av.hipHeight * AVATAR_SCALE;
          seatRoot.add(av.root);
          ch.avatar = av;
          this.lookAtHand(ch);
        })
        .catch((err) => console.warn('角色模型加载失败', url, err));
    }
  }

  private characterAt(seat: number): Character | undefined {
    return this.characters.find((c) => c.seat === seat);
  }

  // 本地坐标 → 世界坐标
  private seatPoint(seat: number, x: number, y: number, z: number): THREE.Vector3 {
    const me = this.lastSync?.view.me ?? 0;
    return new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.seatAngle(seat, me));
  }

  private lookAtHand(ch: Character): void {
    ch.avatar?.lookAtPoint(this.seatPoint(ch.seat, 0, 0, HAND_Z));
  }

  // 牌局事件驱动角色的视线、表情和动作
  onEvent(e: GameEvent): void {
    const all = this.characters;
    if (e.type === 'draw') {
      const ch = this.characterAt(e.seat);
      if (ch) this.lookAtHand(ch);
    } else if (e.type === 'discard') {
      const pond = this.seatPoint(e.seat, 0, 0, POND_Z);
      for (const ch of all) {
        if (ch.seat === e.seat) {
          ch.avatar?.reach();
          if (e.riichi) ch.avatar?.setMood('angry', 1.6);
        } else ch.avatar?.lookAtPoint(pond);
      }
    } else if (e.type === 'call') {
      const who = this.seatPoint(e.seat, 0, 8, SEAT_Z);
      for (const ch of all) {
        if (ch.seat === e.seat) ch.avatar?.setMood('happy', 1.2);
        else ch.avatar?.lookAtPoint(who);
      }
    } else if (e.type === 'ability') {
      for (const ch of all) {
        if (ch.seat === e.seat) ch.avatar?.setMood('relaxed', 2);
        else ch.avatar?.setMood('surprised', 1.2);
      }
    } else if (e.type === 'roundEnd') {
      const r = e.result;
      for (const ch of all) {
        if (r.wins.some((w) => w.seat === ch.seat)) ch.avatar?.setMood('happy', 3);
        else if (r.wins.some((w) => w.from === ch.seat)) ch.avatar?.setMood('sad', 3);
        else if (r.deltas[ch.seat] < 0) ch.avatar?.setMood('sad', 2);
      }
    } else if (e.type === 'roundStart') {
      for (const ch of all) this.lookAtHand(ch);
    }
  }

  // ---------- 摆牌 ----------

  // 座位在画面上的转角：自己永远在下方
  private seatAngle(seat: number, me: number): number {
    return (((seat - me + 4) % 4) * Math.PI) / 2;
  }

  sync(g: Game, view: SyncView): void {
    if (this.characters.length === 0) this.buildCharacters(view.colors, view.me);
    this.lastSync = { g, view };
    this.clickable = view.clickable;
    const targets = new Map<TileId, Placement>();
    for (let s = 0; s < 4; s++) this.placeSeat(g, s, view.me, targets);
    this.placeDora(g, targets);

    for (let id = 0; id < TILE_COUNT; id++) {
      const t = this.tiles[id];
      const target = targets.get(id) ?? null;
      t.target = target;
      if (!target) {
        t.group.visible = false;
        t.shown = false;
        continue;
      }
      if (!t.shown) {
        // 第一次出现：从上方落下
        t.group.position.copy(target.pos).add(new THREE.Vector3(0, 2.5, 0));
        t.group.quaternion.copy(target.quat);
        t.group.scale.setScalar(target.scale);
        t.group.visible = true;
        t.shown = true;
      }
    }
    this.drawConsole(g, view);
  }

  private toWorld(seat: number, me: number, x: number, y: number, z: number, rot: THREE.Euler, extraY = 0, scale = 1): Placement {
    const angle = this.seatAngle(seat, me);
    const axis = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3(x, y, z).applyAxisAngle(axis, angle);
    const quat = new THREE.Quaternion()
      .setFromAxisAngle(axis, angle + extraY)
      .multiply(new THREE.Quaternion().setFromEuler(rot));
    return { pos, quat, scale };
  }

  private placeSeat(g: Game, s: number, me: number, out: Map<TileId, Placement>): void {
    const p = g.players[s];
    const mine = s === me;
    const lyingY = TILE_T / 2;

    // 副露：从右边往左摆
    let mx = TABLE_HALF - 1.2;
    const meldWidth = (m: Meld) => m.tiles.length * (TILE_W + GAP) + (m.calledTile !== undefined ? TILE_H - TILE_W : 0);
    for (const m of p.melds) {
      const tiles = this.meldOrder(m);
      mx -= meldWidth(m);
      let x = mx;
      for (const [i, t] of tiles.entries()) {
        const sideways = t === m.calledTile;
        const hidden = m.type === 'ankan' && (i === 0 || i === 3);
        const w = sideways ? TILE_H : TILE_W;
        const z = sideways ? MELD_Z + (TILE_H - TILE_W) / 2 : MELD_Z;
        out.set(t, this.toWorld(s, me, x + w / 2, lyingY, z, hidden ? FACE_DOWN : FACE_UP, sideways ? Math.PI / 2 : 0));
        x += w + GAP;
      }
      if (m.type === 'kakan') {
        // 加杠的那张叠放在横着的牌上方（靠桌子中心一侧）
        const added = m.tiles[3];
        const ci = tiles.indexOf(m.calledTile!);
        let cx = mx;
        for (let i = 0; i < ci; i++) cx += TILE_W + GAP;
        out.set(added, this.toWorld(s, me, cx + TILE_H / 2, lyingY, MELD_Z + (TILE_H - TILE_W) / 2 - TILE_W - GAP, FACE_UP, Math.PI / 2));
      }
      mx -= 0.3;
    }

    // 手牌：自己的稍微后仰朝向镜头，别人的立着背对我们
    const drawn = p.drawn;
    const hand = p.hand.filter((t) => t !== drawn).sort((a, b) => a - b);
    const count = hand.length + (drawn !== null ? 1 : 0);
    const step = TILE_W + GAP;
    const width = count * step + (drawn !== null ? 0.5 : 0);
    // 副露多了手牌往左让
    const shift = p.melds.length ? Math.max(0, width / 2 - (mx - 0.6)) : 0;
    let x = -width / 2 - shift + TILE_W / 2;
    const rot = mine ? new THREE.Euler(-0.32, 0, 0) : STANDING;
    const y = TILE_H / 2;
    const place = (t: TileId) => {
      const lift = mine && t === this.hovered && this.clickable.has(t) ? 0.4 : 0;
      out.set(t, this.toWorld(s, me, x, y + lift, HAND_Z, rot));
      x += step;
    };
    hand.forEach(place);
    if (drawn !== null) {
      x += 0.5;
      place(drawn);
    }

    // 牌河：六张一行，立直牌横放
    let col = 0;
    let row = 0;
    let px = -((POND_COLS * step) / 2);
    for (const d of p.discards) {
      if (d.called) continue;
      if (col === POND_COLS && row < 2) {
        col = 0;
        row++;
        px = -((POND_COLS * step) / 2);
      }
      const w = d.riichi ? TILE_H : TILE_W;
      const z = POND_Z + row * (TILE_H + GAP) + TILE_H / 2;
      out.set(d.tile, this.toWorld(s, me, px + w / 2, lyingY, z, FACE_UP, d.riichi ? Math.PI / 2 : 0));
      px += w + GAP;
      col++;
    }
  }

  // 副露里被叫的那张按来源放在对应位置：上家的放左边，对家中间，下家右边
  private meldOrder(m: Meld): TileId[] {
    if (m.calledTile === undefined || m.from === undefined) return m.tiles.slice(0, m.type === 'kakan' ? 3 : 4);
    const own = m.tiles.filter((t) => t !== m.calledTile).slice(0, m.type === 'kakan' ? 2 : 3);
    return [m.calledTile, ...own];
  }

  private placeDora(g: Game, out: Map<TileId, Placement>): void {
    const ind = g.wall.doraIndicators;
    const scale = 0.62;
    ind.forEach((t, i) => {
      const revealed = i < g.wall.doraRevealed;
      const pos = new THREE.Vector3((i - 2) * (TILE_W * scale + 0.06), 0.5 + (TILE_T * scale) / 2, 0.85);
      const quat = new THREE.Quaternion().setFromEuler(revealed ? FACE_UP : FACE_DOWN);
      out.set(t, { pos, quat, scale });
    });
  }

  // ---------- 中央控制台 ----------

  private drawConsole(g: Game, view: SyncView): void {
    const c = this.consoleCanvas.getContext('2d')!;
    const S = 512;
    c.fillStyle = '#0d2428';
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = 4;
    c.strokeRect(10, 10, S - 20, S - 20);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#f0c35a';
    c.font = "700 40px 'PingFang SC','Microsoft YaHei',sans-serif";
    c.fillText(g.roundLabel(), S / 2, S / 2 - 70);
    c.fillStyle = '#a9c3c4';
    c.font = "500 28px 'PingFang SC','Microsoft YaHei',sans-serif";
    c.fillText(`余 ${g.wall.remaining}　立直棒 ×${g.riichiSticks}`, S / 2, S / 2 - 22);
    for (let s = 0; s < 4; s++) {
      const rel = (s - view.me + 4) % 4;
      c.save();
      c.translate(S / 2, S / 2);
      c.rotate((-rel * Math.PI) / 2);
      const p = g.players[s];
      const active = g.phase === 'turn' && g.turn === s;
      if (active) {
        c.fillStyle = 'rgba(240,195,90,0.18)';
        c.fillRect(-150, 160, 300, 70);
      }
      c.fillStyle = view.colors[s];
      c.font = "700 34px 'PingFang SC','Microsoft YaHei',sans-serif";
      c.fillText(WIND_CN[g.seatWind(s) - 27], -90, 196);
      c.fillStyle = active ? '#f0c35a' : '#f2efe6';
      c.font = "600 36px 'PingFang SC','Microsoft YaHei',sans-serif";
      c.fillText(String(p.score), 20, 196);
      if (p.riichi) {
        c.fillStyle = '#fff';
        c.fillRect(-60, 136, 120, 12);
        c.fillStyle = '#c0392b';
        c.beginPath();
        c.arc(0, 142, 5, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
    this.consoleTex.needsUpdate = true;
  }

  // ---------- 交互和动画 ----------

  private resize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 竖屏时把视野拉宽，保证整张桌子都在画面里
    this.camera.fov = w / h < 1.2 ? 38 * Math.min(1.9, 1.2 / (w / h)) : 38;
    this.camera.position.set(0, 18, 29);
    this.camera.lookAt(0, 1, -3);
    this.camera.updateProjectionMatrix();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  private onClick = (e: MouseEvent): void => {
    this.onPointerMove(e as PointerEvent);
    const id = this.pick();
    if (id !== null && this.clickable.has(id)) this.onTileClick(id);
  };

  private pick(): TileId | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const cands = [...this.clickable].map((id) => this.tiles[id].group);
    const hit = this.raycaster.intersectObjects(cands, true)[0];
    let o: THREE.Object3D | null = hit?.object ?? null;
    while (o && o.userData.tileId === undefined) o = o.parent;
    return o ? (o.userData.tileId as TileId) : null;
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const hover = this.pick();
    if (hover !== this.hovered) {
      this.hovered = hover;
      this.renderer.domElement.style.cursor = hover !== null ? 'pointer' : 'default';
      if (this.lastSync) this.sync(this.lastSync.g, this.lastSync.view);
    }
    const k = 1 - Math.exp(-dt * 16);
    for (const t of this.tiles) {
      if (!t.target) continue;
      t.group.position.lerp(t.target.pos, k);
      t.group.quaternion.slerp(t.target.quat, k);
      const sc = t.group.scale.x + (t.target.scale - t.group.scale.x) * k;
      t.group.scale.setScalar(sc);
    }
    for (const c of this.characters) c.avatar?.update(dt);
    this.renderer.render(this.scene, this.camera);
  };
}

function placeholder(color: string): THREE.Group {
  const c = new THREE.Color(color);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 2.2, 6, 16), new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  body.position.y = 2.2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 16), new THREE.MeshStandardMaterial({ color: '#f3d9c6', roughness: 0.7 }));
  head.position.y = 5.3;
  body.castShadow = head.castShadow = true;
  g.add(body, head);
  return g;
}

function feltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(512, 512, 60, 512, 512, 720);
  grad.addColorStop(0, '#2c7079');
  grad.addColorStop(0.6, '#1e525a');
  grad.addColorStop(1, '#12363c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1024);
  // 细微的布纹噪点
  const img = ctx.getImageData(0, 0, 1024, 1024);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(240,195,90,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(150, 150, 724, 724);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

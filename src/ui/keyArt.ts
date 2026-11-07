// 白水哩番缚拿到的钥匙：照原作那把画（不用截图，canvas 上一笔笔画出来），3D 贴在一块面片上，2D 直接画。
// 横着放，从左到右：吊牌（写着缚了几番、哪一局，比如 E-2-1）、细颈、钥匙环（金框、两段红色珐琅、
// 中间一颗红宝石和四个圆孔、四道金线箍）、带竖纹的喇叭形握柄、长杆、杆尾两组阶梯形的齿。

export const KEY_ART = { w: 1024, h: 340 };

const cache = new Map<string, HTMLCanvasElement>();

// 吊牌上的局：东 2 局 1 本场写成 E-2-1
export function keyTag(roundWind: number, roundNumber: number, honba: number): string {
  return `${'ESWN'[roundWind] ?? 'E'}-${roundNumber + 1}-${honba}`;
}

export function keyArt(bind: number, tag: string): HTMLCanvasElement {
  const id = `${bind}|${tag}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = KEY_ART.w;
  c.height = KEY_ART.h;
  const ctx = c.getContext('2d')!;
  drawKey(ctx, bind, tag);
  cache.set(id, c);
  return c;
}

const GOLD_LIGHT = '#fff3c2';
const GOLD = '#f4cd62';
const GOLD_MID = '#dcaa3c';
const GOLD_DARK = '#8f5f17';
const LINE = '#6b4410';
const RED = '#b51f45';
const RED_DARK = '#6e0f2a';

function goldFill(ctx: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, GOLD_LIGHT);
  g.addColorStop(0.35, GOLD);
  g.addColorStop(0.75, GOLD_MID);
  g.addColorStop(1, GOLD_DARK);
  return g;
}

function drawKey(ctx: CanvasRenderingContext2D, bind: number, tag: string): void {
  const cy = 150;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ---- 杆尾的齿（先画，杆盖在上面）----
  ctx.fillStyle = goldFill(ctx, cy, cy + 130);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 4;
  // 下面一大组：阶梯形，像“ヨ”和“王”叠在一起
  const bit = new Path2D();
  bit.moveTo(760, cy + 10);
  bit.lineTo(760, cy + 118);
  bit.lineTo(800, cy + 118);
  bit.lineTo(800, cy + 92);
  bit.lineTo(826, cy + 92);
  bit.lineTo(826, cy + 118);
  bit.lineTo(866, cy + 118);
  bit.lineTo(866, cy + 70);
  bit.lineTo(844, cy + 70);
  bit.lineTo(844, cy + 50);
  bit.lineTo(880, cy + 50);
  bit.lineTo(880, cy + 10);
  bit.closePath();
  ctx.fill(bit);
  ctx.stroke(bit);
  // 齿上的凹槽
  ctx.fillStyle = 'rgba(110,70,16,0.55)';
  ctx.fillRect(776, cy + 40, 52, 12);
  ctx.fillRect(776, cy + 66, 30, 10);
  // 上面一个小钩
  const hook = new Path2D();
  hook.moveTo(900, cy - 10);
  hook.lineTo(900, cy - 62);
  hook.lineTo(946, cy - 62);
  hook.lineTo(946, cy - 44);
  hook.lineTo(920, cy - 44);
  hook.lineTo(920, cy - 10);
  hook.closePath();
  ctx.fillStyle = goldFill(ctx, cy - 62, cy);
  ctx.fill(hook);
  ctx.stroke(hook);

  // ---- 长杆 ----
  const shaft = new Path2D();
  shaft.moveTo(560, cy - 17);
  shaft.lineTo(968, cy - 17);
  shaft.arc(968, cy, 17, -Math.PI / 2, Math.PI / 2);
  shaft.lineTo(560, cy + 17);
  shaft.closePath();
  ctx.fillStyle = goldFill(ctx, cy - 17, cy + 17);
  ctx.fill(shaft);
  ctx.lineWidth = 4;
  ctx.stroke(shaft);
  // 杆头的小圆钮
  ctx.beginPath();
  ctx.arc(992, cy, 11, 0, Math.PI * 2);
  ctx.fillStyle = goldFill(ctx, cy - 11, cy + 11);
  ctx.fill();
  ctx.stroke();
  // 高光
  ctx.strokeStyle = 'rgba(255,255,240,0.85)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(575, cy - 8);
  ctx.lineTo(955, cy - 8);
  ctx.stroke();
  // 杆上两道细箍
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  for (const x of [600, 612]) {
    ctx.beginPath();
    ctx.moveTo(x, cy - 17);
    ctx.lineTo(x, cy + 17);
    ctx.stroke();
  }

  // ---- 喇叭形握柄（带竖纹）----
  const grip = new Path2D();
  grip.moveTo(490, cy - 44);
  grip.quadraticCurveTo(540, cy - 24, 572, cy - 20);
  grip.lineTo(572, cy + 20);
  grip.quadraticCurveTo(540, cy + 24, 490, cy + 44);
  grip.closePath();
  ctx.fillStyle = goldFill(ctx, cy - 44, cy + 44);
  ctx.fill(grip);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 4;
  ctx.stroke(grip);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(107,68,16,0.7)';
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.moveTo(496, cy + k * 11);
    ctx.quadraticCurveTo(535, cy + k * 6, 568, cy + k * 5);
    ctx.stroke();
  }

  // ---- 钥匙环 ----
  const bx = 385;
  const R = 112;
  // 外框
  ctx.beginPath();
  ctx.ellipse(bx, cy, R, R * 1.08, 0, 0, Math.PI * 2);
  ctx.fillStyle = goldFill(ctx, cy - R, cy + R);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = LINE;
  ctx.stroke();
  // 两段红色珐琅（上、下两道弧）
  for (const [a0, a1] of [
    [-Math.PI * 0.86, -Math.PI * 0.14],
    [Math.PI * 0.14, Math.PI * 0.86],
  ]) {
    ctx.beginPath();
    ctx.ellipse(bx, cy, R - 9, R * 1.08 - 9, 0, a0, a1);
    ctx.ellipse(bx, cy, R - 34, R * 1.08 - 34, 0, a1, a0, true);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
    g.addColorStop(0, '#d9466b');
    g.addColorStop(0.5, RED);
    g.addColorStop(1, RED_DARK);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = RED_DARK;
    ctx.stroke();
  }
  // 珐琅上的小亮点
  ctx.fillStyle = 'rgba(255,220,230,0.8)';
  for (const a of [-0.7, -0.45, 2.3]) {
    ctx.beginPath();
    ctx.arc(bx + Math.cos(a * Math.PI * 0.5) * (R - 22), cy + Math.sin(a * Math.PI * 0.5) * (R * 1.08 - 22) * (a > 0 ? -1 : 1), 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 里面的金圈
  ctx.beginPath();
  ctx.ellipse(bx, cy, R - 38, R * 1.08 - 38, 0, 0, Math.PI * 2);
  ctx.lineWidth = 9;
  ctx.strokeStyle = GOLD_MID;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = LINE;
  ctx.stroke();
  // 镂空的底（透出后面）
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(bx, cy, R - 43, R * 1.08 - 43, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.clearRect(bx - R, cy - R * 1.2, R * 2, R * 2.4);
  ctx.restore();
  // 中间的花：四个圆孔绕着一颗红宝石，金线连起来
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 9;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const x = bx + Math.cos(a) * 38;
    const y = cy + Math.sin(a) * 40;
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // 圆孔连到外圈
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 17, y + Math.sin(a) * 17);
    ctx.lineTo(bx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R * 1.08 - 40));
    ctx.strokeStyle = GOLD_MID;
    ctx.lineWidth = 7;
    ctx.stroke();
  }
  // 红宝石
  ctx.beginPath();
  ctx.arc(bx, cy, 22, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  const gem = ctx.createRadialGradient(bx - 5, cy - 6, 2, bx, cy, 16);
  gem.addColorStop(0, '#ff8fa8');
  gem.addColorStop(0.5, RED);
  gem.addColorStop(1, RED_DARK);
  ctx.beginPath();
  ctx.arc(bx, cy, 15, 0, Math.PI * 2);
  ctx.fillStyle = gem;
  ctx.fill();
  // 四道金线箍在外框上（上下左右偏一点）
  for (const a of [-Math.PI * 0.5, Math.PI * 0.5, 0.08, Math.PI - 0.08]) {
    const x = bx + Math.cos(a) * (R - 18);
    const y = cy + Math.sin(a) * (R * 1.08 - 18);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.roundRect(-26, -9, 52, 18, 9);
    ctx.fillStyle = goldFill(ctx, -9, 9);
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // ---- 细颈（带螺纹）----
  ctx.fillStyle = goldFill(ctx, cy - 13, cy + 13);
  ctx.beginPath();
  ctx.roundRect(214, cy - 13, 62, 26, 6);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  for (let x = 226; x < 270; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x, cy - 12);
    ctx.lineTo(x, cy + 12);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // ---- 吊牌 ----
  const tx = 122;
  const tr = 100;
  ctx.beginPath();
  ctx.ellipse(tx, cy, tr, tr * 1.04, 0, 0, Math.PI * 2);
  ctx.fillStyle = goldFill(ctx, cy - tr, cy + tr);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = LINE;
  ctx.stroke();
  // 内圈
  ctx.beginPath();
  ctx.ellipse(tx, cy, tr - 20, tr * 1.04 - 20, 0, 0, Math.PI * 2);
  const face = ctx.createRadialGradient(tx - 20, cy - 30, 10, tx, cy, tr);
  face.addColorStop(0, '#fff8dc');
  face.addColorStop(1, '#f1d27e');
  ctx.fillStyle = face;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.stroke();
  // 吊牌边上五个小箍
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.75 + (i * Math.PI * 1.5) / 4 + Math.PI;
    ctx.save();
    ctx.translate(tx + Math.cos(a) * (tr - 10), cy + Math.sin(a) * (tr * 1.04 - 10));
    ctx.rotate(a);
    ctx.beginPath();
    ctx.roundRect(-14, -8, 28, 16, 8);
    ctx.fillStyle = goldFill(ctx, -8, 8);
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
  // 番数（衬线体的大字）和局
  ctx.fillStyle = '#5a2310';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold 112px "Times New Roman", Georgia, serif`;
  ctx.fillText(String(bind), tx + 4, cy - 6);
  ctx.font = `bold 22px "Times New Roman", Georgia, serif`;
  ctx.save();
  ctx.translate(tx + 46, cy + 54);
  ctx.rotate(-0.55);
  ctx.fillText(tag, 0, 0);
  ctx.restore();
}

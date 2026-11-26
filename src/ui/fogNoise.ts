// 雾的底纹：一张首尾相接（平铺没有接缝）的分形噪声，稳乃的雾在 3D 里当贴图采样、在 2D 里拿来画雾团。
// 只在第一次起雾时算一遍（128×128 约 1 毫秒），之后每个像素只查贴图，不在着色器里现算噪声。

function lattice(period: number, seed: number): Float32Array {
  // 确定的伪随机数（不用 Math.random：每次开游戏雾的纹路一样，截图测试也稳）
  const out = new Float32Array(period * period);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    out[i] = (s >>> 8) / 0x1000000;
  }
  return out;
}

// size×size 的噪声，值 0–1：几层周期各翻一倍的值噪声叠起来（每层周期都整除 size，所以首尾相接）
export function fogNoise(size: number, seed: number, base = 4, octaves = 4): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const period = base << o;
    const grid = lattice(period, seed + o * 101);
    const step = period / size;
    for (let y = 0; y < size; y++) {
      const fy = y * step;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % period) * period;
      const r1 = ((y0 + 1) % period) * period;
      for (let x = 0; x < size; x++) {
        const fx = x * step;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % period;
        const c1 = (x0 + 1) % period;
        const top = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
        const bot = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
        out[y * size + x] += amp * (top + (bot - top) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  // 拉开到 0–1（叠起来的噪声挤在中间，对比不够）
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || total;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
  return out;
}

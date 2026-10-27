// 用现有的 VRoid 模型给每个角色渲染 5 张表情头像和 1 张切入立绘，存到 public/portraits/。
// 用法：CHROME=<Chromium 路径> node scripts/render-portraits.mjs
// 摆姿势、打光、表情在 scripts/portrait-stage.ts。要先 npm install（用到 vite 和 playwright-core）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/portraits');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['saki', 'nodoka', 'kuro', 'toki'];

const server = await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
// 没有显卡的机器上用软件渲染
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(e.message));
  await page.goto(url);
  fs.mkdirSync(outDir, { recursive: true });
  for (const id of ids) {
    const files = await page.evaluate(async (id) => (await import('/scripts/portrait-stage.ts')).renderCharacter(id), id);
    for (const [name, data] of Object.entries(files)) {
      fs.writeFileSync(path.join(outDir, name), Buffer.from(data.split(',')[1], 'base64'));
      console.log(name);
    }
  }
} finally {
  await browser.close();
  await server.close();
}

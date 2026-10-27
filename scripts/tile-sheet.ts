// 输出一张所有牌面的预览页：npx vite-node scripts/tile-sheet.ts > sheet.html
import { faceSvg } from '../src/ui/tileArt';

const cells: string[] = [];
for (let k = 0; k < 34; k++) cells.push(faceSvg(k, false));
cells.push(faceSvg(4, true), faceSvg(13, true), faceSvg(22, true));
const tiles = cells
  .map(
    (c) =>
      `<div style="width:80px;height:112px;background:#f8f4e9;border-radius:8px;padding:8px 5px;box-sizing:border-box">${c}</div>`,
  )
  .join('');
console.log(
  `<html><body style="background:#1d4b52;display:flex;flex-wrap:wrap;gap:8px;width:900px;padding:10px">${tiles}</body></html>`,
);

// 从字体子集里取出牌面要用的汉字轮廓，生成 src/ui/glyphs.ts
// 字体：霞鹜文楷 TC（LXGW WenKai TC）Bold，SIL Open Font License 1.1
// 用法：npx vite-node scripts/gen-glyphs.ts
import { writeFileSync } from 'node:fs';
import opentype from 'opentype.js';

const CHARS = '一二三四五六七八九萬東南西北中發';
const font = opentype.loadSync('scripts/fonts/lxgw-wenkai-tc-bold-subset.ttf');
const lines: string[] = [];
for (const ch of CHARS) {
  const path = font.getPath(ch, 0, 0, 100);
  const b = path.getBoundingBox();
  const r = (v: number) => Math.round(v * 10) / 10;
  lines.push(`  '${ch}': { d: '${path.toPathData(1)}', box: [${r(b.x1)}, ${r(b.y1)}, ${r(b.x2)}, ${r(b.y2)}] },`);
}
writeFileSync(
  'src/ui/glyphs.ts',
  `// 由 scripts/gen-glyphs.ts 生成，不要手改。
// 字形来自霞鹜文楷 TC（LXGW WenKai TC）Bold，SIL Open Font License 1.1。

export interface Glyph {
  d: string;
  box: [number, number, number, number];
}

export const GLYPHS: Record<string, Glyph> = {
${lines.join('\n')}
};
`,
);

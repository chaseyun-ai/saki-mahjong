import { type Entry, type Manifest, emptyManifest, fileOf, parseManifest } from './slots';
import { isZip, readZip, writeZip, type ZipEntry } from './zip';

// 素材包：一个 zip，里面是 manifest.json（哪个文件放哪一格）和文件本身（<主人>/<格子>.<扩展名>）。
// 导出、换电脑、换浏览器、放进项目都用它。没有 manifest.json 的普通 zip 也能导入：里面的文件照文件名去认。

export interface PackFile {
  owner: string;
  slot: string;
  entry: Entry;
  data: Uint8Array;
}

export const MANIFEST = 'manifest.json';

export function buildPack(files: PackFile[]): Uint8Array {
  const manifest: Manifest = emptyManifest();
  const entries: ZipEntry[] = [];
  for (const f of files) {
    const ext = f.entry.file.split('.').pop() ?? 'bin';
    const file = fileOf(f.owner, f.slot, ext);
    (manifest.assets[f.owner] ??= {})[f.slot] = { ...f.entry, file, size: f.data.length };
    entries.push({ name: file, data: f.data });
  }
  const text = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
  return writeZip([{ name: MANIFEST, data: text }, ...entries]);
}

export interface ReadPack {
  files: PackFile[]; // 清单里写明了位置的
  loose: ZipEntry[]; // 没写明的（普通 zip、清单里没提到的文件）：照文件名去认
  missing: string[]; // 清单里有、包里找不到的文件
}

// 读一个 zip。清单可以在包的最外层，也可以在唯一的一层文件夹里（别人把 public/custom 整个文件夹打了包）
export async function readPack(bytes: Uint8Array): Promise<ReadPack> {
  const all = await readZip(bytes);
  const at = all.find((e) => e.name === MANIFEST) ?? all.find((e) => /^[^/]+\/manifest\.json$/.test(e.name));
  const root = at ? at.name.slice(0, -MANIFEST.length) : '';
  let manifest: Manifest | null = null;
  if (at) {
    try {
      manifest = parseManifest(JSON.parse(new TextDecoder().decode(at.data)));
    } catch {
      manifest = null;
    }
  }
  const byName = new Map(all.map((e) => [e.name, e]));
  const used = new Set<string>(at ? [at.name] : []);
  const files: PackFile[] = [];
  const missing: string[] = [];
  for (const [owner, slots] of Object.entries(manifest?.assets ?? {})) {
    for (const [slot, entry] of Object.entries(slots)) {
      const z = byName.get(root + entry.file);
      if (!z) {
        missing.push(entry.file);
        continue;
      }
      used.add(z.name);
      files.push({ owner, slot, entry, data: z.data });
    }
  }
  return { files, loose: all.filter((e) => !used.has(e.name)), missing };
}

export { isZip };

// 把包存成文件（浏览器里弹出下载）。文件名用英文：有的浏览器下载时会把中文名丢掉
export function downloadZip(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function packName(): string {
  const d = new Date();
  return `saki-mahjong-assets-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.zip`;
}

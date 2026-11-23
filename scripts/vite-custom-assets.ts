import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Plugin, normalizePath } from 'vite';
import { MUSIC, SAFE_EXT, SAFE_ID, type Entry, type Manifest, emptyManifest, fileOf, parseManifest } from '../src/assets/slots';
import { MUSIC_SLOTS } from '../src/ui/musicTracks';

// 素材导入的「写进项目」：只在本地开发（npm run dev）时有。素材页把文件传过来，这里写进 public/custom/，
// 再把哪一格用哪个文件记进 public/custom/manifest.json。提交到 Git 以后，打包、发布的游戏里人人都有。
// 背景音乐例外：写成 public/music/<格子>.mp3（不进 git，免费授权的曲子不单独再分发，见 musicTracks.ts）。
// 打包（npm run build）、发布的网页里没有这个接口，素材页就只能存进浏览器；没导入过素材时打包放一份空清单。
//
//   GET    /__custom/ping                       在不在（素材页靠它决定显不显示「写进项目」）
//   GET    /__custom/music                      public/music 里有哪几首
//   PUT    /__custom/file?owner=&slot=          请求体是文件内容，x-saki-entry 头是 Entry（JSON，encodeURIComponent 过）
//   DELETE /__custom/file?owner=&slot=          删掉这一格

const MAX_BODY = 100 << 20;
const MUSIC_IDS = new Set<string>(MUSIC_SLOTS.map((m) => m.id));

export interface CustomDirs {
  custom: string; // public/custom
  music: string; // public/music
}

class Bad extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readManifest(dir: string): Promise<Manifest> {
  try {
    return parseManifest(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))) ?? emptyManifest();
  } catch {
    return emptyManifest();
  }
}

// 照字母排好再写，提交时的改动看得清楚
async function writeManifest(dir: string, m: Manifest): Promise<void> {
  const sorted: Manifest = { format: m.format, version: m.version, assets: {} };
  for (const owner of Object.keys(m.assets).sort()) {
    const slots = m.assets[owner];
    if (!Object.keys(slots).length) continue;
    sorted.assets[owner] = Object.fromEntries(Object.keys(slots).sort().map((k) => [k, slots[k]]));
  }
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(sorted, null, 2) + '\n');
}

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new Bad(413, '文件太大了（最多 100 MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function target(url: URL): { owner: string; slot: string } {
  const owner = url.searchParams.get('owner') ?? '';
  const slot = url.searchParams.get('slot') ?? '';
  if (!SAFE_ID.test(owner) || !SAFE_ID.test(slot)) throw new Bad(400, '格子名不对');
  if (owner === MUSIC && !MUSIC_IDS.has(slot)) throw new Bad(400, '没有这个背景音乐格子');
  return { owner, slot };
}

// 同一格以前的文件（可能是别的扩展名）删掉
async function removeSlotFiles(dir: string, owner: string, slot: string): Promise<void> {
  const files = await readdir(join(dir, owner)).catch(() => [] as string[]);
  for (const f of files) if (f.startsWith(slot + '.')) await rm(join(dir, owner, f), { force: true });
  const left = await readdir(join(dir, owner)).catch(() => null);
  if (left && !left.length) await rm(join(dir, owner), { recursive: true, force: true });
}

export async function handleCustom(req: IncomingMessage, dirs: CustomDirs): Promise<{ status: number; json: unknown }> {
  // 只认素材页自己发来的：带着这个头（别的网页没法不经同意带自定义头跨站发），来源也得是这个服务器
  if (req.headers['x-saki-custom'] !== '1') throw new Bad(403, '只认素材页发来的请求');
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) throw new Bad(403, '只认这个开发服务器自己的页面');
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.pathname.replace(/^\/__custom/, '');
  if (req.method === 'GET' && path === '/ping') return { status: 200, json: { ok: true, dir: 'public/custom' } };
  if (req.method === 'GET' && path === '/music') {
    const files = await readdir(dirs.music).catch(() => [] as string[]);
    return { status: 200, json: { slots: MUSIC_SLOTS.map((m) => m.id).filter((id) => files.includes(`${id}.mp3`)) } };
  }
  if (path !== '/file') throw new Bad(404, '没有这个接口');
  const { owner, slot } = target(url);
  if (req.method === 'PUT') {
    let entry: Entry;
    try {
      entry = JSON.parse(decodeURIComponent(String(req.headers['x-saki-entry'] ?? '')));
    } catch {
      throw new Bad(400, '缺文件说明');
    }
    const ext = String(entry.file ?? '').split('.').pop() ?? '';
    if (!SAFE_EXT.test(ext)) throw new Bad(400, '这个扩展名不收');
    const data = await body(req);
    if (!data.length) throw new Bad(400, '文件是空的');
    if (owner === MUSIC) {
      if (entry.media !== 'audio') throw new Bad(400, '背景音乐只收音频');
      await mkdir(dirs.music, { recursive: true });
      await writeFile(join(dirs.music, `${slot}.mp3`), data);
      return { status: 200, json: { ok: true, file: `public/music/${slot}.mp3` } };
    }
    const file = fileOf(owner, slot, ext);
    const m = await readManifest(dirs.custom);
    await removeSlotFiles(dirs.custom, owner, slot);
    await mkdir(join(dirs.custom, owner), { recursive: true });
    await writeFile(join(dirs.custom, file), data);
    const clean = parseManifest({ format: 'saki-mahjong-assets', version: 1, assets: { [owner]: { [slot]: { ...entry, file, size: data.length } } } });
    const e = clean?.assets[owner]?.[slot];
    if (!e) throw new Bad(400, '文件说明不对');
    (m.assets[owner] ??= {})[slot] = e;
    await writeManifest(dirs.custom, m);
    return { status: 200, json: { ok: true, file: `public/custom/${file}`, entry: e } };
  }
  if (req.method === 'DELETE') {
    if (owner === MUSIC) {
      await rm(join(dirs.music, `${slot}.mp3`), { force: true });
      return { status: 200, json: { ok: true } };
    }
    const m = await readManifest(dirs.custom);
    await removeSlotFiles(dirs.custom, owner, slot);
    if (m.assets[owner]) delete m.assets[owner][slot];
    await writeManifest(dirs.custom, m);
    return { status: 200, json: { ok: true } };
  }
  throw new Bad(405, '不支持');
}

export function customAssets(): Plugin {
  let dirs: CustomDirs = { custom: 'public/custom', music: 'public/music' };
  return {
    name: 'saki-custom-assets',
    configResolved(config) {
      dirs = { custom: join(config.publicDir, 'custom'), music: join(config.publicDir, 'music') };
    },
    configureServer(server) {
      server.middlewares.use('/__custom', (req: IncomingMessage, res: ServerResponse) => {
        // connect 去掉了前缀，补回来
        req.url = '/__custom' + (req.url ?? '');
        handleCustom(req, dirs)
          .then(({ status, json }) => {
            res.statusCode = status;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(json));
          })
          .catch((err: unknown) => {
            res.statusCode = err instanceof Bad ? err.status : 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
          });
      });
    },
    // 打包时项目里没有导入过素材：放一份空清单，发布的网页打开时就不会去要一个不存在的文件
    generateBundle() {
      if (!existsSync(join(dirs.custom, 'manifest.json'))) this.emitFile({ type: 'asset', fileName: 'custom/manifest.json', source: JSON.stringify(emptyManifest()) + '\n' });
    },
    // 素材页正在一个个写文件：别因为 public 里的文件变了就整页刷新
    handleHotUpdate({ file }) {
      const f = normalizePath(file);
      if (f.startsWith(normalizePath(dirs.custom)) || f.startsWith(normalizePath(dirs.music))) return [];
    },
  };
}

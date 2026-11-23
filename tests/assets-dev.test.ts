import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { handleCustom } from '../scripts/vite-custom-assets';

// 素材导入「写进项目」的本地接口：写 public/custom/ 和清单，删得掉，不收别的网页发来的请求
function req(method: string, url: string, headers: Record<string, string> = {}, data?: Uint8Array): IncomingMessage {
  const r = Readable.from(data ? [Buffer.from(data)] : []) as unknown as IncomingMessage;
  r.method = method;
  r.url = url;
  r.headers = { host: 'localhost:5173', 'x-saki-custom': '1', ...headers };
  return r;
}
const entry = (e: object) => ({ 'x-saki-entry': encodeURIComponent(JSON.stringify(e)) });

describe('素材导入：写进项目', () => {
  const root = mkdtempSync(join(tmpdir(), 'saki-custom-'));
  const dirs = { custom: join(root, 'custom'), music: join(root, 'music') };
  const manifest = () => JSON.parse(readFileSync(join(dirs.custom, 'manifest.json'), 'utf8'));

  it('写一格：文件放到 <角色>/<格子>.<扩展名>，清单记下来', async () => {
    const r = await handleCustom(req('PUT', '/__custom/file?owner=saki&slot=face', entry({ file: 'x.png', mime: 'image/png', media: 'image', w: 3, h: 4, name: '咲.png' }), new Uint8Array([1, 2, 3])), dirs);
    expect(r.status).toBe(200);
    expect([...readFileSync(join(dirs.custom, 'saki/face.png'))]).toEqual([1, 2, 3]);
    expect(manifest().assets.saki.face).toEqual({ file: 'saki/face.png', mime: 'image/png', media: 'image', size: 3, w: 3, h: 4, name: '咲.png' });
  });

  it('同一格换成别的格式：旧文件删掉', async () => {
    await handleCustom(req('PUT', '/__custom/file?owner=saki&slot=face', entry({ file: 'y.webp', mime: 'image/webp', media: 'image' }), new Uint8Array([9])), dirs);
    expect(readdirSync(join(dirs.custom, 'saki'))).toEqual(['face.webp']);
    expect(manifest().assets.saki.face.file).toBe('saki/face.webp');
  });

  it('删一格：文件和清单里的那一条都没了，空文件夹也删掉', async () => {
    await handleCustom(req('DELETE', '/__custom/file?owner=saki&slot=face'), dirs);
    expect(existsSync(join(dirs.custom, 'saki'))).toBe(false);
    expect(manifest().assets).toEqual({});
  });

  it('背景音乐写成 public/music/<格子>.mp3，不进清单', async () => {
    await handleCustom(req('PUT', '/__custom/file?owner=_music&slot=menu', entry({ file: 'a.ogg', mime: 'audio/ogg', media: 'audio' }), new Uint8Array([4])), dirs);
    expect([...readFileSync(join(dirs.music, 'menu.mp3'))]).toEqual([4]);
    expect((await handleCustom(req('GET', '/__custom/music'), dirs)).json).toEqual({ slots: ['menu'] });
  });

  it('格子名里有 .. 、扩展名不对、别的网页发来的，一律不收', async () => {
    await expect(handleCustom(req('PUT', '/__custom/file?owner=..&slot=face', entry({ file: 'a.png', mime: 'image/png', media: 'image' }), new Uint8Array([1])), dirs)).rejects.toThrow('格子名不对');
    await expect(handleCustom(req('PUT', '/__custom/file?owner=saki&slot=face', entry({ file: 'a.html', mime: 'text/html', media: 'image' }), new Uint8Array([1])), dirs)).rejects.toThrow('扩展名');
    await expect(handleCustom(req('GET', '/__custom/ping', { 'x-saki-custom': '' }), dirs)).rejects.toThrow('只认素材页');
    await expect(handleCustom(req('GET', '/__custom/ping', { origin: 'https://evil.example' }), dirs)).rejects.toThrow('只认这个开发服务器');
    expect((await handleCustom(req('GET', '/__custom/ping', { origin: 'http://localhost:5173' }), dirs)).json).toMatchObject({ ok: true });
  });
});

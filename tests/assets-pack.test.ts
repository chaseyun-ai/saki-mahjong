import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { crc32, readZip, writeZip } from '../src/assets/zip';
import { inspectGlb, sniff } from '../src/assets/sniff';
import { buildPack, readPack } from '../src/assets/pack';
import { parseManifest } from '../src/assets/slots';

const bytes = (s: string) => new TextEncoder().encode(s);

// 手搓一个用 deflate 压缩的 zip（Windows“发送到压缩文件夹”、7-Zip 打出来的就是这样）
async function deflatedZip(name: string, data: Uint8Array, utf8 = true, nameBytes?: Uint8Array): Promise<Uint8Array> {
  const comp = new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const n = nameBytes ?? bytes(name);
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, utf8 ? 0x0800 : 0, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc32(data), true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  const central = new Uint8Array(46 + n.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(8, utf8 ? 0x0800 : 0, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc32(data), true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, n.length, true);
  central.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + comp.length, true);
  const out = new Uint8Array(local.length + comp.length + central.length + end.length);
  out.set(local, 0);
  out.set(comp, local.length);
  out.set(central, local.length + comp.length);
  out.set(end, local.length + comp.length + central.length);
  return out;
}

describe('素材包：zip', () => {
  it('打包再解包，中文文件名不乱', async () => {
    const zip = writeZip([
      { name: 'manifest.json', data: bytes('{}') },
      { name: '宫永咲/立直.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    const out = await readZip(zip);
    expect(out.map((e) => e.name)).toEqual(['manifest.json', '宫永咲/立直.png']);
    expect([...out[1].data]).toEqual([1, 2, 3]);
  });

  it('读得了 deflate 压缩的包，也读得了中文 Windows 打的 GBK 文件名', async () => {
    const data = bytes('hello hello hello hello');
    expect(new TextDecoder().decode((await readZip(await deflatedZip('a/b.txt', data)))[0].data)).toBe('hello hello hello hello');
    // “咲”在 GBK 里没有，用“和”：GBK 是 BA CD
    const gbk = await readZip(await deflatedZip('', data, false, new Uint8Array([0xba, 0xcd, 0x2e, 0x70, 0x6e, 0x67])));
    expect(gbk[0].name).toBe('和.png');
  });

  it('不是 zip 的报错', async () => {
    await expect(readZip(bytes('not a zip at all, sorry'))).rejects.toThrow('不是 zip');
  });
});

describe('素材包：认文件', () => {
  it('游戏里的立绘、模型认得出来，宽高、VRM 版本读得对', () => {
    const webp = sniff(new Uint8Array(readFileSync('public/portraits/saki-neutral.webp')))!;
    expect(webp.media).toBe('image');
    expect(webp.mime).toBe('image/webp');
    expect(webp.w).toBeGreaterThan(0);
    expect(webp.h).toBeGreaterThan(webp.w!);
    const vrm = sniff(new Uint8Array(readFileSync('public/models/vroid-e.v2.glb')))!;
    expect(vrm.media).toBe('model');
    expect(vrm.ext).toBe('vrm');
    expect(vrm.model?.vrm).not.toBeNull();
    expect(vrm.model?.bones).toBeGreaterThan(10);
    const hand = sniff(new Uint8Array(readFileSync('public/models/hand-awai.glb')))!;
    expect(hand.media).toBe('model');
    expect(hand.model?.vrm).toBeNull();
    expect(hand.ext).toBe('glb');
  });

  it('试玩页的 .glb.txt（base64）解回 GLB', () => {
    const glb = new Uint8Array(readFileSync('public/models/hand-awai.glb'));
    const txt = bytes(Buffer.from(glb).toString('base64'));
    const s = sniff(txt)!;
    expect(s.decoded).toBe(true);
    expect(s.media).toBe('model');
    expect(s.bytes.length).toBe(glb.length);
    expect(inspectGlb(s.bytes)?.meshes).toBeGreaterThan(0);
  });

  it('PNG、JPEG、GIF、音频、视频的文件头', () => {
    const png = new Uint8Array(33);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 0, 0, 0, 2, 0]);
    expect(sniff(png)).toMatchObject({ media: 'image', mime: 'image/png', w: 256, h: 512 });
    const gif = bytes('GIF89a\x10\x00\x20\x00........');
    expect(sniff(gif)).toMatchObject({ media: 'image', mime: 'image/gif', w: 16, h: 32 });
    expect(sniff(bytes('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00'))?.mime).toBe('audio/mpeg');
    expect(sniff(bytes('OggS\x00\x02\x00\x00\x00\x00\x00\x00'))?.media).toBe('audio');
    expect(sniff(bytes('RIFF\x00\x00\x00\x00WAVEfmt '))?.mime).toBe('audio/wav');
    expect(sniff(bytes('\x00\x00\x00\x18ftypisom\x00\x00'))?.mime).toBe('video/mp4');
    expect(sniff(bytes('\x00\x00\x00\x18ftypM4A \x00\x00'))?.mime).toBe('audio/mp4');
    expect(sniff(bytes('just some text file'))).toBeNull();
  });
});

describe('素材包：清单', () => {
  it('打成包、读回来，格子和文件对得上', async () => {
    const zip = buildPack([
      { owner: 'saki', slot: 'face', entry: { file: 'x.webp', mime: 'image/webp', media: 'image', size: 3, w: 3, h: 4, name: '咲.webp' }, data: new Uint8Array([7, 8, 9]) },
      { owner: '_global', slot: 'hand', entry: { file: 'h.glb', mime: 'model/gltf-binary', media: 'model', size: 1 }, data: new Uint8Array([1]) },
    ]);
    const back = await readPack(zip);
    expect(back.missing).toEqual([]);
    expect(back.loose).toEqual([]);
    expect(back.files.map((f) => `${f.owner}/${f.slot}:${f.entry.file}`)).toEqual(['saki/face:saki/face.webp', '_global/hand:_global/hand.glb']);
    expect([...back.files[0].data]).toEqual([7, 8, 9]);
    expect(back.files[0].entry).toMatchObject({ w: 3, h: 4, name: '咲.webp' });
  });

  it('清单在一层文件夹里也认；清单里没有的文件当散文件', async () => {
    const zip = writeZip([
      { name: 'custom/manifest.json', data: bytes(JSON.stringify({ format: 'saki-mahjong-assets', version: 1, assets: { awai: { face: { file: 'awai/face.png', mime: 'image/png', media: 'image', size: 1 } } } })) },
      { name: 'custom/awai/face.png', data: new Uint8Array([5]) },
      { name: 'custom/extra/宫永咲-立直.png', data: new Uint8Array([6]) },
    ]);
    const back = await readPack(zip);
    expect(back.files.map((f) => f.owner + '/' + f.slot)).toEqual(['awai/face']);
    expect(back.loose.map((e) => e.name)).toEqual(['custom/extra/宫永咲-立直.png']);
  });

  it('清单里路径不对、格式不对的条目丢掉', () => {
    const m = parseManifest({
      format: 'saki-mahjong-assets',
      version: 1,
      assets: {
        saki: { face: { file: '../../etc/passwd', mime: 'image/png', media: 'image' }, win: { file: 'saki/win.png', mime: 'image/png', media: 'image', w: 'x' } },
        '../x': { face: { file: 'a.png', mime: 'image/png', media: 'image' } },
        awai: { face: { file: 'awai/face.png', mime: 'image/png', media: 'script' } },
      },
    })!;
    expect(Object.keys(m.assets)).toEqual(['saki']);
    expect(Object.keys(m.assets.saki)).toEqual(['win']);
    expect(m.assets.saki.win.w).toBeUndefined();
  });
});

import { CHARACTERS } from '../abilities/characters';
import { type CropResult, type CropSource, cropImage } from './cropper';
import { cropOf } from './guide';
import { type Target, avatarSources, placedIn } from './quickPut';
import { slotDef } from './slots';

// 睁眼特写「导入头像图」：一张头像图（或者这个人现有的头像、立绘）框住两只眼睛裁成 16:5，存进「睁眼特写」。
// 自己选的图还可以顺便当头像：接着再裁一张 3:4 的存进「头像」（这个人还没换过头像时默认勾上）。
// 素材导入页的睁眼特写格子、睁眼特写预览页（#eyes）都用它，存的方法各自传进来（save 返回存成了没有）

export type SaveSlot = (slot: 'eyes' | 'face', bytes: Uint8Array, name: string) => Promise<boolean>;

const bytesOf = async (r: CropResult): Promise<{ bytes: Uint8Array; name: string } | null> => {
  if (r.kind === 'crop') return { bytes: new Uint8Array(await r.blob.arrayBuffer()), name: r.name };
  return r.from.file ? { bytes: new Uint8Array(await r.from.file.arrayBuffer()), name: r.from.file.name } : null;
};

// 换上了哪几格：[]（取消了）、['eyes']、['eyes', 'face']
export async function importEyes(owner: string, target: Target, save: SaveSlot, picked?: File): Promise<('eyes' | 'face')[]> {
  const c = CHARACTERS.find((x) => x.id === owner);
  const eyes = slotDef(owner, 'eyes', CHARACTERS);
  const face = slotDef(owner, 'face', CHARACTERS);
  const spec = eyes && cropOf(eyes);
  if (!c || !spec) return [];
  const made: string[] = [];
  const sources: CropSource[] = [];
  if (picked) {
    const url = URL.createObjectURL(picked);
    made.push(url);
    sources.push({ label: '你选的图', url, name: picked.name, file: picked });
  }
  sources.push(...avatarSources(owner, target));
  const hasFace = !!placedIn(target, owner, 'face');
  try {
    const r = await cropImage({
      title: `${c.name} · 睁眼特写`,
      hint: `${spec.hint}。下面一排是现有的头像、立绘，也可以换一张图`,
      sources,
      ratios: spec.ratios,
      long: spec.long,
      focusY: spec.focusY,
      look: spec.look,
      color: c.color,
      skip: '不裁，原图放进去',
      extra: face ? { label: '这张图也当头像（接着再裁一张 3:4 的）', checked: !hasFace } : undefined,
    });
    if (!r) return [];
    const got = await bytesOf(r);
    if (!got || !(await save('eyes', got.bytes, got.name))) return [];
    const done: ('eyes' | 'face')[] = ['eyes'];
    // 顺便当头像：同一张图再框一下脸
    const file = r.from.file;
    const fspec = face && cropOf(face);
    if (r.extra && file && fspec) {
      const url = URL.createObjectURL(file);
      made.push(url);
      const f = await cropImage({
        title: `${c.name} · 头像`,
        hint: `睁眼特写换好了。${fspec.hint}`,
        sources: [{ label: '你选的图', url, name: file.name, file }],
        ratios: fspec.ratios,
        long: fspec.long,
        focusY: fspec.focusY,
        look: fspec.look,
        color: c.color,
        skip: '不裁，原图当头像',
        ok: '裁好了，当头像',
      });
      const fb = f && (await bytesOf(f));
      if (fb && (await save('face', fb.bytes, fb.name))) done.push('face');
    }
    return done;
  } finally {
    for (const u of made) URL.revokeObjectURL(u);
  }
}

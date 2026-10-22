"""把 VRoid 导出的 VRM 缩小到适合网页加载的大小。

贴图最大边缩到 1024（法线贴图 512），缩略图换成很小的图，其它数据原样保留。
用法：python3 scripts/shrink-vrm.py 输入.vrm 输出.glb
"""
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    b = open(path, 'rb').read()
    off = 12
    js = binc = None
    while off < len(b):
        length, kind = struct.unpack('<II', b[off:off + 8])
        chunk = b[off + 8:off + 8 + length]
        if kind == 0x4E4F534A:
            js = json.loads(chunk)
        elif kind == 0x004E4942:
            binc = chunk
        off += 8 + length
    return js, binc


def shrink(data, name, limit):
    img = Image.open(io.BytesIO(data))
    if 'Thumbnail' in name:
        img = img.resize((64, 64))
    elif max(img.size) > limit:
        s = limit / max(img.size)
        img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    else:
        return data
    out = io.BytesIO()
    img.save(out, 'PNG', optimize=True)
    return out.getvalue()


def main(src, dst):
    js, binc = read_glb(src)
    views = js['bufferViews']
    blobs = [binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]
    for im in js.get('images', []):
        name = im.get('name', '')
        limit = 512 if name.endswith('_nml') else 1024
        blobs[im['bufferView']] = shrink(blobs[im['bufferView']], name, limit)
    out = bytearray()
    for v, blob in zip(views, blobs):
        while len(out) % 4:
            out.append(0)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(blob)
        out += blob
    while len(out) % 4:
        out.append(0)
    js['buffers'] = [{'byteLength': len(out)}]
    jb = json.dumps(js, ensure_ascii=False, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A) + jb)
        f.write(struct.pack('<II', len(out), 0x004E4942) + out)
    print(dst, total // 1024, 'KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

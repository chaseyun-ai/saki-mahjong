"""把 VRoid 导出的 VRM 缩小到适合网页加载的大小。

贴图最大边缩到 1024（法线贴图 512）并转成 WebP，缩略图换成很小的图；
表情形变只存真正动了的顶点（glTF 的稀疏存储，数值一点不变）；
三角形编号和骨骼权重换成更省的存法（见 narrow_geometry）。其它数据原样保留。
已经缩过的 .glb 可以再跑一次，已经是 WebP 的贴图不会再压一遍。
用法：python3 scripts/shrink-vrm.py 输入.vrm 输出.glb
"""
import io
import json
import struct
import sys

from PIL import Image

WEBP = 'EXT_texture_webp'
WEBP_QUALITY = 90
FLOAT = 5126
UNSIGNED_SHORT = 5123
UNSIGNED_INT = 5125
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


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
    elif img.format == 'WEBP':
        return data
    out = io.BytesIO()
    # exact：透明的地方也保留原来的颜色，不然头发边缘采样时会混进别的颜色；透明度本身是无损的
    img.save(out, 'WEBP', quality=WEBP_QUALITY, method=6, exact=True)
    return out.getvalue()


def use_extension(js, name):
    for key in ('extensionsUsed', 'extensionsRequired'):
        js.setdefault(key, [])
        if name not in js[key]:
            js[key].append(name)


def webp_textures(js, blobs):
    for im in js.get('images', []):
        name = im.get('name', '')
        limit = 512 if name.endswith('_nml') else 1024
        blobs[im['bufferView']] = shrink(blobs[im['bufferView']], name, limit)
        im['mimeType'] = 'image/webp'
    for tex in js.get('textures', []):
        if 'source' in tex:
            tex.setdefault('extensions', {})[WEBP] = {'source': tex.pop('source')}
    use_extension(js, WEBP)


def sparse_targets(js, blobs):
    """表情形变大多数顶点都没动，只存动了的那些顶点的编号和位移。"""
    views = js['bufferViews']
    ids = {i for mesh in js['meshes'] for prim in mesh['primitives'] for t in prim.get('targets', []) for i in t.values()}
    for i in sorted(ids):
        acc = js['accessors'][i]
        if 'bufferView' not in acc or acc['componentType'] != FLOAT or acc['type'] != 'VEC3':
            continue
        view = views[acc['bufferView']]
        assert view.get('byteStride', 12) == 12, '形变数据不能是交错存储的'
        start = acc.get('byteOffset', 0)
        n = acc['count']
        vals = struct.unpack(f'<{n * 3}f', blobs[acc['bufferView']][start:start + n * 12])
        moved = [v for v in range(n) if vals[v * 3] or vals[v * 3 + 1] or vals[v * 3 + 2]]
        index_type, index_fmt, index_size = (UNSIGNED_SHORT, 'H', 2) if n <= 0xFFFF else (UNSIGNED_INT, 'I', 4)
        if len(moved) * (12 + index_size) >= n * 12:
            continue
        del acc['bufferView']
        acc.pop('byteOffset', None)
        if not moved:
            # 完全没动：不带数据的访问器就是全零
            continue
        indices = struct.pack(f'<{len(moved)}{index_fmt}', *moved)
        values = struct.pack(f'<{len(moved) * 3}f', *[vals[v * 3 + k] for v in moved for k in range(3)])
        acc['sparse'] = {
            'count': len(moved),
            'indices': {'bufferView': len(views), 'componentType': index_type},
            'values': {'bufferView': len(views) + 1},
        }
        views += [{'buffer': 0, 'byteLength': len(indices)}, {'buffer': 0, 'byteLength': len(values)}]
        blobs += [indices, values]


def read_accessor(js, blobs, acc, fmt, width):
    view = js['bufferViews'][acc['bufferView']]
    size = struct.calcsize('<' + fmt)
    assert view.get('byteStride', size * width) == size * width, '不支持交错存储'
    start = acc.get('byteOffset', 0)
    n = acc['count'] * width
    return struct.unpack(f'<{n}{fmt}', blobs[acc['bufferView']][start:start + n * size])


def replace_data(js, blobs, acc, data, component_type, target, **extra):
    acc['bufferView'] = len(js['bufferViews'])
    acc['componentType'] = component_type
    acc.pop('byteOffset', None)
    acc.pop('min', None)
    acc.pop('max', None)
    acc.update(extra)
    js['bufferViews'].append({'buffer': 0, 'byteLength': len(data), 'target': target})
    blobs.append(data)


def narrow_geometry(js, blobs):
    """顶点不到 65536 个时，三角形的顶点编号用 2 字节就够（原来 4 字节），一点不变；
    骨骼权重从 4 字节小数改成 2 字节定点数（精度 1/65535，看不出差别），每个顶点的权重加起来仍然正好是 1。"""
    accs = js['accessors']
    done = set()
    for mesh in js['meshes']:
        for prim in mesh['primitives']:
            i = prim.get('indices')
            verts = accs[prim['attributes']['POSITION']]['count']
            if i is not None and i not in done and accs[i]['componentType'] == UNSIGNED_INT and verts <= 0xFFFF:
                done.add(i)
                vals = read_accessor(js, blobs, accs[i], 'I', 1)
                replace_data(js, blobs, accs[i], struct.pack(f'<{len(vals)}H', *vals), UNSIGNED_SHORT, ELEMENT_ARRAY_BUFFER)
            w = prim['attributes'].get('WEIGHTS_0')
            if w is not None and w not in done and accs[w]['componentType'] == FLOAT:
                done.add(w)
                vals = read_accessor(js, blobs, accs[w], 'f', 4)
                out = []
                for v in range(accs[w]['count']):
                    q = [round(x * 65535) for x in vals[v * 4:v * 4 + 4]]
                    if sum(q):
                        q[q.index(max(q))] += 65535 - sum(q)
                    out += q
                replace_data(js, blobs, accs[w], struct.pack(f'<{len(out)}H', *out), UNSIGNED_SHORT, ARRAY_BUFFER, normalized=True)


def drop_unused_views(js, blobs):
    refs = []
    for acc in js['accessors']:
        if 'bufferView' in acc:
            refs.append((acc, 'bufferView'))
        if 'sparse' in acc:
            refs += [(acc['sparse']['indices'], 'bufferView'), (acc['sparse']['values'], 'bufferView')]
    refs += [(im, 'bufferView') for im in js.get('images', []) if 'bufferView' in im]
    used = sorted({o[k] for o, k in refs})
    remap = {old: new for new, old in enumerate(used)}
    for o, k in refs:
        o[k] = remap[o[k]]
    js['bufferViews'] = [js['bufferViews'][i] for i in used]
    return [blobs[i] for i in used]


def write_glb(dst, js, blobs):
    out = bytearray()
    for v, blob in zip(js['bufferViews'], blobs):
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


def main(src, dst):
    js, binc = read_glb(src)
    blobs = [binc[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in js['bufferViews']]
    webp_textures(js, blobs)
    sparse_targets(js, blobs)
    narrow_geometry(js, blobs)
    blobs = drop_unused_views(js, blobs)
    write_glb(dst, js, blobs)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

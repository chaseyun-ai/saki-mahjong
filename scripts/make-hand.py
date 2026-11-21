"""从 VRoid 的 VRM 里把右手（前臂到指尖）单独抠出来，细分一次，存成一个小的 .glb：特写镜头用的手模。

- 只留蒙皮主要跟着右前臂、手掌、五指的三角形（皮肤一份、袖子一份），带骨骼和权重：
  前臂 → 手掌 → 拇指、食指、中指、无名指、小指各三节，一共 17 根骨头。VRoid 的骨头在绑定姿势里都不带旋转，
  所以抠出来以后每根骨头的本地坐标轴就是模型的坐标轴：手臂沿 +X 伸出去，手背朝 +Y，拇指朝 -Z。
- 手腕（手掌那根骨头）挪到原点。
- Loop 细分一次（位置按细分规则抹圆，贴图坐标、骨骼权重取两头的平均），法线重新算。原模型一只手一千来个三角形，
  凑近了看指节是折的；细分以后四千多个，轮廓是圆的。
- 贴图只留用到的那一块，缩到 512 以内，存成 JPEG / PNG 嵌在文件里。

用法：python3 scripts/make-hand.py public/models/vroid-g.glb public/models/hand-awai.glb
"""
import io
import json
import struct
import sys

import numpy as np
from PIL import Image

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
# 骨头的顺序（父在前）：名字里 J_Bip_R_ 后面的部分，父骨头的下标
BONES = [('LowerArm', -1), ('Hand', 0)]
for finger in ('Thumb', 'Index', 'Middle', 'Ring', 'Little'):
    for k in (1, 2, 3):
        BONES.append((f'{finger}{k}', 1 if k == 1 else len(BONES) - 1))
# 前臂只留靠手腕的这一段（占前臂长度的几成），再往上在镜头外面
FOREARM_KEEP = 0.8


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


def accessor(js, binc, i):
    a = js['accessors'][i]
    bv = js['bufferViews'][a['bufferView']]
    fmt, size = CT[a['componentType']]
    n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', size * n)
    dt = np.dtype('<' + fmt)
    if stride == size * n:
        return np.frombuffer(binc, dt, a['count'] * n, off).reshape(a['count'], n).copy()
    out = np.zeros((a['count'], n), dt)
    for k in range(a['count']):
        out[k] = np.frombuffer(binc, dt, n, off + k * stride)
    return out


def world_positions(js):
    nodes = js['nodes']
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    out = {}

    def pos(i):
        if i in out:
            return out[i]
        n = nodes[i]
        assert 'matrix' not in n and n.get('rotation', [0, 0, 0, 1])[3] > 0.9999, f'{n.get("name")} 带旋转'
        t = np.array(n.get('translation', [0, 0, 0]), float)
        out[i] = t + (pos(parent[i]) if i in parent else 0)
        return out[i]

    return [pos(i) for i in range(len(nodes))]


def loop_subdivide(P, tris):
    """P：焊接过的顶点位置；tris：三角形（顶点下标）。返回 (新位置, 每条边的中点下标 {(a,b): i}, 新三角形)"""
    edges = {}
    for t in tris:
        for a, b, c in ((t[0], t[1], t[2]), (t[1], t[2], t[0]), (t[2], t[0], t[1])):
            edges.setdefault((min(a, b), max(a, b)), []).append(c)
    n = len(P)
    neigh = [set() for _ in range(n)]
    border = [set() for _ in range(n)]
    for (a, b), opp in edges.items():
        neigh[a].add(b)
        neigh[b].add(a)
        if len(opp) == 1:
            border[a].add(b)
            border[b].add(a)
    even = np.zeros_like(P)
    for v in range(n):
        if len(border[v]) == 2:
            a, b = border[v]
            even[v] = 0.75 * P[v] + 0.125 * (P[a] + P[b])
        elif border[v]:
            even[v] = P[v]
        else:
            k = len(neigh[v])
            beta = 3 / 16 if k == 3 else 3 / (8 * k)
            even[v] = (1 - k * beta) * P[v] + beta * sum(P[u] for u in neigh[v])
    mid = {}
    odd = []
    for (a, b), opp in edges.items():
        mid[(a, b)] = n + len(odd)
        if len(opp) == 2:
            odd.append(0.375 * (P[a] + P[b]) + 0.125 * (P[opp[0]] + P[opp[1]]))
        else:
            odd.append(0.5 * (P[a] + P[b]))
    return np.vstack([even, np.array(odd)]), mid


def build(js, binc, prim_ids, image_index, keep_vertex):
    """把几个 primitive（共用一份顶点）里留下的三角形合起来细分。返回顶点属性和三角形"""
    mesh = js['meshes'][MESH]
    p0 = mesh['primitives'][prim_ids[0]]
    P = accessor(js, binc, p0['attributes']['POSITION']).astype(float)
    UV = accessor(js, binc, p0['attributes']['TEXCOORD_0']).astype(float)
    J = accessor(js, binc, p0['attributes']['JOINTS_0'])
    W = accessor(js, binc, p0['attributes']['WEIGHTS_0']).astype(float)
    tris = np.vstack([accessor(js, binc, mesh['primitives'][i]['indices']).reshape(-1, 3) for i in prim_ids])
    tris = tris[keep_vertex[tris].all(1)]
    # 权重摊到 17 根骨头上（不在里面的骨头——上臂、摆动骨——算给前臂）
    full = np.zeros((len(P), len(BONES)))
    for k in range(4):
        np.add.at(full, (np.arange(len(P)), JOINT_MAP[J[:, k]]), W[:, k])
    # 焊接：位置一样的顶点（贴图接缝两边）算同一个
    used = np.unique(tris)
    key = {}
    weld = {}
    for v in used:
        k = tuple(np.round(P[v], 6))
        weld[v] = key.setdefault(k, len(key))
    WP = np.zeros((len(key), 3))
    for v in used:
        WP[weld[v]] = P[v]
    wtris = np.array([[weld[v] for v in t] for t in tris])
    SP, mid = loop_subdivide(WP, wtris)
    # 细分以后的角点：(焊接后的位置下标, 贴图坐标, 权重) 一样的合成一个顶点
    verts = {}
    pos, uv, wt = [], [], []

    def corner(wp, a, b=None):
        k = (wp, a, b)
        if k not in verts:
            verts[k] = len(pos)
            pos.append(SP[wp])
            uv.append(UV[a] if b is None else (UV[a] + UV[b]) / 2)
            wt.append(full[a] if b is None else (full[a] + full[b]) / 2)
        return verts[k]

    out = []
    for t, w in zip(tris, wtris):
        c = [corner(w[i], t[i]) for i in range(3)]
        m = []
        for i in range(3):
            a, b = i, (i + 1) % 3
            lo, hi = (t[a], t[b]) if t[a] < t[b] else (t[b], t[a])
            m.append(corner(mid[(min(w[a], w[b]), max(w[a], w[b]))], lo, hi))
        out += [[c[0], m[0], m[2]], [c[1], m[1], m[0]], [c[2], m[2], m[1]], [m[0], m[1], m[2]]]
    pos, uv, wt, out = np.array(pos), np.array(uv), np.array(wt), np.array(out)
    # 法线：按焊接后的位置算（接缝两边一样），面积加权
    wid = np.array([k[0] for k in verts])
    nrm = np.zeros((len(SP), 3))
    fn = np.cross(pos[out[:, 1]] - pos[out[:, 0]], pos[out[:, 2]] - pos[out[:, 0]])
    for i in range(3):
        np.add.at(nrm, wid[out[:, i]], fn)
    nrm /= np.maximum(1e-12, np.linalg.norm(nrm, axis=1, keepdims=True))
    # 每个顶点留最重的 4 根骨头
    order = np.argsort(-wt, axis=1)[:, :4]
    w4 = np.take_along_axis(wt, order, 1)
    w4 /= w4.sum(1, keepdims=True)
    # 贴图：只留用到的那一块
    img = js['images'][image_index]
    bv = js['bufferViews'][img['bufferView']]
    tex = Image.open(io.BytesIO(binc[bv.get('byteOffset', 0):bv.get('byteOffset', 0) + bv['byteLength']])).convert('RGB')
    pad = 0.01
    lo = np.clip(uv.min(0) - pad, 0, 1)
    hi = np.clip(uv.max(0) + pad, 0, 1)
    box = (int(lo[0] * tex.width), int(lo[1] * tex.height), int(np.ceil(hi[0] * tex.width)), int(np.ceil(hi[1] * tex.height)))
    crop = tex.crop(box)
    if max(crop.size) > 512:
        s = 512 / max(crop.size)
        crop = crop.resize((max(1, round(crop.width * s)), max(1, round(crop.height * s))), Image.LANCZOS)
    uv2 = (uv - [box[0] / tex.width, box[1] / tex.height]) / [(box[2] - box[0]) / tex.width, (box[3] - box[1]) / tex.height]
    buf = io.BytesIO()
    crop.save(buf, 'JPEG', quality=92)
    return {'pos': pos, 'nrm': nrm[wid], 'uv': uv2, 'joints': order.astype(np.uint8), 'weights': w4, 'tris': out, 'image': buf.getvalue()}


def main(src, dst):
    global MESH, JOINT_MAP
    js, binc = read_glb(src)
    names = [n.get('name') for n in js['nodes']]
    MESH = next(i for i, m in enumerate(js['meshes']) if m['name'].startswith('Body'))
    skin = js['skins'][next(n['skin'] for n in js['nodes'] if n.get('mesh') == MESH)]
    world = world_positions(js)
    bone_node = [names.index(f'J_Bip_R_{b}') for b, _ in BONES]
    wrist = world[bone_node[1]]
    # 蒙皮里的每根骨头算给 17 根里的哪一根：不是右手的算 -1
    jm = []
    for j in skin['joints']:
        n = names[j] or ''
        if j in bone_node:
            jm.append(bone_node.index(j))
        elif n == 'J_Sec_R_LowerArm':
            jm.append(0)
        else:
            jm.append(-1)
    JOINT_MAP = np.array(jm)
    mesh = js['meshes'][MESH]
    p0 = mesh['primitives'][0]
    P = accessor(js, binc, p0['attributes']['POSITION']).astype(float)
    J = accessor(js, binc, p0['attributes']['JOINTS_0'])
    W = accessor(js, binc, p0['attributes']['WEIGHTS_0'])
    dom = JOINT_MAP[J[np.arange(len(J)), W.argmax(1)]]
    elbow = world[bone_node[0]]
    along = (P - elbow) @ (wrist - elbow) / np.dot(wrist - elbow, wrist - elbow)
    keep = (dom >= 0) & (along > 1 - FOREARM_KEEP)
    JOINT_MAP = np.where(JOINT_MAP < 0, 0, JOINT_MAP)
    mat_name = lambda p: js['materials'][p['material']]['name']
    image_of = lambda p: js['textures'][js['materials'][p['material']]['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
    parts = []
    for tag in ('SKIN', 'Onepice'):
        ids = [i for i, p in enumerate(mesh['primitives']) if tag in mat_name(p)]
        if ids:
            part = build(js, binc, ids, image_of(mesh['primitives'][ids[0]]), keep)
            part['name'] = 'skin' if tag == 'SKIN' else 'sleeve'
            if len(part['tris']):
                parts.append(part)
    # 写 glb
    chunks = []
    views = []
    accessors = []

    def view(data, target=None):
        off = sum(len(c) for c in chunks)
        chunks.append(data + b'\0' * (-len(data) % 4))
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), **({'target': target} if target else {})})
        return len(views) - 1

    def acc(arr, ctype, kind, target=None, minmax=False):
        arr = np.ascontiguousarray(arr)
        a = {'bufferView': view(arr.tobytes(), target), 'componentType': ctype, 'count': len(arr), 'type': kind}
        if minmax:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    bone_pos = [world[n] - wrist for n in bone_node]
    nodes = []
    for i, (name, parent) in enumerate(BONES):
        t = bone_pos[i] - (bone_pos[parent] if parent >= 0 else 0)
        nodes.append({'name': name, 'translation': [float(x) for x in t], 'children': [k for k, (_, p) in enumerate(BONES) if p == i]})
        if not nodes[-1]['children']:
            del nodes[-1]['children']
    ibm = np.tile(np.eye(4, dtype=np.float32), (len(BONES), 1, 1))
    for i in range(len(BONES)):
        ibm[i, 3, :3] = -bone_pos[i]
    skin_out = {'joints': list(range(len(BONES))), 'skeleton': 0, 'inverseBindMatrices': acc(ibm.reshape(-1, 16), 5126, 'MAT4')}
    prims, materials, textures, images = [], [], [], []
    for part in parts:
        images.append({'bufferView': view(part['image']), 'mimeType': 'image/jpeg'})
        textures.append({'source': len(images) - 1})
        materials.append({'name': part['name'], 'pbrMetallicRoughness': {'baseColorTexture': {'index': len(textures) - 1}, 'metallicFactor': 0, 'roughnessFactor': 1}})
        prims.append({
            'attributes': {
                'POSITION': acc((part['pos'] - wrist).astype(np.float32), 5126, 'VEC3', 34962, True),
                'NORMAL': acc(part['nrm'].astype(np.float32), 5126, 'VEC3', 34962),
                'TEXCOORD_0': acc(part['uv'].astype(np.float32), 5126, 'VEC2', 34962),
                'JOINTS_0': acc(part['joints'], 5121, 'VEC4', 34962),
                'WEIGHTS_0': acc(part['weights'].astype(np.float32), 5126, 'VEC4', 34962),
            },
            'indices': acc(part['tris'].astype(np.uint16).reshape(-1, 1), 5123, 'SCALAR', 34963),
            'material': len(materials) - 1,
        })
        print(part['name'], '顶点', len(part['pos']), '三角形', len(part['tris']), '贴图', len(part['image']), '字节')
    nodes.append({'name': 'hand', 'mesh': 0, 'skin': 0})
    out = {
        'asset': {'version': '2.0', 'generator': 'make-hand.py'},
        'scene': 0,
        'scenes': [{'nodes': [0, len(nodes) - 1]}],
        'nodes': nodes,
        'meshes': [{'name': 'hand', 'primitives': prims}],
        'skins': [skin_out],
        'materials': materials,
        'textures': textures,
        'images': images,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987}],
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': sum(len(c) for c in chunks)}],
    }
    for t in textures:
        t['sampler'] = 0
    binary = b''.join(chunks)
    text = json.dumps(out, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(binary)))
        f.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
        f.write(struct.pack('<II', len(binary), 0x004E4942) + binary)
    print(dst, 12 + 16 + len(text) + len(binary), '字节；骨头', [b for b, _ in BONES])
    print('骨头位置（手腕在原点）', {b: [round(float(x), 4) for x in bone_pos[i]] for i, (b, _) in enumerate(BONES)})


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])

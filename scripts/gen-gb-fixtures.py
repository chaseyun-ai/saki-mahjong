# 生成国标算番的标准答案 tests/fixtures/gb-fan.json，tests/gb-fan.test.ts 拿它逐手对 src/engine/gbFan.ts。
# 裁判是 PyMahjongGB（pip install PyMahjongGB，北大 AI 实验室为 Botzone 做的国标算番库）。只在离线跑，不进游戏，也不搬它的代码。
# 用法：python scripts/gen-gb-fixtures.py > tests/fixtures/gb-fan.json
# 一手牌一行数组：[门内牌, 副露, 和了牌, 标记, 门风, 圈风, 合计番数, 番种]
#   牌种 0–33 写成一个 base36 字符（0–8 万、9–h 筒、i–q 索、r–u 东南西北、v–x 白发中）
#   副露每组两个字符：c 吃（写最小的那张）、p 碰、m 明杠、a 暗杠，后面跟牌种
#   标记：t 自摸、f 和绝张、k 杠（自摸是杠上开花，荣和是抢杠和）、l 海底（自摸是妙手回春，荣和是海底捞月）
#   番种：“名字×个数”用空格隔开；边张、坎张、单钓将用 PyMahjongGB 的写法“独听・边张”等
import json, random, sys
from MahjongGB import MahjongFanCalculator

def gb(k):
    if k < 9: return f'W{k+1}'
    if k < 18: return f'B{k-8}'
    if k < 27: return f'T{k-17}'
    if k < 31: return f'F{k-26}'
    return {31: 'J3', 32: 'J2', 33: 'J1'}[k]

def K(s, r): return s * 9 + r - 1
CHOWS = [K(s, r) for s in range(3) for r in range(1, 8)]

def rand_set(rng, style):
    honors = style.get('honors', 0.15)
    chow_p = style.get('chow', 0.55)
    suits = style.get('suits', [0, 1, 2])
    if rng.random() < chow_p:
        s = rng.choice(suits); r = rng.randint(1, 7)
        if style.get('terminal') and rng.random() < 0.6: r = rng.choice([1, 7])
        return ('chow', K(s, r))
    if rng.random() < honors:
        return ('pung', rng.randint(27, 33))
    s = rng.choice(suits); r = rng.randint(1, 9)
    if style.get('terminal') and rng.random() < 0.6: r = rng.choice([1, 9])
    return ('pung', K(s, r))

def rand_pair(rng, style):
    if rng.random() < style.get('honors', 0.15): return rng.randint(27, 33)
    s = rng.choice(style.get('suits', [0, 1, 2])); return K(s, rng.randint(1, 9))

FAMILIES = []
perms = [(0,1,2),(0,2,1),(1,0,2),(1,2,0),(2,0,1),(2,1,0)]
for a,b,c in perms:
    FAMILIES.append([('chow',K(a,1)),('chow',K(b,4)),('chow',K(c,7))])  # 花龙
    for st in range(1,6): FAMILIES.append([('chow',K(a,st)),('chow',K(b,st+1)),('chow',K(c,st+2))])  # 三色三步高
    for st in range(1,8): FAMILIES.append([('chow',K(a,st)),('chow',K(b,st)),('chow',K(c,st))])  # 三色三同顺
    for st in range(1,8): FAMILIES.append([('pung',K(a,st)),('pung',K(b,st+1)),('pung',K(c,st+2))])  # 三色三节高
for s in range(3):
    for st in range(1,6): FAMILIES.append([('chow',K(s,st+i)) for i in range(3)])
    for st in range(1,4): FAMILIES.append([('chow',K(s,st+2*i)) for i in range(3)])
    for st in range(1,8): FAMILIES.append([('pung',K(s,st+i)) for i in range(3)])
    for st in range(1,8): FAMILIES.append([('chow',K(s,st))]*3)
    FAMILIES.append([('chow',K(s,1)),('chow',K(s,4)),('chow',K(s,7))])
    FAMILIES.append([('chow',K(s,1)),('chow',K(s,1)),('chow',K(s,7)),('chow',K(s,7))])
for r in range(1,10): FAMILIES.append([('pung',K(s,r)) for s in range(3)])

def tiles_of(sets):
    out = []
    for t, k in sets:
        if t == 'chow': out += [k, k+1, k+2]
        elif t == 'pung': out += [k]*3
    return out

def make_standard(rng):
    style = rng.choice([
        {}, {'chow': 0.9}, {'chow': 0.95, 'honors': 0}, {'chow': 0.1, 'honors': 0.3},
        {'suits': [rng.randint(0,2)], 'honors': 0.2}, {'suits': [rng.randint(0,2)], 'honors': 0, 'chow': 0.7},
        {'terminal': True, 'honors': 0.3}, {'honors': 0.6, 'chow': 0.2}, {'chow': 0.0, 'honors': 0.15},
    ])
    if rng.random() < 0.35:
        sets = list(rng.choice(FAMILIES))
    else:
        sets = []
    while len(sets) < 4: sets.append(rand_set(rng, style))
    sets = sets[:4]
    pair = rand_pair(rng, style)
    if rng.random() < 0.2 and style.get('suits') is None: pair = K(rng.randint(0,2), 5)
    cnt = [0]*34
    for k in tiles_of(sets) + [pair, pair]: cnt[k] += 1
    if max(cnt) > 4: return None
    # 副露：0–3 组，偏向 0
    nm = rng.choice([0,0,0,0,1,1,2,3])
    order = list(range(4)); rng.shuffle(order)
    melds = []; closed_sets = []
    kong_kinds = []
    for idx, i in enumerate(order):
        t, k = sets[i]
        if idx < nm:
            melds.append((t, k))
        else:
            closed_sets.append((t, k))
    packs = []; meld_json = []
    used = [0]*34
    for t, k in melds:
        if t == 'chow':
            packs.append(('CHI', gb(k+1), rng.randint(1,3))); meld_json.append({'type': 'chi', 'kind': k})
        else:
            if cnt[k] == 3 and rng.random() < 0.25:
                offer = rng.randint(1,3)
                packs.append(('GANG', gb(k), offer)); meld_json.append({'type': 'minkan', 'kind': k}); cnt[k] += 1
            else:
                packs.append(('PENG', gb(k), rng.randint(1,3))); meld_json.append({'type': 'pon', 'kind': k})
    # 门内的刻子偶尔变暗杠
    hand_sets = []
    for t, k in closed_sets:
        if t == 'pung' and cnt[k] == 3 and rng.random() < 0.12:
            packs.append(('GANG', gb(k), 0)); meld_json.append({'type': 'ankan', 'kind': k}); cnt[k] += 1
        else:
            hand_sets.append((t, k))
    if max(cnt) > 4: return None
    hand = tiles_of(hand_sets) + [pair, pair]
    win = rng.choice(hand)
    return meld_json, packs, hand, win

def make_chiitoi(rng):
    if rng.random() < 0.15:
        s = rng.randint(0,2); st = rng.randint(1,3)
        kinds = [K(s, st+i) for i in range(7)]
    else:
        pool = list(range(34))
        if rng.random() < 0.5: pool = [k for k in pool if k < 27 and (k//9) == rng.randint(0,2)] + [k for k in range(27,34) if rng.random()<0.5]
        if len(pool) < 7: pool = list(range(34))
        kinds = rng.sample(pool, 7)
        if rng.random() < 0.15:  # 四归一式的七对
            kinds[1] = kinds[0]
    hand = []
    for k in kinds: hand += [k, k]
    cnt = [0]*34
    for k in hand: cnt[k] += 1
    if max(cnt) > 4: return None
    return [], [], hand, rng.choice(hand)

def make_kokushi(rng):
    y = [0,8,9,17,18,26,27,28,29,30,31,32,33]
    hand = y + [rng.choice(y)]
    return [], [], hand, rng.choice(hand)

def build(rng, sets, pair, melds_n=None, force_ron=None):
    cnt = [0]*34
    for t, k in sets:
        for x in ([k, k+1, k+2] if t == 'chow' else [k]*3): cnt[x] += 1
    cnt[pair] += 2
    if max(cnt) > 4: return None
    nm = rng.choice([0,0,1,2]) if melds_n is None else melds_n
    order = list(range(4)); rng.shuffle(order)
    packs, mj, hand = [], [], [pair, pair]
    for idx, i in enumerate(order):
        t, k = sets[i]
        if idx < nm:
            if t == 'chow': packs.append(('CHI', gb(k+1), rng.randint(1,3))); mj.append({'type':'chi','kind':k})
            elif cnt[k] == 3 and rng.random() < 0.2:
                packs.append(('GANG', gb(k), rng.randint(1,3))); mj.append({'type':'minkan','kind':k}); cnt[k] += 1
            else: packs.append(('PENG', gb(k), rng.randint(1,3))); mj.append({'type':'pon','kind':k})
        else:
            hand += [k, k+1, k+2] if t == 'chow' else [k]*3
    win = rng.choice(hand)
    tsumo = (rng.random() < 0.5) if force_ron is None else not force_ron
    return mj, packs, hand, win, tsumo

def gen_special(rng, kind):
    pung = lambda k: ('pung', k)
    if kind == 'bigwinds':
        sets = [pung(k) for k in (27,28,29,30)]; pair = rng.choice([k for k in range(34) if k < 27 or k >= 31])
    elif kind == 'smallwinds':
        w = [27,28,29,30]; rng.shuffle(w)
        other = pung(rng.randint(0,33)) if rng.random()<0.5 else ('chow', K(rng.randint(0,2), rng.randint(1,7)))
        sets = [pung(w[0]), pung(w[1]), pung(w[2]), other]; pair = w[3]
    elif kind == 'bigdragons':
        sets = [pung(31), pung(32), pung(33), pung(rng.randint(0,30)) if rng.random()<0.5 else ('chow', K(rng.randint(0,2), rng.randint(1,7)))]
        pair = rng.randint(0, 30)
    elif kind == 'smalldragons':
        d = [31,32,33]; rng.shuffle(d)
        sets = [pung(d[0]), pung(d[1])] + [pung(rng.randint(0,30)) if rng.random()<0.4 else ('chow', K(rng.randint(0,2), rng.randint(1,7))) for _ in range(2)]
        pair = d[2]
    elif kind == 'honors':
        ks = rng.sample(range(27,34), 5); sets = [pung(k) for k in ks[:4]]; pair = ks[4]
    elif kind == 'terminals':
        t = [0,8,9,17,18,26]; ks = rng.sample(t, 5); sets = [pung(k) for k in ks[:4]]; pair = ks[4]
    elif kind == 'mixedterm':
        t = [0,8,9,17,18,26] + list(range(27,34)); ks = rng.sample(t, 5); sets = [pung(k) for k in ks[:4]]; pair = ks[4]
    elif kind == 'green':
        opts = [('chow', 19), pung(19), pung(20), pung(21), pung(23), pung(25), pung(32)]
        sets = [rng.choice(opts) for _ in range(4)]; pair = rng.choice([19,20,21,23,25,32])
    elif kind == 'melded':
        sets = [pung(rng.randint(0,33)) if rng.random()<0.5 else ('chow', K(rng.randint(0,2), rng.randint(1,7))) for _ in range(4)]
        pair = rng.randint(0,33)
        return build(rng, sets, pair, melds_n=4, force_ron=rng.random()<0.8)
    elif kind == 'chicken':
        sets = [pung(rng.randint(0,33)) if rng.random()<0.3 else ('chow', K(rng.randint(0,2), rng.randint(1,7))) for _ in range(4)]
        pair = rng.randint(0,33)
        return build(rng, sets, pair, melds_n=rng.choice([1,2,3]), force_ron=True)
    elif kind == 'gates':
        s = rng.randint(0,2); base = [K(s,1)]*3 + [K(s,r) for r in range(2,9)] + [K(s,9)]*3
        x = K(s, rng.randint(1,9)); hand = base + [x]
        win = x if rng.random() < 0.8 else rng.choice(hand)
        return [], [], hand, win, rng.random() < 0.5
    return build(rng, sets, pair)


B36 = '0123456789abcdefghijklmnopqrstuvwx'
MT = {'chi': 'c', 'pon': 'p', 'minkan': 'm', 'ankan': 'a'}

def compact(h):
    flags = ('t' if h['tsumo'] else '') + ('f' if h['fourth'] else '') + ('k' if h['kong'] else '') + ('l' if h['last'] else '')
    return [''.join(B36[k] for k in h['hand']), ''.join(MT[m['type']] + B36[m['kind']] for m in h['melds']), B36[h['win']], flags,
            h['seat'], h['round'], h['total'], ' '.join(f'{n}×{c}' for n, p, c in h['fans'])]

def run(rng, n, make, out):
    tries = 0; got = 0
    while got < n and tries < n * 200:
        tries += 1
        h = make(rng)
        if h is None: continue
        meld_json, packs, hand, win, tsumo, fourth, kong, last = h
        seat, rnd = rng.randint(0,3), rng.randint(0,3)
        h13 = list(hand); h13.remove(win)
        try:
            res = MahjongFanCalculator(tuple(packs), tuple(gb(k) for k in h13), gb(win), 0, tsumo, fourth, kong, last, seat, rnd, True)
        except Exception:
            continue
        fans = [[nm, p, c] for p, c, nm, _ in res]
        out.append({'melds': meld_json, 'hand': sorted(hand), 'win': win, 'tsumo': tsumo, 'fourth': fourth, 'kong': kong,
                    'last': last, 'seat': seat, 'round': rnd, 'fans': fans, 'total': sum(p * c for _, p, c in fans)})
        got += 1

def general(rng):
    r = rng.random()
    h = make_kokushi(rng) if r < 0.01 else make_chiitoi(rng) if r < 0.09 else make_standard(rng)
    if h is None: return None
    meld_json, packs, hand, win = h
    tsumo = rng.random() < 0.5
    fourth = rng.random() < 0.08
    has_kong = any(m['type'] in ('minkan', 'ankan') for m in meld_json)
    kong = (tsumo and has_kong and rng.random() < 0.3) or ((not tsumo) and rng.random() < 0.04)
    last = rng.random() < 0.06 and not kong
    return meld_json, packs, hand, win, tsumo, fourth, kong, last

KINDS = ['bigwinds','smallwinds','bigdragons','smalldragons','honors','terminals','mixedterm','green','melded','gates']

def special(rng):
    h = gen_special(rng, rng.choice(KINDS))
    if h is None: return None
    mj, packs, hand, win, tsumo = h
    return mj, packs, hand, win, tsumo, False, False, False

def main():
    rng = random.Random(7)
    out = []
    run(rng, 2000, general, out)
    run(rng, 400, special, out)
    sys.stdout.write('[\n' + ',\n'.join(json.dumps(compact(h), ensure_ascii=False, separators=(',', ':')) for h in out) + '\n]\n')

main()

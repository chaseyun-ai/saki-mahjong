#!/usr/bin/env python3
"""像素皮肤用的像素字（src/pixel/saki-pixel-12.woff2）怎么做出来的。

字体来源：Fusion Pixel 12px Proportional SC（TakWolf，SIL Open Font License 1.1，
https://github.com/TakWolf/fusion-pixel-font ，npm 上 @fontsource/fusion-pixel-12px-proportional-sc 那个包里的
files/fusion-pixel-12px-proportional-sc-latin-400-normal.woff2 就是整套字）。

只留游戏里用得到的字：src 下所有 .ts、.css 和 index.html 里出现的字，ASCII，常用标点，再加 GB2312 一级汉字
（玩家自己起的名字、导入的素材名大多也在里面），一共约 4000 字、120 KB 左右。
OFL 规定改过的字体不能再用保留字体名（Reserved Font Name：'Fusion Pixel'），所以改名叫 Saki Pixel 12；
版权声明（name 表第 0 条）和许可照原样留着，许可全文见 THIRD_PARTY_NOTICES.md。

用法（要先 pip install fonttools brotli）：
  python3 scripts/make-pixel-font.py 下载的字体.woff2 [输出路径]
"""

import glob
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAMILY = 'Saki Pixel 12'
PS_NAME = 'SakiPixel12-Regular'


def wanted_chars() -> str:
    text = ''
    files = glob.glob(os.path.join(ROOT, 'src', '**', '*.ts'), recursive=True)
    files += glob.glob(os.path.join(ROOT, 'src', '**', '*.css'), recursive=True)
    files.append(os.path.join(ROOT, 'index.html'))
    for p in files:
        with open(p, encoding='utf-8') as f:
            text += f.read()
    chars = {c for c in text if ord(c) > 127}
    chars |= {chr(i) for i in range(32, 127)}
    chars |= set('，。、；：？！“”‘’（）《》【】…—·～￥×±')
    # GB2312 一级汉字（0xB0A1–0xD7F9）
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode('gb2312'))
            except UnicodeDecodeError:
                pass
    return ''.join(sorted(chars))


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'src', 'pixel', 'saki-pixel-12.woff2')
    font = TTFont(src)
    opts = subset.Options()
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.name_legacy = True
    opts.name_languages = ['*']
    opts.flavor = 'woff2'
    sub = subset.Subsetter(opts)
    sub.populate(text=wanted_chars())
    sub.subset(font)
    # 改名：家族名、全名、PostScript 名、唯一标识都不再带保留字体名；版权声明（0）、许可（13、14）不动
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID in (2, 17):
            rec.string = 'Regular'
        elif rec.nameID == 4:
            rec.string = f'{FAMILY} Regular'
        elif rec.nameID == 6:
            rec.string = PS_NAME
        elif rec.nameID == 3:
            rec.string = f'{PS_NAME};saki-mahjong subset'
    if 'CFF ' in font:
        cff = font['CFF '].cff
        cff.fontNames = [PS_NAME]
        top = cff.topDictIndex[0]
        top.FamilyName = FAMILY
        top.FullName = f'{FAMILY} Regular'
    font.flavor = 'woff2'
    font.save(out)
    print(f'{out}: {os.path.getsize(out)} bytes, {len(font.getGlyphOrder())} glyphs')


if __name__ == '__main__':
    main()

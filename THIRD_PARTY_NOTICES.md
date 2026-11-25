# Third-party notices

## Ultra Elements

https://github.com/Humpalumps/ultra-elements

Hatsumi's purple whirlwind (`src/ui3d/gale.ts`) follows techniques from Ultra Elements' `src/vfx/Ribbons.js` and `src/vfx/Shockwaves.js`: analytic ribbons whose centreline is evaluated per vertex in the vertex shader and expanded towards the camera, the "phone-wire" rule that a strip thinner than 1.5 px dims instead of thinning, and a blast-wave (r ∝ t^0.4) shock ring. The table's general effects (`src/ui3d/effects.ts`) and the 2D call/win effects (`src/ui/style.css`) follow more of its techniques: the ground shock profile with a sharp leading edge and a soft wake from `Shockwaves.js`; velocity-stretched additive sparks that cool from white-hot, with drag and gravity evaluated analytically, from the glow particles in `src/vfx/Particles.js`; the fractal lightning path (Reed & Wyvill 1994), stepped leader, return stroke, restrikes on the same channel with new branches and a cooling, beading residual channel from `src/vfx/Bolts.js` and `src/spells/lightning.js`. The code was rewritten for this project.

Teru's whirlwind tsumo (`src/ui3d/twister.ts`, with the small crackling arcs added to `src/ui3d/effects.ts` as `Effects.arc`) uses the same techniques: camera-facing analytic ribbons evaluated per vertex (`Ribbons.js`, with the thin-line dimming rule) for the tornado's wind bands, wisps and halo rings; the fractal lightning path and its flicker and beading residual channel (`Bolts.js`) for the arcs; and debris thrown out on an analytic ballistic path. The code was rewritten for this project.

The water on the table (`src/ui3d/water.ts`: Toka's still water and Koromo's rising sea) follows Ultra Elements' water in `src/scene/pool.js`, `src/spells/water.js` and `src/vfx/Refraction.js`: a GPU ripple height field (height plus velocity per texel, four-neighbour Laplacian, drops stamped into it); surface normals from the height-field slope; a Schlick Fresnel (f0 = 0.02) mix of a sky gradient, a planar mirror and the refracted floor; Beer–Lambert absorption along the view path through the water; the curvature "lens" that focuses ripples into bright and dark bands on the floor; and the folded-sine caustic cookie from `src/vfx/common.js`. The code was rewritten for this project.

```
MIT License

Copyright (c) 2026 Humpalumps

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## WebGL Water (Evan Wallace)

https://madebyevan.com/webgl-water — Copyright (c) 2011 Evan Wallace, MIT License (same terms as above).

The ripple height-field update in `src/ui3d/water.ts` (`RippleSim`: height plus velocity per texel, the four-neighbour Laplacian, damping and drops), as used by Ultra Elements' `src/scene/pool.js`.

## Hash without Sine (Dave Hoskins)

https://www.shadertoy.com/view/4djSRW — Copyright (c) 2014 David Hoskins, MIT License (same terms as above).

The `hash12` function in `src/ui3d/water.ts`.

## pixelfx

https://github.com/patch-gg/pixelfx

The pixel skin and pixel table (`src/pixel/`, `src/ui3d/pixelPass.ts`) follow techniques from pixelfx: effects drawn into a low-resolution frame with two buffers (a colour buffer whose alpha is decided by a 4×4 Bayer ordered-dither threshold instead of blending, and an additive light buffer composited over it), hue-shifted palette ramps where a shade is picked as one step of the ramp rather than interpolated, seeded random numbers so an effect replays identically, and nearest-neighbour upscaling of the frame. The 3D table is rendered at a low resolution and graded with the same ideas (palette steps, a narrow Bayer-dithered band between steps, a dark outline). The code was rewritten for this project; no pixelfx effect or asset was copied.

```
MIT License

Copyright (c) 2026 Patch
Copyright (c) 2026 Hugo Duprez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fusion Pixel Font

https://github.com/TakWolf/fusion-pixel-font

`src/pixel/saki-pixel-12.woff2` is a subset of Fusion Pixel 12px Proportional SC (taken from the `@fontsource/fusion-pixel-12px-proportional-sc` package), made with `scripts/make-pixel-font.py`. Because 'Fusion Pixel' is a Reserved Font Name, the modified (subsetted) font is renamed "Saki Pixel 12". Its copyright notices and licenses, as shipped with the font, follow.

```
Copyright (c) 2022, TakWolf (https://takwolf.com),
with Reserved Font Name 'Fusion Pixel'.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
Copyright (c) 2019-2023 Minseo Lee (itoupluk427@gmail.com)



This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at:

http://scripts.sil.org/OFL





-----------------------------------------------------------

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

-----------------------------------------------------------



PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide

development of collaborative font projects, to support the font creation

efforts of academic and linguistic communities, and to provide a free and

open framework in which fonts may be shared and improved in partnership

with others.



The OFL allows the licensed fonts to be used, studied, modified and

redistributed freely as long as they are not sold by themselves. The

fonts, including any derivative works, can be bundled, embedded,

redistributed and/or sold with any software provided that any reserved

names are not used by derivative works. The fonts and derivatives,

however, cannot be released under any other type of license. The

requirement for fonts to remain under this license does not apply

to any document created using the fonts or their derivatives.



DEFINITIONS

"Font Software" refers to the set of files released by the Copyright

Holder(s) under this license and clearly marked as such. This may

include source files, build scripts and documentation.



"Reserved Font Name" refers to any names specified as such after the

copyright statement(s).



"Original Version" refers to the collection of Font Software components as

distributed by the Copyright Holder(s).



"Modified Version" refers to any derivative made by adding to, deleting,

or substituting -- in part or in whole -- any of the components of the

Original Version, by changing formats or by porting the Font Software to a

new environment.



"Author" refers to any designer, engineer, programmer, technical

writer or other person who contributed to the Font Software.



PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining

a copy of the Font Software, to use, study, copy, merge, embed, modify,

redistribute, and sell modified and unmodified copies of the Font

Software, subject to the following conditions:



1) Neither the Font Software nor any of its individual components,

in Original or Modified Versions, may be sold by itself.



2) Original or Modified Versions of the Font Software may be bundled,

redistributed and/or sold with any software, provided that each copy

contains the above copyright notice and this license. These can be

included either as stand-alone text files, human-readable headers or

in the appropriate machine-readable metadata fields within text or

binary files as long as those fields can be easily viewed by the user.



3) No Modified Version of the Font Software may use the Reserved Font

Name(s) unless explicit written permission is granted by the corresponding

Copyright Holder. This restriction only applies to the primary font name as

presented to the users.



4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font

Software shall not be used to promote, endorse or advertise any

Modified Version, except to acknowledge the contribution(s) of the

Copyright Holder(s) and the Author(s) or with their explicit written

permission.



5) The Font Software, modified or unmodified, in part or in whole,

must be distributed entirely under this license, and must not be

distributed under any other license. The requirement for fonts to

remain under this license does not apply to any document created

using the Font Software.



TERMINATION

This license becomes null and void if any of the above conditions are

not met.



DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,

EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF

MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT

OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE

COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,

INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL

DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING

FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM

OTHER DEALINGS IN THE FONT SOFTWARE.

[Cubic 11]

These fonts are free software.

Unlimited permission is granted to use, copy, and distribute them, with or without modification, either commercially or noncommercially.

THESE FONTS ARE PROVIDED "AS IS" WITHOUT WARRANTY.

此字型是免費的。

無論您是否進行對本字型進行商業或非商業性修改，均可無限制地使用，複製和分發它們。

本字型的衍生品之授權必須與此字型相同，且不作任何擔保。

[JF Dot M+H 12]

Copyright(c) 2005 M+ FONTS PROJECT

[M+ BITMAP FONTS]

Copyright (C) 2002-2004 COZ

These fonts are free software.

Unlimited permission is granted to use, copy, and distribute it, with or without modification, either commercially and noncommercially.

THESE FONTS ARE PROVIDED "AS IS" WITHOUT WARRANTY.

これらのフォントはフリー（自由な）ソフトウエアです。

あらゆる改変の有無に関わらず、また商業的な利用であっても、自由にご利用、複製、再配布することができますが、全て無保証とさせていただきます。



This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at:

https://scripts.sil.org/OFL





-----------------------------------------------------------

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

-----------------------------------------------------------



PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide

development of collaborative font projects, to support the font creation

efforts of academic and linguistic communities, and to provide a free and

open framework in which fonts may be shared and improved in partnership

with others.



The OFL allows the licensed fonts to be used, studied, modified and

redistributed freely as long as they are not sold by themselves. The

fonts, including any derivative works, can be bundled, embedded,

redistributed and/or sold with any software provided that any reserved

names are not used by derivative works. The fonts and derivatives,

however, cannot be released under any other type of license. The

requirement for fonts to remain under this license does not apply

to any document created using the fonts or their derivatives.



DEFINITIONS

"Font Software" refers to the set of files released by the Copyright

Holder(s) under this license and clearly marked as such. This may

include source files, build scripts and documentation.



"Reserved Font Name" refers to any names specified as such after the

copyright statement(s).



"Original Version" refers to the collection of Font Software components as

distributed by the Copyright Holder(s).



"Modified Version" refers to any derivative made by adding to, deleting,

or substituting -- in part or in whole -- any of the components of the

Original Version, by changing formats or by porting the Font Software to a

new environment.



"Author" refers to any designer, engineer, programmer, technical

writer or other person who contributed to the Font Software.



PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining

a copy of the Font Software, to use, study, copy, merge, embed, modify,

redistribute, and sell modified and unmodified copies of the Font

Software, subject to the following conditions:



1) Neither the Font Software nor any of its individual components,

in Original or Modified Versions, may be sold by itself.



2) Original or Modified Versions of the Font Software may be bundled,

redistributed and/or sold with any software, provided that each copy

contains the above copyright notice and this license. These can be

included either as stand-alone text files, human-readable headers or

in the appropriate machine-readable metadata fields within text or

binary files as long as those fields can be easily viewed by the user.



3) No Modified Version of the Font Software may use the Reserved Font

Name(s) unless explicit written permission is granted by the corresponding

Copyright Holder. This restriction only applies to the primary font name as

presented to the users.



4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font

Software shall not be used to promote, endorse or advertise any

Modified Version, except to acknowledge the contribution(s) of the

Copyright Holder(s) and the Author(s) or with their explicit written

permission.



5) The Font Software, modified or unmodified, in part or in whole,

must be distributed entirely under this license, and must not be

distributed under any other license. The requirement for fonts to

remain under this license does not apply to any document created

using the Font Software.



TERMINATION

This license becomes null and void if any of the above conditions are

not met.



DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,

EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF

MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT

OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE

COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,

INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL

DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING

FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM

OTHER DEALINGS IN THE FONT SOFTWARE.

Copyright (c) 2021, TakWolf (https://takwolf.com),

with Reserved Font Name 'Ark Pixel'.



This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at:

https://openfontlicense.org





-----------------------------------------------------------

SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

-----------------------------------------------------------



PREAMBLE

The goals of the Open Font License (OFL) are to stimulate worldwide

development of collaborative font projects, to support the font creation

efforts of academic and linguistic communities, and to provide a free and

open framework in which fonts may be shared and improved in partnership

with others.



The OFL allows the licensed fonts to be used, studied, modified and

redistributed freely as long as they are not sold by themselves. The

fonts, including any derivative works, can be bundled, embedded,

redistributed and/or sold with any software provided that any reserved

names are not used by derivative works. The fonts and derivatives,

however, cannot be released under any other type of license. The

requirement for fonts to remain under this license does not apply

to any document created using the fonts or their derivatives.



DEFINITIONS

"Font Software" refers to the set of files released by the Copyright

Holder(s) under this license and clearly marked as such. This may

include source files, build scripts and documentation.



"Reserved Font Name" refers to any names specified as such after the

copyright statement(s).



"Original Version" refers to the collection of Font Software components as

distributed by the Copyright Holder(s).



"Modified Version" refers to any derivative made by adding to, deleting,

or substituting -- in part or in whole -- any of the components of the

Original Version, by changing formats or by porting the Font Software to a

new environment.



"Author" refers to any designer, engineer, programmer, technical

writer or other person who contributed to the Font Software.



PERMISSION & CONDITIONS

Permission is hereby granted, free of charge, to any person obtaining

a copy of the Font Software, to use, study, copy, merge, embed, modify,

redistribute, and sell modified and unmodified copies of the Font

Software, subject to the following conditions:



1) Neither the Font Software nor any of its individual components,

in Original or Modified Versions, may be sold by itself.



2) Original or Modified Versions of the Font Software may be bundled,

redistributed and/or sold with any software, provided that each copy

contains the above copyright notice and this license. These can be

included either as stand-alone text files, human-readable headers or

in the appropriate machine-readable metadata fields within text or

binary files as long as those fields can be easily viewed by the user.



3) No Modified Version of the Font Software may use the Reserved Font

Name(s) unless explicit written permission is granted by the corresponding

Copyright Holder. This restriction only applies to the primary font name as

presented to the users.



4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font

Software shall not be used to promote, endorse or advertise any

Modified Version, except to acknowledge the contribution(s) of the

Copyright Holder(s) and the Author(s) or with their explicit written

permission.



5) The Font Software, modified or unmodified, in part or in whole,

must be distributed entirely under this license, and must not be

distributed under any other license. The requirement for fonts to

remain under this license does not apply to any document created

using the Font Software.



TERMINATION

This license becomes null and void if any of the above conditions are

not met.



DISCLAIMER

THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,

EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF

MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT

OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE

COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,

INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL

DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING

FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM

OTHER DEALINGS IN THE FONT SOFTWARE.
```

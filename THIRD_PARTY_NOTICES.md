# Third-party notices

## Ultra Elements

https://github.com/Humpalumps/ultra-elements

Hatsumi's purple whirlwind (`src/ui3d/gale.ts`) follows techniques from Ultra Elements' `src/vfx/Ribbons.js` and `src/vfx/Shockwaves.js`: analytic ribbons whose centreline is evaluated per vertex in the vertex shader and expanded towards the camera, the "phone-wire" rule that a strip thinner than 1.5 px dims instead of thinning, and a blast-wave (r ∝ t^0.4) shock ring. The code was rewritten for this project.

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

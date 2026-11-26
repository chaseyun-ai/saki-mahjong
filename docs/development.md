# 开发说明

怎么在本地跑起来、代码在哪里、能力系统怎么接、素材从哪来。游戏介绍看 [README](../README.md)，每位角色能力的细节看 [角色能力和演出详解](abilities.md)。

## 本地运行

需要 Node.js 20 或更新的版本（GitHub 上的检查用的是 22）。

```bash
npm install
npm run dev      # 打开终端里显示的地址
npm run assets   # 打开素材导入页（Windows 上双击「素材导入.bat」也一样）
npm run build    # 类型检查 + 打包到 dist/
npm test         # 规则和整场模拟测试
npx vite-node scripts/balance.ts 300   # 让电脑打 300 场，统计各角色成绩
npx vite-node scripts/focus.ts shizuno 300 south   # 单看一个角色：每场都让她上桌，另外三家随机
npx vite-node scripts/strength.ts kana 300 random   # 同上，输出一行 JSON（random：对手从全部角色里抽；plain：三个没有能力的人）
npx vite-node scripts/brawl.ts 30      # 能力大乱斗：角色池任选四人，每种组合打 30 场，检查能力碰撞
npx vite-node scripts/hatsumi-deal.ts 300   # 薄墨初美配牌东北各 2 张和各 1 张的强度对比
npx vite-node scripts/toka.ts 300 south [start]   # 龙门渊透华：多少场进治水、第几局进，治水前后的鸣牌和别人自摸率（start：开局就治水）
npx vite-node scripts/komaki-ai.ts 100 [神]   # 电脑的神代小莳：每位神各打 100 场，看和了率、打点和“该做没做”的事（能杠没杠、听牌没立直、鸣了牌……）
```

背景音乐（`public/music/`）不进 Git：免费授权的曲子可以跟着游戏发，但不能把文件单独再分发。所以刚克隆下来的仓库没有音乐，别的都照常；想听的话在游戏的声音设置里换成自己的文件，或者放进 `public/music/<格子>.mp3`（见 `src/ui/musicTracks.ts`）。

## 发布网页版

网页版发在 GitHub Pages：https://chaseyun-ai.github.io/saki-mahjong/ 。平时推 `main` 不会改动网页，只有推版本标签时才发布，并顺手建一个 Release：

```bash
git tag v0.2
git push origin v0.2
```

不想打新标签、只想重发一次，就在 GitHub 的 Actions 页选 `pages`，点 Run workflow。详细的仓库设置写在 `.github/workflows/pages.yml` 开头。

## 代码结构

| 目录 | 内容 |
| --- | --- |
| `src/engine` | 规则引擎：牌、牌山、向听、和了拆分、役和点数、对局流程。不依赖画面 |
| `src/abilities` | 角色能力插件和角色列表。能力只能交换没公开的牌，不能凭空造牌 |
| `src/ai` | 规则型电脑对手：牌效、简单防守、会用自己的能力 |
| `src/ui` | 对局控制、按钮和结算界面，以及 2D 牌桌 |
| `src/ui3d` | Three.js 3D 牌桌：立体麻将牌、牌河、副露、控制台、占位人物 |
| `src/assets` | 素材导入：认文件、按文件名对上格子、素材包（zip）、浏览器里存的素材、导入页 |
| `src/story` | 全国大赛（团体赛、个人赛）：晋级表、赛程和其他桌的模拟 |
| `src/team` | 团体赛：选人、布阵、队伍点数接力 |
| `src/lab` | 出牌动作调试场景（网址后面加 `#lab`） |
| `tests` | 算分、向听和整场模拟测试 |

能力能挂的时机和“谁说了算”的顺序写在 `src/abilities/types.ts`：配牌之前、任何人摸牌之前（控场的人可以给这次摸牌定规矩，比如“这张不许摸”）、自己摸牌前后、打牌后，还能换里宝牌，规则引擎会算牌山转角（`Game.cornerIndices`）。锁住的牌谁都不能动；控场的人按 priority 先动，摸牌的人自己的能力最后动，后动的不能违反先定的规矩，和座位无关。配牌也一样：所有人先定配牌的规矩（`dealRules`），再依次调整牌山，任何一次换牌都不能让别人的规矩变差；能兼容的规矩一起满足，无解时降级（先动的人的规矩保住，没满足的记在 `Game.dealUnmet`），调整完 52 张配牌统一锁定再发牌。

怜的一巡先见不锁牌：“你下一张”是在复制的牌局上（`src/engine/clone.ts`，独立的状态和随机数）照电脑的打法往下打、走完整个摸牌流程演算出来的（`src/ai/forecast.ts`），已经生效的控场都算在里面；假设这一巡没人鸣牌、开杠、和牌，局面一变界面就重新算（`ForecastCache`）。`tests/toki-forecast.test.ts` 检查看不看预览后面打出来一样、绝一门不因为怜漏过、鸣牌开杠后不给旧的结果。玩家的“看下一巡”不花体力，同一回合看第二次的话下一局不能用。电脑的怜照原作用一巡先见：看得到这一巡谁会荣和她打的牌（不打那些牌，别的牌不按筋、壁估危险，不为防守弃和），只在演算到立直后一发和得了（一发自摸或一发荣和，`forecastIppatsu`）时立直；玩家的怜托管时不替玩家读铳牌（`tests/toki-ai.test.ts`）。

能力大乱斗（`tests/brawl.test.ts`）每一步检查牌数、锁住的牌、控场规矩。能力记录器（`tests/trace/recorder.ts`、`tests/draw-trace.test.ts`）记下每次摸牌从能力处理到取牌的全过程，逐次核对牌守恒、公开牌不变、锁不动、每个钩子只调一次、换牌次数有上限、没有无意义的同种互换，以及同一种子重放逐字一致；`TRACE_GAMES=200` 可以多跑几场。还没做出来的控场角色先用 `tests/brawl/probes.ts` 里的探针顶替。

发牌前选的技能（霞、爽，还有涅莉押运势）挂在 `Ability.preDeal` / `setPreDeal`，玩家操作时发牌前弹出来选（选数的选项带 `stepper`，合不合规矩由 `preDealCheck` 判断）；技能栏的状态挂在 `Ability.skill`。照的照魔镜那一局和不了牌用 `Ability.canWin`，涅莉七姐妹的软封印是 `beforeAnyDraw` 返回的摸牌规矩（换走被封的人的和了牌）；照的 `Ability.immune` 让别人的能力管不到她（`Game.binds`），玄的 `Ability.absolute` 连她也要守；照看到的别人的能力状态来自各能力的 `Ability.insight`。爽的霍亚乌用 `Ability.seals` 封印别人：被封印的座位 `Game.active(seat)` 是空的，规则引擎不再调它的任何钩子，界面和电脑也不再读牌、预知（`Game.isSealed`）。
要玩家主动开的技能挂在 `Ability.skill` / `pressSkill`；玩家操作的座位在 `Game.manual` 里，能力看到这个标记就听玩家的，否则按电脑的规矩自己决定。

能力的强度参数在各自文件顶部（比如 `src/abilities/saki.ts` 的 `RINSHAN_WIN_CHANCE`），改数字就能调平衡。

稳乃的雾要打到第 7 局以后才看得到，调样子时在网址后面加 `?mist=6` 到 `?mist=12`：不管桌上是谁，开局就按那么多个深山标记起雾（只是画面，不改规则）。

## 素材导入

换头像、切入图、技能动画、3D 模型、手模、语音、提示音、背景音乐，不用改代码、不用手动改文件名。用不用随玩家：不打开这一页，游戏照原样。

- **入口**：主页左边的拉门；或者设置 → 视觉 → 素材 →「素材导入」；或者网址后面加 `#assets`；本地开发时双击项目里的 `素材导入.bat`（或 `npm run assets`）直接打开
- **先看要什么**：页面上半截把格子分成八类（头像、切入图、技能动画、3D 模型、语音、提示音、背景音乐、手模），每一类写着用在哪个画面、要几个、什么规格、已经换了几个；「下载完整清单」把每个角色的每一格导成一张表（用在哪、规格、不换会怎样、建议文件名、换了没有），可以直接发给画师、配音。说明的字和建议文件名在 `src/assets/guide.ts`，`tests/assets-guide.test.ts` 检查每一格的建议文件名拖进来都对回同一格
- **逐个格子看**：左边角色名单带进度，右边是这个人的每一格，现在用的是原版、换上的，还是借别的格子顶着（没换的吃惊、能力头像用头像，结算图用和牌切入；鸣牌切入和和牌切入各管各的，没换就是原版；想让吃碰杠也放和牌那张，点鸣牌切入格子上的「直接用和牌切入」复制一份过去，之后再换和牌切入它不跟着变）；图能看，声音能试听（没换的提示音放合成的原版）。点「放进来」或者把文件拖到格子上，就直接放进这一格
- **放图前先裁**（`src/assets/cropper.ts`，框的几何在 `cropMath.ts`）：静态图（PNG、JPG、WebP）放进格子前弹出裁剪框，比例、存多大照这一格（`guide.ts` 的 `cropOf`：头像 3:4 长边 800，睁眼特写 16:5 长边 1600，切入 3:4 / 4:3，结算图不限）；拖着挪、拉四个角改大小（不限比例时四条边也能拉）、滚轮或加减号缩放、方向键微调，在框外按住拖一下重画一个框；旋转：左转、右转 90°，拉条微调 ±45°（半度一格），框的中心跟着原图上同一个点走，转出来的透明空角框到了会提醒，「缩到没有空角」一下缩到四个角都在图上（`cropMath.ts` 的 `carryBox`、`boxCovered`、`coverBox`），原图不改，存的时候一次转好裁好，「也当头像」接着裁时沿用同一个角度；右边小预览照游戏里的样子（头像框、斜着的睁眼长条）。裁好的存成 WebP（浏览器存不了就 PNG），不放大。也可以「不裁，原图放进去」。GIF、动图、视频不裁。换上的图（格子上「裁剪」）、对照表里的图（缩略图上「裁剪」）也能再裁；比例和格子差太多时对照表、格子上会提醒。`tests/assets-crop.test.ts`
- **睁眼特写「导入头像图」**（`src/assets/eyeImport.ts`）：素材导入页「睁眼特写」格子和预览页 `#eyes` 每个人下面都有。裁剪框下面一排是这个人现有的头像、能力头像、切入图、自带的渲染图（`quickPut.ts` 的 `avatarSources`），也能换一张图；框住两只眼睛裁成 16:5 存进「睁眼特写」。自己选的图可以勾「也当头像」，接着再裁一张 3:4 存进「头像」（这个人还没换过头像时默认勾上）。预览页存到素材导入页选的地方（`quickPut.ts`），「换回现画」删掉换上的
- **拖进来就行**：单个文件、整个文件夹、素材包（.zip）都可以。照文件名（连同文件夹名）认出是谁的哪一格：角色 id（`saki`）、中文名（`宫永咲`）、日文写法（`宮永咲`）、单名（`咲`）、罗马字（`Miyanaga Saki`，长音写不写都行）都认；格子认 `头像`/`face`、`立直`/`riichi`、`和牌`、`结算`、技能名（`天使和`、`治水立直`……）、台词名（`岭上开花`）等。不是 VRM 的 `.glb` 当手模，没写角色名的音频看是不是提示音（`落桌`、`立直`……）或背景音乐（`menu`、`东场`……）。试玩页的 `.glb.txt` 也认，自动解回 GLB。导入前先列一张对照表，认错的、没认出来的在下拉框里改
- **检查**：看文件头判断真实格式（不信扩展名），格式、大小、VRM 有没有人形骨骼、语音长度（最多 12 秒）、头像和睁眼特写的比例差得多不多；VRM 的名字、作者、许可列在表里。大图可以自动缩小到 2048 像素以内、转成 WebP
- **放到哪里**：
  - 这个浏览器：人人能用（包括发布的网页版），只影响自己，存在 IndexedDB（`src/assets/store.ts`）；「用我导入的素材」开关关掉就是原版。背景音乐和声音设置里换曲共用一份（`musicStore.ts`）
  - 项目文件夹：只在本地 `npm run dev` 时有。写进 `public/custom/<角色>/<格子>.<扩展名>`，清单是 `public/custom/manifest.json`，提交到 Git 后打包、发布的游戏里人人都有（`scripts/vite-custom-assets.ts`）。背景音乐写成 `public/music/<格子>.mp3`，照旧不进 Git
- **素材包**：「导出素材包」把这个浏览器（或项目文件夹）里导入的全部打成一个 zip（`manifest.json` + 文件，`src/assets/pack.ts`），换电脑、换浏览器、放进项目时「导入素材包」就全部还原。试玩页的「素材」页右上角也有「导出素材包」，在那里换过的图和语音可以这样搬到本地
- **游戏里怎么用**：同一格有好几层时，浏览器里的 > 试玩页里的 > 项目里的 > 游戏自带的（`src/assets/layers.ts` 推给 `looks.ts`、`voice.ts`、`customSfx.ts`）。换了 3D 模型的角色不再染发色、眼睛。换了「头像」以后，没单独换的表情（开心、难过、吃惊、能力发动）都用换上的头像，所以每个角色最少换一张头像就够

## 3D 人物模型

四位角色暂时用 VRoid 项目公开的示例模型改色而成（`src/ui3d/looks.ts` 里设置每个角色用哪个模型、头发和眼睛的颜色）：

| 角色 | 底模 | 文件 |
| --- | --- | --- |
| 宫永咲 | AvatarSample_E（ビビ） | `public/models/vroid-e.v2.glb` |
| 原村和 | AvatarSample_G（ヴィクトリア・ルービン） | `public/models/vroid-g.v2.glb` |
| 松实玄 | 千駄ヶ谷篠 | `public/models/vroid-shino.v2.glb` |
| 园城寺怜 | AvatarSample_F（ヴィータ） | `public/models/vroid-f.v2.glb` |

模型作者是 VRoid プロジェクト，许可写在模型里：任何人可用、可修改、可再分发、可商用，不需要署名（[VRoid Hub 许可条款](https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=everyone&corporate_commercial_use=allow&credit=unnecessary&modification=allow&personal_commercial_use=profit&redistribution=allow&sexual_expression=allow&version=1&violent_expression=allow)）。原始文件来自 [OpenGameArt 上的 VRoid Studio CC0 models](https://opengameart.org/content/vroid-studio-cc0-models)，用 `python3 scripts/shrink-vrm.py 原文件.vrm 输出.glb` 瘦身后放进项目：贴图缩小并转成 WebP，表情形变只存动了的顶点，四个模型一共约 8 MB。模型更新时换一个新文件名（`.v2`、`.v3`……），玩家浏览器里存的旧模型就不会被误用。自己的 VRoid 模型不用放进这里：用上面的「素材导入」，拖进 `.vrm` 就换上了。

## 牌面字体

万子和字牌的字形取自 [霞鹜文楷 TC（LXGW WenKai TC）](https://github.com/lxgw/LxgwWenkaiTC) Bold，SIL Open Font License 1.1。`scripts/gen-glyphs.ts` 从 `scripts/fonts/` 里的字体子集生成 `src/ui/glyphs.ts`，游戏运行时不需要加载字体。

## 特效参考

薄墨初美里鬼门的紫色旋风（`src/ui3d/gale.ts`）参考了 [Humpalumps/ultra-elements](https://github.com/Humpalumps/ultra-elements)（MIT）：风丝照它 `Ribbons.js` 的做法在顶点着色器里按时间算出位置、朝镜头展开，细到不足 1.5 个像素时变暗而不再变细；和牌时地上那一圈冲击波的半径照它 `Shockwaves.js` 的 t^0.4 爆炸波曲线。牌桌上的通用特效（`src/ui3d/effects.ts`：立直、鸣牌、杠、和牌）也照它的手法重做：冲击波照 `Shockwaves.js` 前沿锐利、后面拖着尾迹；火花照 `Particles.js` 按速度拉成流光、从白热冷成本色，阻力和重力在着色器里按时间直接算；和牌的闪电照 `Bolts.js` 和 `lightning.js`，分形折线，先导一步步摸下来、回击打亮、复击时主干不变只换分叉、余辉冷却成一串珠子；特效亮起时有一盏灯把牌桌照亮一下。和牌不再放光柱，手牌一倒，上方几盏舞台聚光灯一盏接一盏打开，均匀照在和了的那副牌上（`src/ui3d/winSpots.ts`）。2D 的大字特效（`src/ui/style.css`）也换成同样的冲击波、火星和快起慢落的闪光。白水哩番缚的锁链（`src/ui3d/chains.ts`）也照它的思路：一条锁链一个 InstancedMesh、碎片按初速度、自转和重力解析地算位置（`Spikes.js`、`frozen-lightning`），碎片冲上天拖着的光、消散的粒子参考 `Particles.js`。代码是照这些思路重写的，没有整段照搬；版权声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

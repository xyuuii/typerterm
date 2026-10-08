# 第三方组件与素材

除下面列出的三幅浮世绘外，本项目的三维模型（包括猫）、房间、窗外的街景绘画、纹理、图标和所有音效都由本仓库的代码在运行时生成，没有使用实机录音。用户自己添加的图片和音乐只保存在用户本机浏览器里，不随项目分发。

## 下载的素材（`public/assets/`）

### 浮世绘（大都会艺术博物馆 Open Access，CC0）

- `great-wave.jpg` — 葛饰北斋《神奈川冲浪里》（Under the Wave off Kanagawa），约 1830–32 年，The Met 45434，https://www.metmuseum.org/art/collection/search/45434
- `red-fuji.jpg` — 葛饰北斋《凯风快晴》（South Wind, Clear Sky / Red Fuji），The Met 36490，https://www.metmuseum.org/art/collection/search/36490
- `gotenyama-sakura.jpg` — 歌川广重《御殿山夕樱》（Evening Cherry Blossoms at Gotenyama），The Met 45298，https://www.metmuseum.org/art/collection/search/45298

The Met 将其公有领域藏品的图像以 Creative Commons Zero（CC0 1.0）发布，可自由使用、修改和再分发。文件为 The Met 提供的 web-large 版本（约 600 px 宽）。

## 运行时依赖（随 `npm install` 安装，许可全文见各自 `node_modules/<包>/LICENSE`）

| 组件 | 版本 | 许可 |
|---|---|---|
| three | 0.186.1 | MIT |
| @xterm/xterm | 6.0.0 | MIT |
| ssh2 | 1.17.0 | MIT（Copyright Brian White） |
| ws | 8.22.0 | MIT |
| vite（构建） | 8.3.3 | MIT |

## 字体（构建时打包进 `dist/assets`）

- **Courier Prime**（纸面西文、键帽、界面标题）— `@fontsource/courier-prime` 5.3.0。
  Copyright 2015 The Courier Prime Project Authors (https://github.com/quoteunquoteapps/CourierPrime)。
  SIL Open Font License 1.1（https://openfontlicense.org）。
- **Special Elite**（界面小字）— `@fontsource/special-elite` 5.3.0。
  Copyright (c) 2010 by Brian J. Bonislawsky DBA Astigmatic (AOETI)。Apache License 2.0（http://www.apache.org/licenses/LICENSE-2.0）。

中文字形使用用户设备上的系统字体（如 macOS 的宋体 Songti SC），不随包分发。

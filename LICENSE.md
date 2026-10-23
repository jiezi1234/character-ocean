# Licensing scope / 授权范围

This repository contains original frontend work, code adapted from an upstream
repository, and third-party fonts. These components do not share one license.

## Original frontend and tooling — MIT

The original contributions by jiezi1234 in the following files are licensed under
the MIT License in [licenses/frontend-MIT.txt](licenses/frontend-MIT.txt):

- `src/app.ts`
- `src/index.html`
- `src/style.css`
- `build.mjs`
- `serve.mjs`
- `tsconfig.json`
- `package.json`
- `.gitignore`
- `.gitattributes`
- `README.md`

This grant applies only to original contributions in the listed files. It does
not relicense third-party code, fonts, or other third-party material.

## Upstream animation — no license declared

`src/engine.ts`, `src/world.ts`, `src/renderer.ts`, `src/species.ts`, and
`src/math.ts` are adapted from `stackedlol/ascii-sharks`.

As checked on 2026-10-23 at upstream commit
`c521e24a787e6d4cc460d4cf2b9815f25e4fe453`, the upstream repository does not
declare a software license. No license to those upstream portions is granted
by this repository. Their copyright remains with their respective authors.
This independently maintained repository retains upstream attribution.
Creating a separate repository does not establish a broader reuse or
redistribution license for the upstream portions.

## Fonts — SIL Open Font License 1.1

- Geist / Geist Mono: [assets/OFL.txt](assets/OFL.txt)
- Noto Sans SC subset: [assets/NotoSansSC-OFL.txt](assets/NotoSansSC-OFL.txt)

## Generated HTML

`dist/index.html` combines code and fonts from the components above. The MIT
grant for the original frontend does not apply to the entire generated file.
Embedded font licenses and attribution notices are retained in the HTML.

---

本仓库按组件区分授权：上方列出的新增前端代码及工具使用 MIT 许可；
源自 stackedlol/ascii-sharks 的动画部分暂无上游明确许可证；字体按各自的
SIL OFL 1.1 许可提供。请勿将整个仓库或打包后的 HTML 视为 MIT 授权项目。

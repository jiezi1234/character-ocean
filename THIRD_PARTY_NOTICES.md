# Third-party notices

## Animation: stackedlol/ascii-sharks

- Author: stackedlol and upstream contributors.
- Source: https://github.com/stackedlol/ascii-sharks
- Upstream commit: `c521e24a787e6d4cc460d4cf2b9815f25e4fe453`.
- License status checked: 2026-10-23. No license file or software license
  declaration was found in the upstream repository at this commit.
- Adapted files: `src/engine.ts`, `src/world.ts`, `src/renderer.ts`,
  `src/species.ts`, `src/math.ts`.

Changes in this project include additional species and manta-ray contours,
multiple character renderers, light/dark palettes, pause/speed controls,
and the surrounding translucent search/music/focus interfaces.

Credit to the upstream author is retained in the page footer. No upstream
copyright or license is replaced by the MIT grant for the new frontend files.
See https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
for GitHub's explanation of the distinction between public code and licensed
open-source code.

## Geist and Geist Mono

- Copyright 2024 The Geist Project Authors.
- Upstream: https://github.com/vercel/geist-font
- License: SIL Open Font License 1.1, retained in `assets/OFL.txt`.
- Files: `assets/sans.ttf`, `assets/light.ttf`, `assets/mono.ttf`.
- Font files are embedded without modification by the build script.

## Noto Sans SC

- Copyright 2014–2021 Adobe, as stated in the bundled font license.
- Source family: Noto Sans SC, distributed through Google Fonts.
- License: SIL Open Font License 1.1, retained in `assets/NotoSansSC-OFL.txt`.
- File: `assets/hanzi.ttf`, a character subset used for the HANZI renderer.
- The character subset and its original license are kept together in this repo.

## Build dependencies

esbuild and TypeScript are development dependencies installed through npm.
Their versions and package metadata are recorded in `package-lock.json`.
`node_modules/` is not included in this repository.

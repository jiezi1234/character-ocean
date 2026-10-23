import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const result = await build({ entryPoints: ['src/app.ts'], bundle: true, write: false, format: 'iife', target: 'es2022', minify: true, legalComments: 'inline' });
let css = await readFile('src/style.css', 'utf8');
for (const name of ['sans', 'mono', 'light', 'hanzi']) {
  const font = await readFile(`assets/${name}.ttf`);
  css = css.replace(`FONT_${name.toUpperCase()}`, `data:font/ttf;base64,${font.toString('base64')}`);
}
const template = await readFile('src/index.html', 'utf8');
const noticeFiles = ['LICENSE.md', 'licenses/frontend-MIT.txt', 'THIRD_PARTY_NOTICES.md', 'assets/OFL.txt', 'assets/NotoSansSC-OFL.txt'];
const notices = (await Promise.all(noticeFiles.map(async path => `${path}\n${await readFile(path, 'utf8')}`))).join('\n\n');
const html = template.replace('<!--APP_STYLE-->', () => `<style>${css}</style>`).replace('<!--APP_SCRIPT-->', () => `<script>${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`).replace('</head>', () => `<!-- Licenses and attribution\n${notices.replace(/--/g, '—')}\n-->\n</head>`);
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
console.log(`Built self-contained dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);

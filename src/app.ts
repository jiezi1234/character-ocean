/** Animation adapted from https://github.com/stackedlol/ascii-sharks by stackedlol. */
import { OceanEngine } from './engine';
import type { SharkKind, SharkSpec } from './world';
import type { RenderMode } from './renderer';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const icons = {
  pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>',
};
const mixed: SharkSpec[] = [
  { kind: 'whaleshark', size: 1 }, { kind: 'manta', size: .83 },
  { kind: 'hammerhead', size: .86 },
  { kind: 'sunfish', size: .64 }, { kind: 'classic', size: .78 },
];
const kinds: SharkKind[] = ['manta', 'whaleshark', 'sunfish', 'thresher', 'mako', 'nurse', 'greathammer', 'zebra', 'tiger', 'classic', 'hammerhead'];
const names: Record<SharkKind, string> = { manta: '蝠鲼', whaleshark: '鲸鲨', sunfish: '翻车鱼', thresher: '长尾鲨', mako: '灰鲭鲨', nurse: '护士鲨', greathammer: '大锤头鲨', zebra: '斑马鲨', tiger: '虎鲨', classic: '灰鲨', hammerhead: '锤头鲨' };
let roster = mixed.map(s => ({ ...s }));
let paused = false;
let dark = false;
let statusTimer: ReturnType<typeof setTimeout>;
type Thought = { text: string; date: string };
let thoughts: Thought[] = [];
const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); return true; } catch { return false; } },
};
try {
  const saved: unknown = JSON.parse(storage.get('ascii-ocean-thoughts') ?? '[]');
  if (Array.isArray(saved)) thoughts = saved.filter((s): s is Thought => typeof s?.text === 'string' && typeof s?.date === 'string' && !isNaN(Date.parse(s.date))).slice(0, 30);
} catch { /* Empty history if browser storage was edited. */ }

function status(message: string) {
  const el = $('thought-status');
  clearTimeout(statusTimer);
  el.textContent = message;
  el.classList.add('visible');
  statusTimer = setTimeout(() => el.classList.remove('visible'), 3400);
}

const pause = $<HTMLButtonElement>('pause');
const theme = $<HTMLButtonElement>('theme');
pause.innerHTML = icons.pause;
theme.innerHTML = icons.moon;

const engine = new OceanEngine($<HTMLCanvasElement>('ocean'), roster);
// Give the initial scene a small head start, so the first frame already feels alive.
engine.setSharks(roster);

const renderModes: RenderMode[] = ['ascii', 'type', 'braille', 'blocks', 'geometry', 'lines', 'hanzi'];
const modeLabels: Record<RenderMode, string> = { ascii: 'ASCII', type: 'TYPE', braille: 'DOTS', blocks: 'BLOCK', geometry: 'GEO', lines: 'LINES', hanzi: 'HANZI' };
const modeNames: Record<RenderMode, string> = { ascii: 'ASCII 原始字符', type: '纯字符', braille: '盲文点阵', blocks: '方块阴影', geometry: '几何符号', lines: '线条编织', hanzi: '汉字艺术' };
const modeDescriptions: Record<RenderMode, string> = {
  ascii: '等宽字符与灰色小格，保留最初的质感。',
  type: '用 @ # % R E A T 与标点的疏密，勾勒鱼身与光影。',
  braille: '用细密的点勾勒身体，轻盈、通透。',
  blocks: '用方块和阴影表达明暗，更厚实的像素感。',
  geometry: '圆点、圆环、菱形与方块，组成几何鱼群。',
  lines: '线条沿鱼身方向排列，像游动的编织线稿。',
  hanzi: '一、十、川、水、魚、鯊，以笔画疏密表现层次。',
};
let renderMode: RenderMode = 'ascii';
function applyRenderMode(mode: RenderMode) {
  renderMode = mode;
  engine.setRenderMode(mode);
  $<HTMLSelectElement>('render-mode').value = mode;
  $('style-toggle').textContent = modeLabels[mode];
  $('style-toggle').setAttribute('aria-label', `切换字符风格，当前${modeNames[mode]}`);
  $('style-toggle').title = `当前：${modeNames[mode]} · 点击切换下一种`;
  $('mode-description').textContent = modeDescriptions[mode];
  storage.set('ascii-ocean-render-mode', mode);
}
const savedMode = storage.get('ascii-ocean-render-mode') as RenderMode | null;
applyRenderMode(savedMode && renderModes.includes(savedMode) ? savedMode : 'ascii');
$<HTMLSelectElement>('render-mode').addEventListener('change', e => applyRenderMode((e.target as HTMLSelectElement).value as RenderMode));
$('style-toggle').addEventListener('click', () => applyRenderMode(renderModes[(renderModes.indexOf(renderMode) + 1) % renderModes.length]));

pause.addEventListener('click', () => {
  paused = !paused;
  engine.setPaused(paused);
  pause.innerHTML = paused ? icons.play : icons.pause;
  pause.setAttribute('aria-label', paused ? '继续动画' : '暂停动画');
  pause.setAttribute('aria-pressed', String(paused));
  pause.title = paused ? '继续动画' : '暂停动画';
});

function applyTheme(value: boolean) {
  dark = value;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  engine.setTheme(dark);
  theme.innerHTML = dark ? icons.sun : icons.moon;
  theme.setAttribute('aria-label', dark ? '切换浅色' : '切换深色');
  theme.setAttribute('aria-pressed', String(dark));
  theme.title = dark ? '切换浅色' : '切换深色';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#07111a' : '#fafaf8');
}
applyTheme(storage.get('ascii-ocean-theme') === 'dark');
// Fade only the old water layer; controls remain live while the new palette renders.
theme.addEventListener('click', () => {
  document.querySelectorAll('.ocean-theme-veil').forEach(el => el.remove());
  let veil: HTMLCanvasElement | null = null;
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const canvas = $<HTMLCanvasElement>('ocean');
    const snapshot = document.createElement('canvas');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const context = snapshot.getContext('2d');
    if (context && 'filter' in context) {
      const appearance = getComputedStyle(canvas);
      context.fillStyle = getComputedStyle(document.body).backgroundColor;
      context.fillRect(0, 0, snapshot.width, snapshot.height);
      context.filter = appearance.filter;
      context.globalAlpha = Number(appearance.opacity);
      context.drawImage(canvas, 0, 0);
      snapshot.className = 'ocean-theme-veil';
      snapshot.setAttribute('aria-hidden', 'true');
      canvas.after(snapshot);
      veil = snapshot;
    }
  }
  applyTheme(!dark);
  storage.set('ascii-ocean-theme', dark ? 'dark' : 'light');
  if (veil) {
    const snapshot = veil;
    const fade = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 480, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards',
    });
    fade.finished.catch(() => {}).finally(() => snapshot.remove());
    // A background tab can suspend animations; do not leave an obsolete layer behind.
    window.setTimeout(() => snapshot.remove(), 650);
  }
});

const panels = [ ['history-toggle', 'history-panel'], ['settings-toggle', 'settings-panel'] ] as const;
function closePanels() {
  for (const [button, panel] of panels) { $(panel).hidden = true; $(button).setAttribute('aria-expanded', 'false'); }
}
for (const [button, panel] of panels) {
  $(button).addEventListener('click', () => {
    const open = $(panel).hidden;
    closePanels();
    $(panel).hidden = !open;
    $(button).setAttribute('aria-expanded', String(open));
  });
}
document.addEventListener('click', e => {
  const target = e.target as Element;
  if (!target.closest('.history-wrap') && !target.closest('.ocean-controls')) closePanels();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    for (const [button, panel] of panels) {
      if (!$(panel).hidden && $(panel).contains(document.activeElement)) $(button).focus();
    }
    closePanels();
  }
});

const speed = $<HTMLInputElement>('speed');
speed.addEventListener('input', () => { engine.setSpeed(Number(speed.value)); $('speed-value').textContent = `${Number(speed.value).toFixed(2)}×`; });
$<HTMLSelectElement>('roster').addEventListener('change', e => {
  const kind = (e.target as HTMLSelectElement).value;
  roster = kind === 'mixed' ? mixed.map(s => ({ ...s })) : [1, .87, .76, .68].map(size => ({ kind: kind as SharkKind, size }));
  engine.setSharks(roster);
});
$('add-shark').addEventListener('click', () => {
  if (roster.length >= 9) { status('海里已经很热闹了，让它们慢慢游吧。'); return; }
  const kind = kinds.find(kind => !roster.some(fish => fish.kind === kind)) ?? kinds[roster.length % kinds.length];
  roster.push({ kind, size: .64 + Math.random() * .15 });
  engine.setSharks(roster);
  status(`${names[kind]}，游进了这片海。`);
});
$('ripple').addEventListener('click', () => {
  engine.ripple(window.innerWidth * .5, window.innerHeight * .67);
  status('轻轻碰一下，水面就有了回响。');
});

type Layout = 'search' | 'music' | 'focus';
const layouts: Layout[] = ['search', 'music', 'focus'];
const layoutNames: Record<Layout, string> = { search: '搜索', music: '播放', focus: '专注' };
const headlines: Record<Layout, string> = { search: 'where to next?', music: 'take a little break.', focus: 'one thing at a time.' };
let layout: Layout = 'search';

// Playback is a visual demo; no audio file or remote service is needed.
const tracks = [
  { title: 'Somewhere, slowly', artist: 'Late Tide', duration: 272 },
  { title: 'Blue hour', artist: 'Quiet Current', duration: 218 },
  { title: 'A softer place', artist: 'Still Water', duration: 305 },
];
let trackIndex = 0;
let trackPosition = 84;
let trackStartedAt = 0;
let playing = false;
const trackSeek = $<HTMLInputElement>('track-seek');
const trackPlay = $('track-play');
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function updateText(id: string, text: string) { if ($(id).textContent !== text) $(id).textContent = text; }
function updatePlayButton(button: HTMLElement, active: boolean, label: string) {
  if (!button.firstElementChild || button.getAttribute('aria-pressed') !== String(active)) button.innerHTML = active ? icons.pause : icons.play;
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', label);
  button.title = label;
}
function playbackPosition() { return Math.min(tracks[trackIndex].duration, trackPosition + (playing ? (performance.now() - trackStartedAt) / 1000 : 0)); }
function renderTrack() {
  const track = tracks[trackIndex];
  const position = playbackPosition();
  updateText('track-title', track.title);
  updateText('track-artist', track.artist);
  updateText('track-elapsed', formatTime(position));
  updateText('track-duration', formatTime(track.duration));
  trackSeek.max = String(track.duration);
  trackSeek.value = String(Math.floor(position));
  trackSeek.style.setProperty('--progress', `${position / track.duration * 100}%`);
  trackSeek.setAttribute('aria-valuetext', `${formatTime(position)} / ${formatTime(track.duration)}`);
  $('music-panel').classList.toggle('is-playing', playing);
  updatePlayButton(trackPlay, playing, playing ? '暂停播放演示' : '播放演示');
}
function setPlaying(value: boolean) {
  trackPosition = playbackPosition();
  if (value && trackPosition >= tracks[trackIndex].duration) trackPosition = 0;
  playing = value;
  trackStartedAt = performance.now();
  renderTrack();
}
function changeTrack(direction: number) {
  trackIndex = (trackIndex + direction + tracks.length) % tracks.length;
  trackPosition = 0;
  trackStartedAt = performance.now();
  renderTrack();
}
trackPlay.addEventListener('click', () => setPlaying(!playing));
$('track-previous').addEventListener('click', () => changeTrack(-1));
$('track-next').addEventListener('click', () => changeTrack(1));
trackSeek.addEventListener('input', () => {
  trackPosition = Number(trackSeek.value);
  trackStartedAt = performance.now();
  renderTrack();
});
renderTrack();

const focusDuration = 25 * 60;
let focusRemaining = focusDuration;
let focusEndsAt = 0;
let focusing = false;
const focusPlay = $('focus-play');
const focusTask = $<HTMLInputElement>('focus-task');
focusTask.value = storage.get('ascii-ocean-focus-task')?.slice(0, 100) || 'Make something good.';
focusTask.addEventListener('input', () => storage.set('ascii-ocean-focus-task', focusTask.value));
function remainingFocus() { return focusing ? Math.max(0, (focusEndsAt - Date.now()) / 1000) : focusRemaining; }
function renderFocus() {
  updateText('focus-time', formatTime(Math.ceil(remainingFocus())).padStart(5, '0'));
  const label = focusing ? '暂停专注' : focusRemaining < focusDuration && focusRemaining > 0 ? '继续专注' : '开始专注';
  updatePlayButton(focusPlay, focusing, label);
}
function setFocusing(value: boolean) {
  focusRemaining = remainingFocus();
  if (value && focusRemaining <= 0) focusRemaining = focusDuration;
  focusing = value;
  focusEndsAt = Date.now() + focusRemaining * 1000;
  renderFocus();
}
focusPlay.addEventListener('click', () => setFocusing(!focusing));
$('focus-reset').addEventListener('click', () => {
  focusing = false;
  focusRemaining = focusDuration;
  renderFocus();
});
renderFocus();

function applyLayout(value: Layout, animate = true) {
  // Hidden demos pause, so switching away never silently consumes a focus session.
  if (value !== 'music' && playing) setPlaying(false);
  if (value !== 'focus' && focusing) setFocusing(false);
  layout = value;
  closePanels();
  clearTimeout(statusTimer);
  $('thought-status').classList.remove('visible');
  for (const name of layouts) $(`${name}-panel`).hidden = name !== value;
  $('hero-title').textContent = headlines[value];
  $('layout-label').textContent = layoutNames[value];
  const next = layouts[(layouts.indexOf(value) + 1) % layouts.length];
  const description = `切换中间栏，当前${layoutNames[value]}，下一种${layoutNames[next]}`;
  $('layout-toggle').setAttribute('aria-label', description);
  $('layout-toggle').title = `${layoutNames[value]} · 点击切换${layoutNames[next]}`;
  document.querySelectorAll('.layout-dots i').forEach((dot, i) => dot.classList.toggle('active', i === layouts.indexOf(value)));
  storage.set('ascii-ocean-layout', value);
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of [$('hero-title'), ...layouts.map(name => $(`${name}-panel`))]) el.getAnimations().forEach(animation => animation.cancel());
    for (const el of [$('hero-title'), $(`${value}-panel`)]) el.animate([{ opacity: 0, translate: '0 5px' }, { opacity: 1, translate: '0 0' }], { duration: 230, easing: 'ease-out' });
  }
}
const savedLayout = storage.get('ascii-ocean-layout') as Layout | null;
applyLayout(savedLayout && layouts.includes(savedLayout) ? savedLayout : 'search', false);
$('layout-toggle').addEventListener('click', () => applyLayout(layouts[(layouts.indexOf(layout) + 1) % layouts.length]));
const demoTimer = window.setInterval(() => {
  if (playing) {
    if (playbackPosition() >= tracks[trackIndex].duration) changeTrack(1);
    else renderTrack();
  }
  if (focusing) {
    if (remainingFocus() <= 0) {
      setFocusing(false);
      status('这一刻，完成了。休息一下吧。');
      engine.ripple(window.innerWidth * .5, window.innerHeight * .6);
    } else renderFocus();
  }
}, 250);

const input = $<HTMLInputElement>('thought');
const send = $<HTMLButtonElement>('send');
function syncInput() {
  send.disabled = !input.value.trim();
}
input.addEventListener('input', syncInput);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.isComposing) e.preventDefault();
});
function renderHistory() {
  $('thought-count').textContent = String(thoughts.length).padStart(2, '0');
  $('empty-history').hidden = thoughts.length > 0;
  const list = $('history-list');
  list.replaceChildren();
  for (const thought of thoughts) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = thought.text;
    button.addEventListener('click', () => { applyLayout('search'); input.value = thought.text; syncInput(); input.focus(); });
    const time = document.createElement('time');
    time.dateTime = thought.date;
    time.textContent = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(thought.date));
    li.append(button, time); list.append(li);
  }
}
$<HTMLFormElement>('search-panel').addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  thoughts.unshift({ text, date: new Date().toISOString() });
  thoughts = thoughts.slice(0, 30);
  const saved = storage.set('ascii-ocean-thoughts', JSON.stringify(thoughts));
  renderHistory(); input.value = ''; syncInput();
  engine.ripple(window.innerWidth * .5, window.innerHeight * .6);
  status(saved ? '已留在 History，稍后再探索。' : '已留在本次打开的 History 中。');
});
renderHistory();
window.addEventListener('pagehide', () => { window.clearInterval(demoTimer); engine.destroy(); }, { once: true });

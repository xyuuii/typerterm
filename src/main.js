import '@fontsource/courier-prime/400.css';
import '@fontsource/courier-prime/700.css';
import '@fontsource/special-elite/400.css';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './icons.js';
import {InkExperience} from './engine/experience.js';
import {FORMATS, PAPER_COLORS, pageText, PAPER_FONT} from './engine/ink.js';
import {putMedia, deleteMedia, listMedia} from './engine/media-store.js';

const $ = id => document.getElementById(id);
const ui = {
  stage: $('stage'), loading: $('loading'), modeChip: $('modeChip'), focusHint: $('focusHint'), altHint: $('altHint'),
  pageNo: $('pageNo'), pageLabel: $('pageLabel'), rowcol: $('rowcol'), pagesCount: $('pagesCount'),
  formatBtn: $('formatBtn'), formatMenu: $('formatMenu'), formatLabel: $('formatLabel'),
  exportBtn: $('exportBtn'), exportMenu: $('exportMenu'), viewLabel: $('viewLabel'),
  terminalPanel: $('terminalPanel'), terminalHost: $('terminalHost'), termTitle: $('termTitle'),
  settings: $('settingsDrawer'), pagesDrawer: $('pagesDrawer'), pagesList: $('pagesList'), pagesEmpty: $('pagesEmpty'),
  toast: $('toast'), dialog: $('connectDialog'), form: $('connectForm'),
  musicDrawer: $('musicDrawer'), musicList: $('musicList'), slotList: $('slotList'), sceneTip: $('sceneTip'),
};

const prefs = load();
let engine = null;
let flat = false;

function load() {
  try { return JSON.parse(localStorage.getItem('ink-prefs') || '{}'); } catch { return {}; }
}
function save(patch) {
  Object.assign(prefs, patch);
  try { localStorage.setItem('ink-prefs', JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

async function start() {
  await Promise.allSettled([
    document.fonts.load('400 40px "Courier Prime"'),
    document.fonts.load('700 40px "Courier Prime"'),
    document.fonts.load('400 20px "Special Elite"'),
  ]);
  // Draw a few glyphs once so the system CJK/symbol fonts are resolved now,
  // behind the loading screen, instead of stalling the first keystroke.
  {
    const warm = document.createElement('canvas').getContext('2d');
    warm.font = `400 40px ${PAPER_FONT}`;
    warm.fillText('墨迹打字机，中文。ABC', 0, 40);
    warm.font = '700 26px "Courier Prime", Menlo, "Songti SC", "STSong", monospace';
    warm.fillText('中文 ─│╭ ⣿ █ ▁', 0, 40);
  }
  engine = new InkExperience({
    container: ui.stage,
    terminalElement: ui.terminalHost,
    quality: prefs.quality || 'auto',
    onInfo: info,
    onConnection: connection,
    onPageArchived: (page, archive) => renderPages(archive),
  });
  try {
    await engine.init();
  } catch (err) {
    ui.loading.querySelector('p').textContent = `三维场景无法启动：${err.message}`;
    console.error(err);
    return;
  }
  applyPrefs();
  engine.music.onChange(() => renderMusic());
  restoreMedia();
  if (import.meta.env.DEV) window.__ink = engine;
  ui.loading.classList.add('done');
  setTimeout(() => ui.loading.remove(), 900);
  ui.focusHint.hidden = false;
}

function applyPrefs() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefs.paper) engine.setPaperColor(PAPER_COLORS.find(p => p.id === prefs.paper)?.color || PAPER_COLORS[0].color);
  if (prefs.light) engine.setLight(prefs.light);
  if (prefs.format && prefs.format !== 'a4') engine.setFormat(prefs.format);
  engine.setMotion(prefs.motion ?? !reduced);
  $('motion').checked = prefs.motion ?? !reduced;
  engine.magicResize = prefs.magicResize ?? true;
  $('magicResize').checked = engine.magicResize;
  engine.setVolume((prefs.volume ?? 80) / 100);
  engine.setAmbient((prefs.ambient ?? 45) / 100);
  applyClearView();
  syncSettingsUI();
}

// ---- info from the engine ----------------------------------------------------
function info(patch) {
  if ('quality' in patch || 'qualityMode' in patch) {
    const label = {high: '高', medium: '中', low: '低'}[patch.quality || engine?.quality];
    $('qualityStatus').textContent = (patch.qualityMode || engine?.qualityMode) === 'auto' ? `自动调节 · 当前${label}画质` : `${label}画质`;
  }
  if ('page' in patch) { ui.pageNo.textContent = String(patch.page).padStart(2, '0'); ui.pageLabel.textContent = patch.page; }
  if ('row' in patch || 'col' in patch) {
    const i = engine?.info || patch;
    ui.rowcol.textContent = i.row ? `行 ${String(i.row).padStart(2, '0')} · 列 ${String(i.col).padStart(2, '0')}` : '光标不在本页';
  }
  if ('pages' in patch) ui.pagesCount.textContent = patch.pages;
  if ('focused' in patch) ui.focusHint.classList.toggle('away', patch.focused);
  if ('mode' in patch) {
    const live = patch.mode === 'ssh';
    ui.modeChip.classList.toggle('live', live);
    ui.modeChip.classList.toggle('busy', patch.mode === 'connecting');
    ui.modeChip.querySelector('span').textContent = live ? 'SSH 已连接' : patch.mode === 'connecting' ? '正在连接…' : '演示模式';
    ui.termTitle.textContent = `标准终端 · ${live ? 'SSH' : '演示'}`;
    $('demoBtn').disabled = live;
    $('disconnectBtn').hidden = !live;
  }
  if ('alternate' in patch) {
    ui.altHint.hidden = !patch.alternate;
    ui.focusHint.classList.toggle('alt', patch.alternate);
    clearTimeout(altHintTimer);
    if (patch.alternate) altHintTimer = setTimeout(() => { ui.altHint.hidden = true; }, 6000);
    $('newPageBtn').disabled = patch.alternate;
    ui.formatBtn.disabled = patch.alternate;
  }
  if ('format' in patch) { ui.formatLabel.textContent = FORMATS[patch.format].short; $('formatShort').textContent = FORMATS[patch.format].short; if (flat) fitTerminal(); }
  if (patch.toast?.kind === 'page') pageToast(patch.toast.page);
  if (patch.openPages) openDrawer(ui.pagesDrawer);
  if (patch.pickImage) pickImage(patch.pickImage);
  if (patch.music === 'add') $('musicInput').click();
  if (patch.music === 'open') openDrawer(ui.musicDrawer);
  if ('hover' in patch) sceneTip(patch.hover);
}
function sceneTip(h) {
  const tip = ui.sceneTip;
  if (!h) { tip.hidden = true; return; }
  tip.textContent = h.label;
  tip.hidden = false;
  const x = Math.min(window.innerWidth - tip.offsetWidth - 12, h.x + 16);
  tip.style.transform = `translate(${Math.max(8, x)}px, ${h.y + 18}px)`;
}

// ---- your own pictures on the walls -------------------------------------------------
let pendingSlot = null;
function pickImage(id) {
  pendingSlot = id;
  $('imageInput').value = '';
  $('imageInput').click();
}
$('imageInput').onchange = async e => {
  const file = e.target.files?.[0];
  const id = pendingSlot;
  pendingSlot = null;
  if (!file || !id) return;
  try {
    const jpeg = await engine.setSlotImage(id, file);
    if (jpeg) await putMedia({id: `image:${id}`, kind: 'image', slot: id, name: file.name, blob: jpeg, order: Date.now()});
    customSlots.add(id);
    renderSlots();
    notify('已换上你的图片');
  } catch (err) {
    console.warn(err);
    notify('这张图片无法读取，换一张试试');
  }
};
async function resetSlot(id) {
  engine.resetSlot(id);
  customSlots.delete(id);
  await deleteMedia(`image:${id}`);
  renderSlots();
}
function renderSlots() {
  if (!engine) return;
  ui.slotList.innerHTML = '';
  for (const slot of engine.slots) {
    const li = document.createElement('li');
    const thumb = document.createElement('canvas');
    thumb.width = 96; thumb.height = Math.round(96 / Math.max(0.6, slot.aspect));
    thumb.className = 'slot-thumb';
    const pic = engine.slotPicture(slot.id);
    if (pic) { try { thumb.getContext('2d').drawImage(pic, 0, 0, thumb.width, thumb.height); } catch { /* not ready yet */ } }
    const label = document.createElement('span');
    label.textContent = slot.label.replace(/（.*）/, '');
    const change = document.createElement('button');
    change.type = 'button'; change.className = 'mini'; change.textContent = '换图';
    change.onclick = () => pickImage(slot.id);
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'mini ghost'; reset.textContent = '恢复';
    reset.title = '恢复原来的画';
    reset.hidden = !customSlots.has(slot.id);
    reset.onclick = () => resetSlot(slot.id);
    li.append(thumb, label, change, reset);
    ui.slotList.append(li);
  }
}
const customSlots = new Set();
async function restoreMedia() {
  try {
    for (const rec of await listMedia('image')) {
      try { await engine.setSlotImage(rec.slot, rec.blob); customSlots.add(rec.slot); } catch (err) { console.warn('could not restore picture', err); }
    }
  } catch (err) { console.warn(err); }
  renderSlots();
  await engine.music.restore();
  const vol = prefs.musicVolume ?? 70;
  engine.music.setVolume(vol / 100);
  $('musicVolume').value = String(vol);
  $('musicVolumeOut').textContent = `${vol}%`;
  engine.music.setLoop(prefs.musicLoop || 'all');
}

// ---- music ---------------------------------------------------------------------------
const fmtTime = t => { if (!isFinite(t) || t < 0) t = 0; return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
$('musicBtn').onclick = () => openDrawer(ui.musicDrawer);
$('musicAdd').onclick = () => $('musicInput').click();
$('musicInput').onchange = async e => {
  const files = e.target.files;
  if (!files?.length) return;
  engine.sound.unlock();
  const n = await engine.music.add(files);
  e.target.value = '';
  notify(n ? `已添加 ${n} 首音乐` : '没有可以播放的音频文件');
};
$('musicPlay').onclick = () => { if (!engine.music.tracks.length) $('musicInput').click(); else engine.music.toggle(); };
$('musicPrev').onclick = () => engine.music.prev();
$('musicNext').onclick = () => engine.music.next();
$('musicSeek').oninput = e => engine.music.seek(+e.target.value / 1000);
$('musicVolume').oninput = e => { const v = +e.target.value; engine.music.setVolume(v / 100); $('musicVolumeOut').textContent = `${v}%`; save({musicVolume: v}); };
$('musicLoop').onclick = () => { const mode = engine.music.loop === 'one' ? 'all' : 'one'; engine.music.setLoop(mode); save({musicLoop: mode}); };
function renderMusic() {
  const m = engine.music;
  const cur = m.current;
  $('npTitle').textContent = cur ? cur.name : '还没有音乐';
  $('npSub').textContent = m.error || (cur ? `${m.index + 1} / ${m.tracks.length} · ${m.playing ? '正在播放' : '已暂停'}` : '点“添加音乐”，选择电脑里的音频文件');
  const play = $('musicPlay');
  play.querySelector('svg-icon').setAttribute('name', m.playing ? 'pause' : 'play');
  play.setAttribute('aria-label', m.playing ? '暂停' : '播放');
  $('musicLoop').textContent = m.loop === 'one' ? '单曲循环' : '列表循环';
  $('musicLoop').setAttribute('aria-pressed', String(m.loop === 'one'));
  ui.musicList.innerHTML = '';
  m.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.classList.toggle('current', i === m.index);
    const name = document.createElement('button');
    name.type = 'button'; name.className = 'track';
    name.innerHTML = `<i>${i === m.index && m.playing ? '♪' : String(i + 1).padStart(2, '0')}</i>`;
    const span = document.createElement('span');
    span.textContent = t.name;
    name.append(span);
    name.onclick = () => m.select(i, true);
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'mini ghost'; del.setAttribute('aria-label', `移除 ${t.name}`);
    del.innerHTML = '<svg-icon name="trash"></svg-icon>';
    del.onclick = () => m.remove(t.id);
    li.append(name, del);
    ui.musicList.append(li);
  });
}
setInterval(() => {
  if (!engine?.music || ui.musicDrawer.hidden) return;
  const m = engine.music;
  $('npTime').textContent = fmtTime(m.time);
  $('npDur').textContent = fmtTime(m.duration);
  if (document.activeElement !== $('musicSeek')) $('musicSeek').value = String(Math.round(m.progress * 1000));
}, 250);

let toastTimer = 0;
let altHintTimer = 0;
function pageToast(page) {
  if (!page) return;
  const t = ui.toast;
  t.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = `第 ${page.number} 页落到了桌上`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '导出这页 PDF';
  btn.onclick = () => runExport([page]);
  const all = document.createElement('button');
  all.type = 'button';
  all.textContent = '查看纸页';
  all.onclick = () => { openDrawer(ui.pagesDrawer); t.hidden = true; };
  t.append(label, btn, all);
  t.hidden = false;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
}
function notify(text) {
  const t = ui.toast;
  t.textContent = text;
  t.hidden = false;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---- pages drawer --------------------------------------------------------------
function renderPages(archive) {
  ui.pagesList.innerHTML = '';
  ui.pagesEmpty.hidden = archive.length > 0;
  [...archive].reverse().forEach(page => {
    const li = document.createElement('li');
    const thumb = engine.pageThumbnail(page, 0.16);
    thumb.className = 'thumb';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const first = pageText(page).split('\n').find(s => s.trim()) || '';
    meta.innerHTML = `<b>第 ${page.number} 页</b><small>${FORMATS[page.format].label} · ${new Date(page.createdAt).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}</small>`;
    const p = document.createElement('p');
    p.textContent = first.slice(0, 40);
    meta.append(p);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini';
    btn.textContent = 'PDF';
    btn.title = '导出这一页';
    btn.onclick = () => runExport([page]);
    li.append(thumb, meta, btn);
    ui.pagesList.append(li);
  });
}
async function runExport(which) {
  try {
    if (which === 'text') { engine.exportText(); notify('已导出文本'); return; }
    const n = await engine.exportPdf(which);
    notify(`已导出 ${n} 页 PDF`);
  } catch (err) {
    notify(err.message || '导出失败');
  }
}

// ---- toolbar ----------------------------------------------------------------------
$('demoBtn').onclick = () => { engine.sound.unlock(); engine.focus(); engine.input('demo\r'); };
$('newPageBtn').onclick = () => { engine.sound.unlock(); engine.newPage(); engine.focus(); };
$('pagesBtn').onclick = () => openDrawer(ui.pagesDrawer);
$('settingsBtn').onclick = () => openDrawer(ui.settings);
const views = [['desk', '桌面'], ['paper', '阅读'], ['room', '房间']];
let viewIndex = 0;
$('viewBtn').onclick = () => {
  viewIndex = (viewIndex + 1) % views.length;
  engine.setView(views[viewIndex][0]);
  ui.viewLabel.textContent = views[viewIndex][1];
};
$('clearBtn').onclick = () => {
  save({clearView: !(prefs.clearView ?? false)});
  applyClearView();
  engine.focus();
};
function applyClearView() {
  const on = prefs.clearView ?? false;
  engine.setClearView(on);
  $('clearBtn').setAttribute('aria-pressed', String(on));
  $('clearBtn').classList.toggle('selected', on);
}
$('termBtn').onclick = () => setFlat(!flat);
$('termClose').onclick = () => setFlat(false);
$('altOpen').onclick = () => setFlat(true);
ui.focusHint.onclick = () => engine.focus();
$('muteBtn').onclick = () => {
  const muted = !(prefs.muted ?? false);
  save({muted});
  engine.setMuted(muted);
  syncSettingsUI();
};
function setFlat(v) {
  flat = v;
  const panel = ui.terminalPanel;
  if (v) { panel.style.left = ''; panel.style.top = ''; }
  panel.classList.toggle('open', v);
  $('termBtn').classList.toggle('selected', v);
  requestAnimationFrame(() => { fitTerminal(); dockInsets(); });
  if (!v) engine?.setInsets({right: 0, bottom: 0});
  setTimeout(() => engine.focus(), 30);
}
// The standard terminal docks to the right (wide screens) or the bottom
// (narrow screens); the 3D view slides over so the machine stays visible.
function dockInsets() {
  if (!flat || !engine) return;
  const r = ui.terminalPanel.getBoundingClientRect();
  if (window.innerWidth >= 900) engine.setInsets({right: Math.max(0, window.innerWidth - r.left + 10), bottom: 0});
  else engine.setInsets({right: 0, bottom: Math.max(0, window.innerHeight - r.top + 10)});
}
// Size the standard terminal's font so the whole grid fits the panel.
function fitTerminal() {
  const term = engine?.term;
  if (!term) return;
  const host = ui.terminalHost;
  const maxW = (flat ? host.clientWidth : Math.min(920, window.innerWidth - 32)) - 36;
  const maxH = (flat ? host.clientHeight : window.innerHeight - 280) - 30;
  const size = Math.floor(Math.min(maxH / (term.rows * 1.18), maxW / (term.cols * 0.62)));
  term.options.fontSize = Math.max(7, Math.min(15, size));
}
// While typing on the paper, keep xterm's (invisible) input right under the
// printing line, so the system IME candidate window opens there instead of
// over the sheet.
function anchorIme() {
  if (flat || !engine?.focused) return;
  const p = engine.printPointScreen();
  const ta = engine.textarea;
  if (!p || !ta) return;
  const panel = ui.terminalPanel;
  const r = ta.getBoundingClientRect();
  const dx = (p.x - 12) - r.left, dy = (p.y + 22) - r.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  const pr = panel.getBoundingClientRect();
  panel.style.left = `${pr.left + dx}px`;
  panel.style.top = `${pr.top + dy}px`;
}
setInterval(anchorIme, 150);
window.addEventListener('resize', () => { if (flat) { fitTerminal(); dockInsets(); } });

// Menus.
function menu(button, panel) {
  button.onclick = e => {
    e.stopPropagation();
    const open = panel.hidden;
    closeMenus();
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
}
function closeMenus() {
  for (const [b, m] of [[ui.formatBtn, ui.formatMenu], [ui.exportBtn, ui.exportMenu]]) { m.hidden = true; b.setAttribute('aria-expanded', 'false'); }
}
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenus(); });
menu(ui.formatBtn, ui.formatMenu);
menu(ui.exportBtn, ui.exportMenu);
for (const f of Object.values(FORMATS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'menuitemradio');
  b.dataset.format = f.id;
  const shape = document.createElement('i');
  shape.className = 'shape';
  const ratio = f.height / f.width;
  shape.style.width = `${ratio > 1 ? 14 / ratio : 22}px`;
  shape.style.height = `${ratio > 1 ? 14 : 22 * ratio}px`;
  const label = document.createElement('span');
  label.innerHTML = `<b>${f.label}</b><small>${f.id === 'wide' ? '屏幕比例，适合截图分享' : f.id === 'a4' ? '210 × 297 mm，适合打印' : '方形，适合便签/社交'}</small>`;
  b.append(shape, label);
  b.onclick = () => {
    closeMenus();
    engine.setFormat(f.id);
    save({format: f.id});
    syncSettingsUI();
    engine.focus();
  };
  ui.formatMenu.append(b);
}
for (const el of document.querySelectorAll('[data-export]')) el.addEventListener('click', () => { closeMenus(); runExport(el.dataset.export); });

// Drawers.
function openDrawer(d) {
  for (const other of [ui.settings, ui.pagesDrawer, ui.musicDrawer]) if (other !== d) other.hidden = true;
  d.hidden = false;
  if (d === ui.settings) renderSlots();
  if (d === ui.musicDrawer) renderMusic();
  requestAnimationFrame(() => d.classList.add('open'));
}
function closeDrawer(d) {
  d.classList.remove('open');
  setTimeout(() => { if (!d.classList.contains('open')) d.hidden = true; }, 260);
}
for (const d of [ui.settings, ui.pagesDrawer, ui.musicDrawer]) d.querySelector('[data-close]').onclick = () => closeDrawer(d);
// Escape closes drawers and menus. It is never taken from the terminal
// (vim, readline and full-screen programs need it), so the standard
// terminal panel closes with its × button or the toolbar button.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  for (const d of [ui.settings, ui.pagesDrawer, ui.musicDrawer]) if (!d.hidden) closeDrawer(d);
  closeMenus();
});

// Settings controls.
for (const p of PAPER_COLORS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.dataset.paper = p.id;
  b.innerHTML = `<i style="background:${p.color}"></i><span>${p.label}</span>`;
  b.onclick = () => { engine.setPaperColor(p.color); save({paper: p.id}); syncSettingsUI(); };
  $('swatches').append(b);
}
for (const b of $('lightSeg').querySelectorAll('button')) b.onclick = () => { engine.setLight(b.dataset.light); save({light: b.dataset.light}); syncSettingsUI(); };
for (const b of $('qualitySeg').querySelectorAll('button')) b.onclick = () => { engine.setQuality(b.dataset.quality); save({quality: b.dataset.quality}); syncSettingsUI(); };
$('intensity').oninput = e => { const v = +e.target.value; engine.setIntensity(v / 100); $('intensityOut').textContent = `${v}%`; save({intensity: v}); };
$('volume').oninput = e => { const v = +e.target.value; engine.sound.unlock(); engine.setVolume(v / 100); $('volumeOut').textContent = `${v}%`; save({volume: v}); };
$('ambient').oninput = e => { const v = +e.target.value; engine.sound.unlock(); engine.setAmbient(v / 100); $('ambientOut').textContent = `${v}%`; save({ambient: v}); };
$('stiffness').oninput = e => { const v = +e.target.value; engine.setStiffness(v / 100); $('stiffnessOut').textContent = v < 40 ? '柔软' : v > 75 ? '挺括' : '适中'; save({stiffness: v}); };
$('motion').onchange = e => { engine.setMotion(e.target.checked); save({motion: e.target.checked}); };
$('magicResize').onchange = e => { engine.magicResize = e.target.checked; save({magicResize: e.target.checked}); };
function syncSettingsUI() {
  const paper = prefs.paper || 'ivory';
  for (const b of $('swatches').children) b.setAttribute('aria-checked', String(b.dataset.paper === paper));
  for (const b of $('lightSeg').children) b.setAttribute('aria-checked', String(b.dataset.light === (prefs.light || 'afternoon')));
  for (const b of $('qualitySeg').children) b.setAttribute('aria-checked', String(b.dataset.quality === engine.qualityMode));
  for (const b of ui.formatMenu.children) b.setAttribute('aria-checked', String(b.dataset.format === (prefs.format || 'a4')));
  ui.formatLabel.textContent = FORMATS[prefs.format || 'a4'].short;
  $('formatShort').textContent = FORMATS[prefs.format || 'a4'].short;
  for (const [id, key, def] of [['intensity', 'intensity', 100], ['volume', 'volume', 80], ['ambient', 'ambient', 45], ['stiffness', 'stiffness', 60]]) {
    const v = prefs[key] ?? def;
    $(id).value = v;
    $(id).dispatchEvent(new Event('input'));
  }
  const muted = prefs.muted ?? false;
  engine?.setMuted?.(muted);
  $('muteBtn').setAttribute('aria-pressed', String(muted));
  $('muteBtn').querySelector('svg-icon').setAttribute('name', muted ? 'mute' : 'volume');
  $('muteBtn').querySelector('span').textContent = muted ? '静音' : '声音';
  $('muteBtn').setAttribute('aria-label', muted ? '取消静音' : '静音');
}

// ---- SSH connection dialog ---------------------------------------------------------
const local = location.hostname === '127.0.0.1';
let auth = 'password';
$('connectLead').textContent = local ? '页面和 SSH 桥接服务都运行在你的电脑上（仅监听 127.0.0.1）。' : '当前是在线/开发演示。真实连接需要运行项目里的本机服务。';
$('guide').hidden = local;
$('fields').hidden = !local;
$('connectBtn').onclick = () => { engine?.blur(); ui.dialog.showModal(); };
ui.dialog.querySelector('[data-close]').onclick = () => closeDialog();
ui.dialog.addEventListener('cancel', e => { e.preventDefault(); closeDialog(); });
function closeDialog() {
  if (!$('hostkey').hidden) { engine.verifyHost(false); $('hostkey').hidden = true; }
  ui.dialog.close();
}
for (const b of $('authSeg').children) b.onclick = () => {
  auth = b.dataset.auth;
  for (const x of $('authSeg').children) x.setAttribute('aria-checked', String(x === b));
  for (const f of ui.form.querySelectorAll('[data-auth-field]')) f.hidden = f.dataset.authField !== auth;
};
ui.form.onsubmit = async e => {
  e.preventDefault();
  const data = new FormData(ui.form);
  let privateKey;
  if (auth === 'key') {
    const file = data.get('keyfile');
    if (!(file instanceof File) || !file.size) { status('请选择私钥文件'); return; }
    if (file.size > 65536) { status('私钥文件超过 64 KB'); return; }
    privateKey = await file.text();
  } else if (!data.get('password')) { status('请输入密码'); return; }
  status('正在连接本机服务…');
  $('hostkey').hidden = true;
  engine.connect({
    token: String(data.get('token') || ''), host: String(data.get('host') || '').trim(), port: Number(data.get('port')), username: String(data.get('username') || '').trim(),
    ...(auth === 'password' ? {password: String(data.get('password'))} : {privateKey, ...(data.get('passphrase') ? {passphrase: String(data.get('passphrase'))} : {})}),
  });
  // Clear secrets from the form right away.
  for (const name of ['password', 'passphrase', 'token']) ui.form.elements[name].value = '';
  ui.form.elements.keyfile.value = '';
};
$('trustBtn').onclick = () => { engine.verifyHost(true); $('hostkey').hidden = true; status('已确认指纹，正在认证…'); };
$('rejectBtn').onclick = () => { engine.verifyHost(false); $('hostkey').hidden = true; status('已取消'); };
$('disconnectBtn').onclick = () => { engine.disconnect(); status('已断开连接'); };
function status(text) { $('connectStatus').textContent = text; }
function connection(s) {
  status(s.message || '');
  if (s.type === 'hostkey') { $('fingerprint').textContent = s.fingerprint; $('hostkey').hidden = false; }
  if (s.type === 'connected') { $('hostkey').hidden = true; setTimeout(() => { ui.dialog.close(); engine.focus(); }, 500); notify('SSH 已连接'); }
  if (s.type === 'closed' || s.type === 'error') $('hostkey').hidden = true;
}

start();

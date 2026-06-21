'use strict';

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */
const API = {
  async maps()        { return (await fetch('/api/maps')).json(); },
  async mapThemes()   { return (await fetch('/api/map-themes')).json(); },
  async map(n)        { return (await fetch('/api/maps/' + encodeURIComponent(n))).json(); },
  saveMap(n, obj)     { return fetch('/api/maps/' + encodeURIComponent(n),
                          { method:'PUT', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify(obj) }); },
  delMap(n)           { return fetch('/api/maps/' + encodeURIComponent(n), { method:'DELETE' }); },
  saveMapThemes(obj)  { return fetch('/api/map-themes',
                          { method:'PUT', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify(obj) }); },
  async terrains()    { return (await fetch('/api/terrains')).json(); },
  saveTerrains(obj)   { return fetch('/api/terrains',
                          { method:'PUT', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify(obj) }); },
  async enemies()     { return (await fetch('/api/enemies')).json(); },
  saveEnemies(obj)    { return fetch('/api/enemies',
                          { method:'PUT', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify(obj) }); },
  async enemyEnums()  { return (await fetch('/api/enemy-enums')).json(); },
  async tiletype()    { return (await fetch('/api/tiletype')).json(); },
  async prefs()       { return (await fetch('/api/prefs')).json(); },
  savePrefs(obj)      { return fetch('/api/prefs',
                          { method:'PUT', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify(obj) }); },
  async pick(kind, title) { return (await fetch('/api/pick',
                          { method:'POST', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify({ kind, title }) })).json(); },
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
const state = {
  terrains: [], terrainById: {}, themes: [],
  units: [], enemyConfig: { units: [] },
  enemyEnums: { professions: [], skills: [], equipments: [] },
  unitsDirty: false, unitsSavedJson: '',
  abbrevs: {},                    // unit name -> unique 3-letter map marker
  maps: [],                       // [{name, theme}]
  flowConfig: { mapThemes: [] }, flowDirty: false, flowSavedJson: '',
  flowExpanded: new WeakSet(), flowDrag: null,
  current: null, currentName: null, dirty: false, savedJson: '',
  mode: 'terrain',
  activeTerrainId: 1, tool: 'brush',
  activePreset: 0, activeUnitId: null, selectedEnemy: null,
  cellSize: 32,
  panX: 0, panY: 0,              // canvas translate (px); free pan like Photoshop
  cellEls: [], drag: null, hoverCell: null, panDrag: null,
  brushRadius: 0,                 // 0 = single cell; r => (2r+1)² square
  deploySet: new Set(),          // "x,y" membership for the free-form deploy region
  undoStack: [], redoStack: [],
};

const $ = sel => document.querySelector(sel);

/* ------------------------------------------------------------------ *
 * Inline SVG icons (single source of truth; monochrome, currentColor)
 * Used both for static markup (via [data-ico] hydration) and dynamic UI.
 * ------------------------------------------------------------------ */
const ICON_PATHS = {
  map:       '<path d="M14.5 4.5 9 2 3.6 4.7A1 1 0 0 0 3 5.6v13.1a1 1 0 0 0 1.4.9L9 17.5l6 2.5 5.4-2.7a1 1 0 0 0 .6-.9V3.3a1 1 0 0 0-1.4-.9z"/><path d="M9 2v15.5"/><path d="M15 6.5V22"/>',
  search:    '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  refresh:   '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  settings:  '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  undo:      '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H8"/>',
  redo:      '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H16"/>',
  save:      '<path d="M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8a2 2 0 0 0-.6-1.4l-3.8-3.8A2 2 0 0 0 15.2 3z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  tag:       '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/>',
  plus:      '<path d="M5 12h14"/><path d="M12 5v14"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown:  '<path d="m6 9 6 6 6-6"/>',
  arrowLeft:  '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  arrowUp:    '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  arrowDown:  '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  x:          '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  trash:      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  check:      '<path d="M20 6 9 17l-5-5"/>',
  download:   '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  grip:       '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  palette:    '<circle cx="13.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="17.5" cy="10.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="6.5" cy="12.5" r="1.2" fill="currentColor" stroke="none"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1a1.6 1.6 0 0 1 1.6-1.6h2c3 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2z"/>',
  skull:      '<path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M11 17h2"/>',
  flag:       '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  route:      '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  brush:      '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  square:     '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  copy:       '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  bucket:     '<path d="M19 11 9 1 7.6 2.4l2.1 2.1L3.5 10.7a2 2 0 0 0 0 2.8l5 5a2 2 0 0 0 2.8 0L19 11z"/><path d="m5 11 8 0"/><path d="M20.5 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z" fill="currentColor" stroke="none"/>',
};
function icon(name) {
  const p = ICON_PATHS[name];
  if (!p) return '';
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
/* Replace every <span data-ico="name"> placeholder in static markup with its SVG. */
function hydrateIcons(root) {
  (root || document).querySelectorAll('[data-ico]').forEach(el => { el.outerHTML = icon(el.dataset.ico); });
}
/* Build a button with a leading icon (mirrors mkBtn but renders an SVG). */
function mkIconBtn(name, label, fn) {
  const b = document.createElement('button'); b.className = 'mini';
  b.innerHTML = icon(name) + (label ? `<span>${escapeHtml(label)}</span>` : '');
  if (label) b.title = label;
  b.onclick = fn; return b;
}

/* ------------------------------------------------------------------ *
 * Init
 * ------------------------------------------------------------------ */
async function init() {
  hydrateIcons();
  try {
    const [t, e, enemyEnums, m, flow] = await Promise.all([
      API.terrains(), API.enemies(), API.enemyEnums(), API.maps(), API.mapThemes(),
    ]);
    state.terrains = t.terrains || [];
    state.themes = t.themes || [];
    indexTerrains();
    setEnemyConfig(e); setEnemyEnums(enemyEnums);
    state.maps = m.maps || [];
    setFlowConfig(flow);
  } catch (err) {
    await showAlert('无法连接本地服务，请确认 start.bat 正在运行。\n' + err, '连接失败');
    return;
  }
  state.activeTerrainId = (state.terrains.find(t => t.id !== 0) || state.terrains[0] || {id:0}).id;
  recomputeAbbrevs();
  bindUI();
  populateMapThemeSelect();
  renderMapList();
  renderRight();
  updateUndoButtons();
  if (state.maps.length) loadMap(state.maps[0].name);
  else { $('#emptyHint').classList.remove('hidden'); updateTitle(); }
}

function indexTerrains() {
  state.terrainById = {};
  for (const t of state.terrains) state.terrainById[t.id] = t;
}

/* Re-read maps + configs from disk (server reads fresh each request). */
async function refreshAll() {
  if ((state.dirty || state.unitsDirty || state.flowDirty) &&
      !await showConfirm('刷新会丢弃未保存的地图、EnemyUnit 或关卡流程修改并从磁盘重读，继续？')) return;
  let t, e, enemyEnums, m, flow;
  try {
    [t, e, enemyEnums, m, flow] = await Promise.all([
      API.terrains(), API.enemies(), API.enemyEnums(), API.maps(), API.mapThemes(),
    ]);
  } catch (err) { return showAlert('刷新失败：' + err); }
  state.dirty = false;                       // already confirmed -> skip loadMap's prompt
  state.terrains = t.terrains || []; state.themes = t.themes || [];
  indexTerrains(); setEnemyConfig(e); setEnemyEnums(enemyEnums); state.maps = m.maps || [];
  setFlowConfig(flow);
  const keep = (state.currentName && state.maps.some(x => x.name === state.currentName))
    ? state.currentName : (state.maps[0] && state.maps[0].name);
  recomputeAbbrevs(); populateMapThemeSelect(); renderMapList();
  if (keep) { await loadMap(keep); }
  else {
    state.current = null; state.currentName = null;
    $('#grid').innerHTML = ''; $('#colRuler').innerHTML = ''; $('#rowRuler').innerHTML = '';
    $('#emptyHint').classList.remove('hidden');
    updateTitle(); renderRight(); updateUndoButtons();
  }
  if (state.mode === 'flow') renderFlowEditor();
  toast('已从磁盘刷新');
}

/* Settings: choose Maps folder / EnemyUnits / TileType paths (persisted in prefs.json). */
async function openSettings() {
  const data = await API.prefs();
  const layer = $('#modalLayer'); layer.classList.remove('hidden');
  const box = document.createElement('div'); box.className = 'modal'; box.style.minWidth = '560px';
  box.innerHTML = `<h2>${icon('settings')}<span>路径设置</span></h2>`;
  box.appendChild(hint('指向你游戏工程里的实际文件，即可直接编辑/读取。留空=用默认内置路径。改动会立即保存到 config/prefs.json，下次启动自动加载。'));

  const fields = [
    { key: 'mapsDir',      label: 'Maps 文件夹', kind: 'dir',  defaultLabel: '软件目录/Maps' },
    { key: 'enemyFile',    label: 'EnemyUnits 文件', kind: 'file', defaultLabel: '软件目录/config/EnemyUnits.json' },
    { key: 'tileTypeFile', label: 'TileType 文件', kind: 'file', defaultLabel: '软件目录/config/TileType.cs' },
    { key: 'professionFile', label: 'Profession 文件', kind: 'file', defaultLabel: '软件目录/config/Profession.cs' },
    { key: 'skillFile',      label: 'Skill 文件', kind: 'file', defaultLabel: '软件目录/config/Skill.cs' },
    { key: 'equipmentFile',  label: 'Equipment 文件', kind: 'file', defaultLabel: '软件目录/config/Equipment.cs' },
    { key: 'mapThemesFile',  label: 'MapThemes 文件', kind: 'file', defaultLabel: '软件目录/config/MapThemes.json' },
  ];
  const inputs = {};
  for (const f of fields) {
    const row = document.createElement('div'); row.className = 'path-row';
    const lab = labelEl(f.label);
    // The input contains only an explicit user override. The effective built-in
    // default is shown as a placeholder, so merely opening + saving this dialog
    // never freezes the editor's current absolute location into prefs.json.
    const inp = inputEl('text', (data.set && data.set[f.key]) || '');
    inp.placeholder = `默认：${f.defaultLabel}`;
    const ex = document.createElement('span'); ex.className = 'path-ok';
    ex.innerHTML = icon(data.exists[f.key] ? 'check' : 'x'); ex.style.color = data.exists[f.key] ? 'var(--ok)' : 'var(--danger)';
    const browse = mkBtn('浏览…', async () => {
      const r = await API.pick(f.kind, f.label);
      if (r.error) return showAlert('系统选择框不可用，请直接粘贴路径。\n(' + r.error + ')');
      if (r.path) { inp.value = r.path; ex.innerHTML = icon('check'); ex.style.color = 'var(--ok)'; }
    });
    inputs[f.key] = inp;
    row.append(lab, inp, browse, ex); box.appendChild(row);
  }

  const actions = document.createElement('div'); actions.className = 'actions';
  const reset = mkBtn('恢复默认', () => { for (const f of fields) inputs[f.key].value = ''; });
  const cancel = mkBtn('取消', close);
  const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = '保存并重载';
  ok.onclick = async () => {
    const discarding = state.dirty || state.unitsDirty || state.flowDirty;
    if (discarding && !await showConfirm('更换路径并重载会丢弃未保存的地图、EnemyUnit 或关卡流程修改，继续？')) return;
    const body = {}; for (const f of fields) body[f.key] = inputs[f.key].value.trim();
    const r = await API.savePrefs(body).then(x => x.json());
    if (!r.ok) return showAlert('保存失败：\n' + (r.errors || ['未知错误']).join('\n'));
    if (discarding) { state.dirty = false; state.unitsDirty = false; state.flowDirty = false; }
    close(); await refreshAll();
  };
  actions.append(reset, cancel, ok); box.appendChild(actions);
  layer.innerHTML = ''; layer.appendChild(box);
  layer.onclick = e => { if (e.target === layer) close(); };
  function close() { layer.classList.add('hidden'); layer.innerHTML = ''; layer.onclick = null; }
}

/* ------------------------------------------------------------------ *
 * UI bindings
 * ------------------------------------------------------------------ */
function bindUI() {
  document.querySelectorAll('#modeTabs button').forEach(b =>
    b.onclick = () => setMode(b.dataset.mode));
  $('#newMapBtn').onclick  = newMap;
  $('#themesBtn').onclick  = manageThemes;
  $('#dupBtn').onclick     = duplicateMap;
  $('#renameBtn').onclick  = renameMap;
  $('#resizeBtn').onclick  = resizeMap;
  $('#delBtn').onclick      = deleteMap;
  $('#saveBtn').onclick    = saveCurrent;
  $('#refreshBtn').onclick = refreshAll;
  $('#settingsBtn').onclick = openSettings;
  $('#undoBtn').onclick    = undo;
  $('#redoBtn').onclick    = redo;
  $('#mapTheme').onchange  = onMapThemeChange;
  $('#inferBtn').onclick   = inferCurrentTheme;
  $('#addFlowThemeBtn').onclick = addFlowTheme;
  const zoom = $('#zoom'); zoom.value = state.cellSize;
  zoom.oninput = e => setZoom(+e.target.value);     // zoom around the viewport center

  const wrap = $('#gridWrap');
  // wheel = zoom (around viewport center); Ctrl+wheel = brush radius (terrain/brush only)
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) {
      if (state.mode === 'terrain' && state.tool === 'brush') {
        state.brushRadius = clamp(state.brushRadius + (e.deltaY < 0 ? 1 : -1), 0, 6);
        syncBrushUI();
        if (state.hoverCell) setOverlay('brush-hi', brushCoords(state.hoverCell.x, state.hoverCell.y));
      }
      return;
    }
    const nc = clamp(Math.round(state.cellSize * (e.deltaY < 0 ? 1.15 : 1 / 1.15)), 6, 120);
    if (nc !== state.cellSize) setZoom(nc);
  }, { passive: false });
  // middle mouse button drags to pan (free, like Photoshop's hand tool)
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 1) return;
    e.preventDefault();
    state.panDrag = { x: e.clientX, y: e.clientY, px: state.panX, py: state.panY };
    wrap.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (!state.panDrag) return;
    state.panX = state.panDrag.px + (e.clientX - state.panDrag.x);
    state.panY = state.panDrag.py + (e.clientY - state.panDrag.y);
    applyTransform();
  });
  $('#grid').addEventListener('mouseleave', () => { state.hoverCell = null; clearOverlay('brush-hi'); });

  window.addEventListener('mouseup', () => { if (state.panDrag) { state.panDrag = null; wrap.style.cursor = ''; } endDrag(); });
  window.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (e.key === 'Delete' && state.mode === 'enemy' && state.selectedEnemy) deleteSelectedEnemy();
  });
  window.addEventListener('beforeunload', e => {
    if (state.dirty || state.unitsDirty || state.flowDirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

function setMode(m) {
  state.mode = m;
  document.querySelectorAll('#modeTabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === m));
  const flow = m === 'flow';
  $('#left').classList.toggle('hidden', flow);
  $('#right').classList.toggle('hidden', flow);
  $('#gridWrap').classList.toggle('hidden', flow);
  $('#coordReadout').classList.toggle('hidden', flow);
  $('#flowWorkspace').classList.toggle('hidden', !flow);
  document.querySelectorAll('.map-toolbar-control').forEach(el => el.classList.toggle('hidden', flow));
  applyGridModeClass();
  if (flow) renderFlowEditor();
  else { renderRight(); repaintAll(); }
  updateTitle(); updateUndoButtons();
}

function applyGridModeClass() {
  const g = $('#grid');
  g.classList.remove('mode-terrain', 'mode-enemy', 'mode-deploy');
  g.classList.add('mode-' + state.mode);
}

/* ------------------------------------------------------------------ *
 * Undo / redo  (scoped to the current map)
 * ------------------------------------------------------------------ */
function snapshot() { return JSON.stringify(state.current); }
function pushUndo(beforeJson) {
  state.undoStack.push(beforeJson);
  if (state.undoStack.length > 200) state.undoStack.shift();
  state.redoStack.length = 0;
  updateUndoButtons();
}
/* wrap a discrete mutation: records history + marks dirty only if it changed */
function edit(fn) {
  if (!state.current) { fn(); return; }
  const before = snapshot();
  fn();
  if (before !== snapshot()) { pushUndo(before); markDirty(); }
}
function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(snapshot());
  applySnapshot(state.undoStack.pop());
  updateUndoButtons();
}
function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(snapshot());
  applySnapshot(state.redoStack.pop());
  updateUndoButtons();
}
function applySnapshot(json) {
  state.current = JSON.parse(json);
  state.selectedEnemy = null;
  if (state.activePreset >= state.current.enemyPresets.length) state.activePreset = 0;
  rebuildDeploySet();
  setMapEntryTheme(state.currentName, state.current.theme || '');
  recomputeDirty();
  populateMapThemeSelect();
  renderGrid(); renderRight(); renderMapList();
}
function updateUndoButtons() {
  const flow = state.mode === 'flow';
  $('#undoBtn').classList.toggle('hidden', flow);
  $('#redoBtn').classList.toggle('hidden', flow);
  $('#undoBtn').disabled = flow || !state.undoStack.length;
  $('#redoBtn').disabled = flow || !state.redoStack.length;
}

/* ------------------------------------------------------------------ *
 * Map loading / management
 * ------------------------------------------------------------------ */
async function confirmDiscard() {
  return !state.dirty || await showConfirm('当前地图有未保存的修改，确定放弃并切换吗？');
}

async function loadMap(name) {
  if (!await confirmDiscard()) return;
  const m = await API.map(name);
  m.enemyPresets = m.enemyPresets || [];
  if (!m.enemyPresets.length) m.enemyPresets.push({ weight: 100, enemies: [] });
  m.deployRegion = normalizeDeploy(m.deployRegion);   // accept legacy rect or new list
  setCurrent(name, m);
}

/* deployRegion is now a free-form list [{x,y}]. Convert any legacy rect form. */
function normalizeDeploy(dr) {
  if (Array.isArray(dr)) return dr.filter(c => c && Number.isInteger(c.x) && Number.isInteger(c.y));
  if (dr && dr.width > 0 && dr.height > 0) {
    const out = [];
    for (let y = dr.y; y < dr.y + dr.height; y++)
      for (let x = dr.x; x < dr.x + dr.width; x++) out.push({ x, y });
    return out;
  }
  return [];
}

function setCurrent(name, m) {
  state.current = m; state.currentName = name;
  state.activePreset = 0; state.selectedEnemy = null;
  rebuildDeploySet(); recomputeAbbrevs();
  state.undoStack = []; state.redoStack = [];
  state.savedJson = snapshot(); state.dirty = false;
  $('#emptyHint').classList.add('hidden');
  populateMapThemeSelect();
  updateUndoButtons(); updateTitle(); renderMapList(); renderGrid(); centerMap(); renderRight();
}

function updateTitle() {
  if (state.mode === 'flow') {
    $('#mapTitle').textContent = `关卡流程${state.flowDirty ? ' ●' : ''}`;
    $('#saveBtn').disabled = false;
    return;
  }
  const th = state.current && state.current.theme ? ` · ${state.current.theme}` : '';
  $('#mapTitle').textContent = state.current
    ? `${state.currentName}${th}  (${state.current.width}×${state.current.height})${state.dirty ? ' ●' : ''}`
    : '未打开地图';
  $('#saveBtn').disabled = !state.current;
}

function markDirty() { if (!state.dirty) { state.dirty = true; updateTitle(); renderMapList(); } }
function recomputeDirty() {
  state.dirty = state.current ? (snapshot() !== state.savedJson) : false;
  updateTitle(); renderMapList();
}

async function saveMap() {
  if (!state.current) return;
  state.current.mapName = state.currentName;
  const r = await API.saveMap(state.currentName, state.current);
  if (r.ok) {
    state.savedJson = snapshot(); state.dirty = false;
    setMapEntryTheme(state.currentName, state.current.theme || '');
    updateTitle(); renderMapList(); toast('已保存 ' + state.currentName);
  } else showAlert('保存失败');
}

function saveCurrent() {
  return state.mode === 'flow' ? saveFlowConfig() : saveMap();
}

async function newMap() {
  const themeOpts = state.themes.map(t => ({ value: t, label: t }));
  const v = await showModal('新建地图', [
    { key:'name', label:'名称', type:'text', value:'' },
    { key:'theme', label:'主题 Theme', type:'select',
      value: state.themes[0] || '',
      options: themeOpts.length ? themeOpts : [{ value:'', label:'(无主题)' }] },
    { key:'w', label:'宽 (列)', type:'number', value:10 },
    { key:'h', label:'高 (行)', type:'number', value:10 },
  ]);
  if (!v) return;
  if (!/^[A-Za-z0-9_\-]+$/.test(v.name)) return showAlert('名称只能用字母/数字/下划线/连字符');
  if (mapNameExists(v.name)) return showAlert('已存在同名地图');
  const W = clamp(+v.w, 1, 64), H = clamp(+v.h, 1, 64);
  const theme = v.theme || '';
  const fillT = state.terrains.find(t => t.theme === theme && t.id !== 0)
             || state.terrains.find(t => t.id === 0) || state.terrains[0];
  const fill = fillT ? fillT.id : 0;
  const m = {
    mapName: v.name, width: W, height: H,
    tiles: new Array(W * H).fill(fill),
    deployRegion: [],
    enemyPresets: [{ weight: 100, enemies: [] }],
  };
  if (theme) m.theme = theme;
  await API.saveMap(v.name, m);
  addMapEntry(v.name, theme);
  setCurrent(v.name, m);
  toast('已创建 ' + v.name);
}

async function duplicateMap() {
  if (!state.current) return;
  const v = await showModal('复制地图', [{ key:'name', label:'新名称', type:'text', value: state.currentName + '2' }]);
  if (!v) return;
  if (!/^[A-Za-z0-9_\-]+$/.test(v.name)) return showAlert('名称非法');
  if (mapNameExists(v.name)) return showAlert('已存在同名地图');
  const copy = JSON.parse(JSON.stringify(state.current));
  copy.mapName = v.name;
  await API.saveMap(v.name, copy);
  addMapEntry(v.name, copy.theme || '');
  setCurrent(v.name, copy);
  toast('已复制为 ' + v.name);
}

async function renameMap() {
  if (!state.current) return;
  const old = state.currentName;
  const v = await showModal('改名', [{ key:'name', label:'新名称', type:'text', value: old }]);
  if (!v || v.name === old) return;
  if (!/^[A-Za-z0-9_\-]+$/.test(v.name)) return showAlert('名称非法');
  if (mapNameExists(v.name)) return showAlert('已存在同名地图');
  state.current.mapName = v.name;
  await API.saveMap(v.name, state.current);
  await API.delMap(old);
  state.maps = state.maps.filter(m => m.name !== old);
  addMapEntry(v.name, state.current.theme || '');
  state.currentName = v.name; state.savedJson = snapshot(); state.dirty = false;
  updateTitle(); renderMapList();
  toast('已改名为 ' + v.name);
}

async function deleteMap() {
  if (!state.current) return;
  if (!await showConfirm(`确定删除地图「${state.currentName}」？此操作不可撤销。`, { danger: true })) return;
  const gone = state.currentName;
  await API.delMap(gone);
  state.maps = state.maps.filter(m => m.name !== gone);
  state.current = null; state.currentName = null; state.dirty = false;
  if (state.maps.length) loadMap(state.maps[0].name);
  else {
    $('#grid').innerHTML = ''; $('#colRuler').innerHTML = ''; $('#rowRuler').innerHTML = '';
    $('#emptyHint').classList.remove('hidden');
    populateMapThemeSelect(); updateTitle(); renderMapList(); renderRight(); updateUndoButtons();
  }
  toast('已删除 ' + gone);
}

async function resizeMap() {
  if (!state.current) return;
  const m = state.current;
  const allowed = allowedTerrains();
  const fillDefault = allowed.some(t => t.id === 0) ? 0 : (allowed[0] ? allowed[0].id : 0);
  const v = await showModal('修改尺寸', [
    { key:'w', label:'宽 (列)', type:'number', value: m.width },
    { key:'h', label:'高 (行)', type:'number', value: m.height },
    { key:'fill', label:'新格填充', type:'select', value: fillDefault, options: terrainOptions(allowed) },
  ]);
  if (!v) return;
  const W = clamp(+v.w, 1, 64), H = clamp(+v.h, 1, 64);
  const fill = +v.fill;
  let dropped = 0;
  edit(() => {
    const tiles = new Array(W * H).fill(fill);
    for (let y = 0; y < Math.min(H, m.height); y++)
      for (let x = 0; x < Math.min(W, m.width); x++)
        tiles[y * W + x] = m.tiles[y * m.width + x];
    m.width = W; m.height = H; m.tiles = tiles;
    m.deployRegion = m.deployRegion.filter(c => c.x < W && c.y < H);  // drop out-of-bounds deploy cells
    rebuildDeploySet();
    for (const p of m.enemyPresets) {
      const before = p.enemies.length;
      p.enemies = p.enemies.filter(en => en.x < W && en.y < H);
      dropped += before - p.enemies.length;
    }
  });
  state.selectedEnemy = null;
  renderGrid(); centerMap(); renderRight();
  toast(dropped ? `尺寸已改，移除了 ${dropped} 个越界敌人` : '尺寸已修改');
}

function onMapThemeChange(e) {
  if (!state.current) return;
  const v = e.target.value;
  edit(() => { if (v) state.current.theme = v; else delete state.current.theme; });
  setMapEntryTheme(state.currentName, state.current.theme || '');
  populateMapThemeSelect(); renderMapList(); renderRight(); repaintAll();
}

/* map-list entry helpers (state.maps = [{name, theme}]) */
function mapNameExists(n) { return state.maps.some(m => m.name === n); }
function addMapEntry(name, theme) { state.maps.push({ name, theme: theme || '' }); state.maps.sort((a, b) => a.name.localeCompare(b.name)); }
function setMapEntryTheme(name, theme) { const e = state.maps.find(m => m.name === name); if (e) e.theme = theme || ''; }

/* ------------------------------------------------------------------ *
 * Themes
 * ------------------------------------------------------------------ */
function effectiveTheme() {
  const th = state.current && state.current.theme;
  return (th && state.themes.includes(th)) ? th : '';   // unknown/orphan theme => unrestricted
}
function allowedTerrains() {
  const th = effectiveTheme();
  if (!th) return state.terrains;                        // themeless map -> all tiles
  return state.terrains.filter(t => !t.theme || t.theme === th);
}

function populateMapThemeSelect() {
  const sel = $('#mapTheme'); if (!sel) return;
  const cur = state.current ? (state.current.theme || '') : '';
  sel.innerHTML = '';
  for (const th of state.themes) {
    const o = document.createElement('option'); o.value = th; o.textContent = th; sel.appendChild(o);
  }
  if (cur && !state.themes.includes(cur)) {              // orphan (theme was deleted)
    const o = document.createElement('option'); o.value = cur; o.textContent = cur + ' (已删除)'; sel.appendChild(o);
  }
  const none = document.createElement('option'); none.value = ''; none.textContent = '（未分类）'; sel.appendChild(none);
  sel.value = cur;
  sel.disabled = !state.current;
  const ib = $('#inferBtn'); if (ib) ib.disabled = !state.current;
}

/* Infer a map's theme from the tiles it uses: themed tiles "vote", generic
 * (no-theme) tiles don't. Returns {theme, reason}. */
function inferTheme(tiles) {
  const counts = {};
  for (const id of new Set(tiles)) {
    const t = state.terrainById[id];
    const th = t && t.theme;
    if (!th) continue;
    counts[th] = (counts[th] || 0) + 1;
  }
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (!keys.length) return { theme: '', reason: 'none' };
  return { theme: keys[0], reason: keys.length > 1 ? 'mixed' : 'unique' };
}

function inferCurrentTheme() {
  if (!state.current) return;
  const res = inferTheme(state.current.tiles);
  if (!res.theme) return toast('无法推断：该地图没有带主题的地块');
  if (!state.themes.includes(res.theme)) return toast(`推断到的主题「${res.theme}」不在主题列表`);
  if (state.current.theme === res.theme) return toast(`已是推断主题「${res.theme}」`);
  edit(() => { state.current.theme = res.theme; });
  setMapEntryTheme(state.currentName, res.theme);
  populateMapThemeSelect(); renderMapList(); renderRight(); repaintAll();
  toast(res.reason === 'mixed' ? `推断为「${res.theme}」(跨多主题，取最多)，记得保存` : `推断为「${res.theme}」，记得保存`);
}

function manageThemes() {
  const layer = $('#modalLayer'); layer.classList.remove('hidden');
  const box = document.createElement('div'); box.className = 'modal';

  function persist() {
    const ids = state.terrains.map(t => t.id);
    if (new Set(ids).size !== ids.length) { toast('注意：地形 id 有重复，主题暂存未写盘'); indexTerrains(); return; }
    API.saveTerrains({ themes: state.themes, terrains: state.terrains });
    indexTerrains(); repaintAll();
  }
  async function delTheme(th) {
    const maps = state.maps.filter(m => m.theme === th).map(m => m.name);
    const tiles = state.terrains.filter(t => t.theme === th).length;
    const flowThemes = state.flowConfig.mapThemes.filter(theme => theme.name === th).length;
    let msg = `删除主题「${th}」？`;
    if (maps.length) msg += `\n${maps.length} 张地图用到它，将变为「未分类」（数据不变）。`;
    if (tiles) msg += `\n${tiles} 个地块的主题会被清空（变为通用）。`;
    if (flowThemes) msg += `\n流程中有 ${flowThemes} 个同名主题，将保留并标记为缺失，便于手动处理。`;
    if (!await showConfirm(msg, { danger: true })) return;
    state.themes = state.themes.filter(x => x !== th);
    for (const t of state.terrains) if (t.theme === th) t.theme = '';
    persist(); render();
  }
  async function doRename(oldName, nn) {
    const affectsCurrent = state.current && state.current.theme === oldName;
    if (affectsCurrent && state.dirty &&
        !await showConfirm('当前地图有未保存修改，重命名主题会一并保存当前地图，继续？')) { render(); return; }
    state.themes = state.themes.map(t => t === oldName ? nn : t);
    for (const t of state.terrains) if (t.theme === oldName) t.theme = nn;
    let flowRenamed = false;
    for (const flowTheme of state.flowConfig.mapThemes) {
      if (flowTheme.name === oldName) { flowTheme.name = nn; flowRenamed = true; }
    }
    if (flowRenamed) markFlowDirty();
    for (const entry of state.maps) {
      if (entry.theme !== oldName) continue;
      if (entry.name === state.currentName && state.current) {
        state.current.theme = nn;
        await API.saveMap(entry.name, state.current);
        state.savedJson = snapshot(); state.dirty = false;
      } else {
        const m = await API.map(entry.name); m.theme = nn; await API.saveMap(entry.name, m);
      }
      entry.theme = nn;
    }
    persist(); render();
    populateMapThemeSelect(); renderMapList(); renderRight(); updateTitle();
    if (state.mode === 'flow') renderFlowEditor();
    toast(`已重命名为「${nn}」`);
  }
  async function inferAll() {
    if (state.dirty) {
      if (!await showConfirm('批量推断会读写磁盘上的地图。当前地图有未保存修改，先保存？')) return;
      await saveMap();
    }
    let changed = 0, already = 0, skipped = 0;
    for (const entry of state.maps) {
      if (entry.theme && state.themes.includes(entry.theme)) { already++; continue; }
      const m = await API.map(entry.name);
      const res = inferTheme(m.tiles || []);
      if (res.theme && state.themes.includes(res.theme)) {
        m.theme = res.theme; await API.saveMap(entry.name, m);
        entry.theme = res.theme; changed++;
      } else skipped++;
    }
    if (state.currentName) await loadMap(state.currentName);
    render(); populateMapThemeSelect(); renderMapList();
    showAlert(`批量推断完成：\n归类 ${changed} 张，已有主题跳过 ${already} 张，无法推断 ${skipped} 张。`);
  }
  function render() {
    box.innerHTML = `<h2>${icon('tag')}<span>管理主题</span></h2>`;
    box.appendChild(hint('每个主题是一组地块。地图选定主题后，只能使用该主题的地块 +「通用」(无主题)地块。改名后回车即重命名（会同步更新用到它的地图与地块）。'));
    const list = document.createElement('div'); list.className = 'theme-list';
    if (!state.themes.length) list.appendChild(hint('（暂无主题，请在下方添加）'));
    for (const th of state.themes) {
      const row = document.createElement('div'); row.className = 'theme-row';
      const nm = inputEl('text', th); nm.className = 'nm'; nm.title = '改名后按回车重命名';
      nm.onchange = () => {
        const nn = nm.value.trim();
        if (!nn || nn === th) { nm.value = th; return; }
        if (state.themes.includes(nn)) { showAlert('已存在该主题'); nm.value = th; return; }
        doRename(th, nn);
      };
      const cnt = document.createElement('span'); cnt.className = 'cnt';
      cnt.textContent = `${state.terrains.filter(t => t.theme === th).length} 地块 · ${state.maps.filter(m => m.theme === th).length} 图`;
      const del = document.createElement('button'); del.className = 'del'; del.innerHTML = icon('x');
      del.title = '删除主题'; del.onclick = () => delTheme(th);
      row.append(nm, cnt, del); list.appendChild(row);
    }
    box.appendChild(list);
    const addRow = document.createElement('div'); addRow.className = 'mfield';
    const inp = inputEl('text', ''); inp.placeholder = '新主题名称';
    const addBtn = mkIconBtn('plus', '添加', () => {
      const val = inp.value.trim();
      if (!val) return;
      if (state.themes.includes(val)) { showAlert('已存在该主题'); return; }
      state.themes.push(val); persist(); render();
    });
    addRow.append(inp, addBtn); box.appendChild(addRow);
    const ops = document.createElement('div'); ops.className = 'toolrow'; ops.style.marginTop = '4px';
    ops.appendChild(mkIconBtn('search', '批量推断未分类地图', inferAll));
    box.appendChild(ops);
    const actions = document.createElement('div'); actions.className = 'actions';
    const done = document.createElement('button'); done.className = 'primary'; done.textContent = '完成';
    done.onclick = () => {
      layer.classList.add('hidden'); layer.innerHTML = '';
      populateMapThemeSelect(); renderMapList(); renderRight();
      if (state.mode === 'flow') renderFlowEditor();
    };
    actions.append(done); box.appendChild(actions);
  }
  render();
  layer.innerHTML = ''; layer.appendChild(box);
  layer.onclick = e => { if (e.target === layer) { layer.classList.add('hidden'); layer.innerHTML = ''; populateMapThemeSelect(); renderMapList(); renderRight(); if (state.mode === 'flow') renderFlowEditor(); } };
}

/* ------------------------------------------------------------------ *
 * Grid rendering
 * ------------------------------------------------------------------ */
function renderGrid() {
  const grid = $('#grid'), colR = $('#colRuler'), rowR = $('#rowRuler');
  grid.innerHTML = ''; colR.innerHTML = ''; rowR.innerHTML = '';
  applyGridModeClass();
  state.cellEls = [];
  if (!state.current) return;
  const { width:W, height:H } = state.current, cs = state.cellSize;

  grid.style.gridTemplateColumns = `repeat(${W}, ${cs}px)`;
  for (let y = 0; y < H; y++) state.cellEls[y] = new Array(W);

  for (let x = 0; x < W; x++) {
    const s = document.createElement('span'); s.textContent = x;
    s.style.width = cs + 'px'; s.style.height = '18px'; colR.appendChild(s);
  }
  for (let r = 0; r < H; r++) {
    const y = H - 1 - r;          // origin at bottom-left: row 0 sits at the bottom
    const rs = document.createElement('span'); rs.textContent = y;
    rs.style.height = cs + 'px'; rowR.appendChild(rs);
    for (let x = 0; x < W; x++) {
      const c = document.createElement('div');
      c.className = 'cell'; c.dataset.x = x; c.dataset.y = y;
      c.style.width = cs + 'px'; c.style.height = cs + 'px';
      c.addEventListener('mousedown', onCellDown);
      c.addEventListener('mouseenter', onCellEnter);
      c.addEventListener('contextmenu', ev => ev.preventDefault());
      grid.appendChild(c);
      state.cellEls[y][x] = c;
    }
  }
  repaintAll();
}

/* push the current pan offset to the transformed canvas layer */
function applyTransform() {
  $('#gridScroll').style.transform = `translate(${Math.round(state.panX)}px, ${Math.round(state.panY)}px)`;
}

/* center the whole map in the viewport (used on load / resize) */
function centerMap() {
  if (!state.current) return;
  const wrap = $('#gridWrap'), grid = $('#grid');
  const gw = state.current.width * state.cellSize, gh = state.current.height * state.cellSize;
  state.panX = (wrap.clientWidth - gw) / 2 - grid.offsetLeft;
  state.panY = (wrap.clientHeight - gh) / 2 - grid.offsetTop;
  applyTransform();
}

/* change cell size, keeping the map point under an anchor (default = viewport center) fixed */
function setZoom(newCell, anchorClientX, anchorClientY) {
  const wrap = $('#gridWrap'), grid = $('#grid');
  const rect = wrap.getBoundingClientRect();
  const ax = anchorClientX != null ? anchorClientX - rect.left : wrap.clientWidth / 2;
  const ay = anchorClientY != null ? anchorClientY - rect.top  : wrap.clientHeight / 2;
  const goX = grid.offsetLeft, goY = grid.offsetTop;        // ruler padding offset (constant)
  const gx = (ax - state.panX) - goX, gy = (ay - state.panY) - goY;   // grid-local px of anchored point
  const s = newCell / state.cellSize;
  state.cellSize = newCell;
  renderGrid();
  state.panX = ax - (goX + gx * s);
  state.panY = ay - (goY + gy * s);
  applyTransform();
  const z = $('#zoom'); if (z) z.value = state.cellSize;
}

function repaintAll() {
  if (!state.current) return;
  const { width:W, height:H } = state.current;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) updateCell(x, y);
}

function updateCell(x, y) {
  const c = state.cellEls[y] && state.cellEls[y][x];
  if (!c) return;
  const m = state.current;
  const tid = m.tiles[y * m.width + x];
  const ter = state.terrainById[tid];
  c.style.background = ter ? ter.color : '#ff00ff';
  c.classList.toggle('deploy', inDeploy(x, y));
  c.classList.toggle('nodeploy', !isTerrainDeployable(x, y));
  c.innerHTML = '';
  const en = enemyAt(x, y);
  if (en) {
    const d = document.createElement('div');
    d.className = 'enemy';
    const positionIssues = enemyPositionIssues(x, y);
    if (!isKnownUnit(en.name)) d.classList.add('unknown');
    if (positionIssues.length) d.classList.add('invalid-position');
    if (isSelected(x, y)) d.classList.add('sel');
    d.textContent = initials(en.name);
    d.title = `${en.name} (${x},${y})` + (positionIssues.length ? ` — ⚠ ${positionIssues.join('、')}` : '');
    c.appendChild(d);
  }
}

/* ------------------------------------------------------------------ *
 * Cell interaction
 * ------------------------------------------------------------------ */
function onCellDown(e) {
  if (!state.current) return;
  if (e.button === 1) return;            // middle button is reserved for panning
  e.preventDefault();
  const x = +this.dataset.x, y = +this.dataset.y, right = e.button === 2;

  if (state.mode === 'terrain') {
    if (state.tool === 'fill' && !right) { edit(() => floodFill(x, y, state.activeTerrainId)); return; }
    if (state.tool === 'rect') {
      state.drag = { kind:'rect', sx:x, sy:y, ex:x, ey:y, erase:right, before: snapshot() };
      setOverlay('rect-hi', rectCoords(x, y, x, y));
      return;
    }
    state.drag = { kind:'paint', right, before: snapshot() };
    paintBrush(x, y, right ? 0 : state.activeTerrainId);

  } else if (state.mode === 'enemy') {
    const en = enemyAt(x, y);
    if (right) { if (en) edit(() => removeEnemyAt(x, y)); return; }
    const before = snapshot();
    if (en) { selectEnemyAt(x, y); }
    else if (state.activeUnitId != null) {
      const issue = enemyPositionIssues(x, y)[0];
      if (issue) { toast(issue === '玩家部署区' ? '玩家部署区不能放置敌人' : '该地块不可部署，不能放置敌人'); return; }
      placeEnemy(x, y, state.activeUnitId); selectEnemyAt(x, y);
    }
    else { toast('先在右侧选择一个敌人单位'); return; }
    state.drag = { kind:'move', before };

  } else if (state.mode === 'deploy') {
    state.drag = { kind:'deployPaint', erase: right, before: snapshot() };
    right ? removeDeploy(x, y) : addDeploy(x, y);
  }
}

function onCellEnter(e) {
  const x = +this.dataset.x, y = +this.dataset.y;
  state.hoverCell = { x, y };
  showReadout(x, y);
  if (state.mode === 'terrain' && state.tool === 'brush') setOverlay('brush-hi', brushCoords(x, y));
  if (!state.drag) return;
  if (state.drag.kind === 'paint') paintBrush(x, y, state.drag.right ? 0 : state.activeTerrainId);
  else if (state.drag.kind === 'rect') { state.drag.ex = x; state.drag.ey = y; setOverlay('rect-hi', rectCoords(state.drag.sx, state.drag.sy, x, y)); }
  else if (state.drag.kind === 'move') moveSelected(x, y);
  else if (state.drag.kind === 'deployPaint') state.drag.erase ? removeDeploy(x, y) : addDeploy(x, y);
}

function endDrag() {
  if (!state.drag) return;
  const d = state.drag; state.drag = null;
  if (d.kind === 'rect') {
    const tid = d.erase ? 0 : state.activeTerrainId;
    for (const [x, y] of rectCoords(d.sx, d.sy, d.ex, d.ey)) {
      const i = y * state.current.width + x;
      if (state.current.tiles[i] !== tid) { state.current.tiles[i] = tid; updateCell(x, y); }
    }
    clearOverlay('rect-hi'); markDirty();
  }
  if (d.before != null && d.before !== snapshot()) pushUndo(d.before);
  if (d.kind === 'deployPaint' || d.kind === 'move') renderRight();
}

function showReadout(x, y) {
  const m = state.current; if (!m) return;
  const tid = m.tiles[y * m.width + x];
  const ter = state.terrainById[tid];
  const en = enemyAt(x, y);
  let s = `(${x}, ${y})  地形: ${ter ? ter.name : '未知#' + tid}`;
  if (ter && ter.deployable === false) s += ' (不可部署)';
  if (en) s += `   敌人: ${en.name}`;
  if (inDeploy(x, y)) s += '   部署区';
  const issues = en ? enemyPositionIssues(x, y) : [];
  if (issues.length) s += `   ⚠ 敌人位于${issues.join('、')}`;
  $('#coordReadout').textContent = s;
}

/* terrain ops (markDirty handles live dirty flag; undo recorded by caller) */
function brushCoords(cx, cy) {                 // circular footprint of radius state.brushRadius
  const r = state.brushRadius, m = state.current, out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;  // disc: keep cells within Euclidean radius
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < m.width && y < m.height) out.push([x, y]);
  }
  return out;
}
function rectCoords(sx, sy, ex, ey) {          // every cell in the bounding box
  const m = state.current, out = [];
  const x0 = Math.max(0, Math.min(sx, ex)), x1 = Math.min(m.width - 1, Math.max(sx, ex));
  const y0 = Math.max(0, Math.min(sy, ey)), y1 = Math.min(m.height - 1, Math.max(sy, ey));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}
function paintBrush(cx, cy, tid) {
  const m = state.current;
  for (const [x, y] of brushCoords(cx, cy)) {
    const i = y * m.width + x;
    if (m.tiles[i] !== tid) { m.tiles[i] = tid; updateCell(x, y); }
  }
  markDirty();
}
function clearOverlay(cls) { document.querySelectorAll('#grid .cell.' + cls).forEach(c => c.classList.remove(cls)); }
function setOverlay(cls, coords) {
  clearOverlay(cls);
  for (const [x, y] of coords) { const c = state.cellEls[y] && state.cellEls[y][x]; if (c) c.classList.add(cls); }
}
function floodFill(x, y, tid) {
  const m = state.current, W = m.width, H = m.height;
  const from = m.tiles[y * m.width + x];
  if (from === tid) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
    const i = cy * W + cx;
    if (m.tiles[i] !== from) continue;
    m.tiles[i] = tid; updateCell(cx, cy);
    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }
  markDirty();
}

/* enemy ops */
function curPreset() { return state.current.enemyPresets[state.activePreset]; }
function enemyAt(x, y) {
  const p = state.current && state.current.enemyPresets[state.activePreset];
  return p ? p.enemies.find(e => e.x === x && e.y === y) : null;
}
function isSelected(x, y) {
  const s = state.selectedEnemy;
  return s && s.preset === state.activePreset &&
         curPreset().enemies[s.index] && curPreset().enemies[s.index].x === x && curPreset().enemies[s.index].y === y;
}
function placeEnemy(x, y, name) {
  curPreset().enemies.push({ name, x, y });
  updateCell(x, y); markDirty();
}
function selectEnemyAt(x, y) {
  const idx = curPreset().enemies.findIndex(e => e.x === x && e.y === y);
  state.selectedEnemy = idx >= 0 ? { preset: state.activePreset, index: idx } : null;
  repaintAll(); renderRight();
}
function removeEnemyAt(x, y) {
  const en = curPreset().enemies;
  const idx = en.findIndex(e => e.x === x && e.y === y);
  if (idx < 0) return;
  en.splice(idx, 1);
  state.selectedEnemy = null;
  updateCell(x, y); markDirty(); renderRight();
}
function deleteSelectedEnemy() {
  const s = state.selectedEnemy; if (!s) return;
  edit(() => {
    const list = state.current.enemyPresets[s.preset].enemies;
    if (!list[s.index]) return;
    list.splice(s.index, 1);
  });
  state.selectedEnemy = null;
  repaintAll(); renderRight();
}
function moveSelected(x, y) {
  const s = state.selectedEnemy; if (!s) return;
  const list = curPreset().enemies, en = list[s.index];
  if (!en || (en.x === x && en.y === y)) return;
  if (list.some(o => o !== en && o.x === x && o.y === y)) return; // cell taken
  if (enemyPositionIssues(x, y).length) return;                    // enemy cannot stand here
  const ox = en.x, oy = en.y;
  en.x = x; en.y = y;
  updateCell(ox, oy); updateCell(x, y); markDirty();
}

/* deploy ops — free-form list [{x,y}], membership cached in state.deploySet */
function rebuildDeploySet() {
  state.deploySet = new Set((state.current && state.current.deployRegion || []).map(c => c.x + ',' + c.y));
}
function inDeploy(x, y) { return state.deploySet.has(x + ',' + y); }
function addDeploy(x, y) {
  const k = x + ',' + y;
  if (state.deploySet.has(k)) return;
  state.deploySet.add(k); state.current.deployRegion.push({ x, y });
  updateCell(x, y); markDirty();
}
function removeDeploy(x, y) {
  const k = x + ',' + y;
  if (!state.deploySet.has(k)) return;
  state.deploySet.delete(k);
  state.current.deployRegion = state.current.deployRegion.filter(c => !(c.x === x && c.y === y));
  updateCell(x, y); markDirty();
}

/* ------------------------------------------------------------------ *
 * Right panel
 * ------------------------------------------------------------------ */
function renderRight() {
  const r = $('#right');
  if (state.mode === 'flow') { r.innerHTML = ''; return; }
  if (!state.current) {
    r.innerHTML = '<p class="hint">新建或选择一张地图开始编辑。</p>';
    if (state.mode === 'enemy') renderEnemyUnitConfigEntry(r);
    else if (state.mode === 'terrain') renderTerrainConfigEntry(r);
    return;
  }
  if (state.mode === 'terrain') renderTerrainPanel(r);
  else if (state.mode === 'enemy') renderEnemyPanel(r);
  else renderDeployPanel(r);
}

/* --- terrain panel --- */
function renderTerrainPanel(r) {
  r.innerHTML = '';
  const allowed = allowedTerrains();
  if (!allowed.some(t => t.id === state.activeTerrainId)) state.activeTerrainId = allowed.length ? allowed[0].id : 0;

  const sec = section('地形画笔', 'palette');
  const tools = document.createElement('div'); tools.className = 'toolrow';
  for (const [k, ic, lbl] of [['brush','brush','画笔'],['rect','square','矩形'],['fill','bucket','填充']]) {
    const b = document.createElement('button'); b.innerHTML = icon(ic) + `<span>${lbl}</span>`;
    b.className = state.tool === k ? 'active' : '';
    b.onclick = () => { state.tool = k; renderRight(); };
    tools.appendChild(b);
  }
  sec.appendChild(tools);
  if (state.tool === 'brush') {
    const br = document.createElement('div'); br.className = 'fieldrow';
    const lab = document.createElement('label'); lab.id = 'brushSizeLabel'; lab.style.width = '92px'; lab.textContent = brushLabel();
    const sl = document.createElement('input'); sl.type = 'range'; sl.id = 'brushRadius';
    sl.min = 0; sl.max = 6; sl.value = state.brushRadius; sl.style.flex = '1';
    sl.oninput = () => { state.brushRadius = +sl.value; lab.textContent = brushLabel(); if (state.hoverCell) setOverlay('brush-hi', brushCoords(state.hoverCell.x, state.hoverCell.y)); };
    br.append(lab, sl); sec.appendChild(br);
  }
  const th = effectiveTheme();
  const toolHint = state.tool === 'rect' ? '拖拽框选一个矩形区域填充（右键=擦为 None）。'
    : state.tool === 'fill' ? '点击把相连的同种地块整片替换。'
    : '左键涂抹 · 右键擦除为 None · Ctrl+滚轮调半径。';
  sec.appendChild(hint(toolHint + (th ? ` 当前主题「${th}」：仅该主题与通用地块。` : ' 该地图无主题，显示全部地块。')));

  const groups = {};
  for (const t of allowed) (groups[t.theme || '（通用）'] ||= []).push(t);
  const wrap = document.createElement('div'); wrap.className = 'swatches';
  for (const cat of Object.keys(groups)) {
    const cl = document.createElement('div'); cl.className = 'cat-label'; cl.textContent = cat; wrap.appendChild(cl);
    for (const t of groups[cat]) {
      const sw = document.createElement('div');
      sw.className = 'swatch' + (t.id === state.activeTerrainId ? ' active' : '');
      sw.innerHTML = `<span class="chip" style="background:${t.color}"></span>
                      <span class="nm">${escapeHtml(t.name)}</span><span class="id">#${t.id}</span>`;
      sw.onclick = () => { state.activeTerrainId = t.id; renderTerrainPanel(r); };
      wrap.appendChild(sw);
    }
  }
  sec.appendChild(wrap);
  r.appendChild(sec);
  renderTerrainConfigEntry(r);
}

function renderTerrainConfigEntry(r) {
  const sec = section('地形配置', 'settings');
  sec.appendChild(hint('在独立的大窗口中增删改地形，不再占用右侧绘制面板。'));
  const open = mkBtn('打开地形配置窗口…', () => openConfigEditor('terrain'));
  open.className = 'config-entry-button'; sec.appendChild(open); r.appendChild(sec);
}

let activeConfigKind = null;
let configEditorKeydown = null;

function openConfigEditor(kind) {
  if (kind === 'enemy' && !state.units.some(unit => unit.id === state.activeUnitId) && state.units[0]) {
    state.activeUnitId = state.units[0].id;
  }
  const layer = $('#modalLayer'); layer.classList.remove('hidden'); layer.innerHTML = '';
  const box = document.createElement('div'); box.className = 'modal config-modal';
  const head = document.createElement('div'); head.className = 'config-modal-head';
  const title = document.createElement('h2'); title.id = 'configEditorTitle';
  const close = mkIconBtn('x', '', closeConfigEditor); close.className = 'config-modal-close'; close.title = '关闭';
  head.append(title, close);
  const body = document.createElement('div'); body.className = 'config-modal-body'; body.id = 'configEditorBody';
  box.append(head, body); layer.appendChild(box);
  activeConfigKind = kind;
  renderOpenConfigEditor();
  layer.onclick = event => { if (event.target === layer) closeConfigEditor(); };
  configEditorKeydown = event => { if (event.key === 'Escape') closeConfigEditor(); };
  document.addEventListener('keydown', configEditorKeydown);
}

function configEditorTitle() {
  return activeConfigKind === 'terrain'
    ? `${icon('settings')}<span>地形配置</span>`
    : `${icon('settings')}<span>EnemyUnit 配置${state.unitsDirty ? ' ●' : ''}</span>`;
}

function renderOpenConfigEditor() {
  const body = $('#configEditorBody');
  if (!body || !activeConfigKind) return;
  const scrollTop = body.scrollTop;
  body.innerHTML = '';
  body.classList.toggle('enemy-config-body', activeConfigKind === 'enemy');
  $('#configEditorTitle').innerHTML = configEditorTitle();
  if (activeConfigKind === 'terrain') renderTerrainConfig(body);
  else renderEnemyUnitConfig(body);
  body.scrollTop = scrollTop;
}

function refreshOpenConfigEditor(kind) {
  if (activeConfigKind === kind) renderOpenConfigEditor();
}

function closeConfigEditor() {
  const layer = $('#modalLayer');
  layer.classList.add('hidden'); layer.innerHTML = ''; layer.onclick = null;
  if (configEditorKeydown) document.removeEventListener('keydown', configEditorKeydown);
  configEditorKeydown = null; activeConfigKind = null;
}

function renderTerrainConfig(r) {
  const sec = section('地形配置', 'settings');
  sec.appendChild(hint('增删改地形（id / 名称 / 主题 / 颜色），改完点「保存配置」。不会改动 TileType.cs。'));
  const tbl = document.createElement('div'); tbl.className = 'tcfg';
  const head = document.createElement('div'); head.className = 'row head';
  head.innerHTML = '<span>id</span><span>名称</span><span>主题</span><span title="可部署：不勾选则该地块不能放置敌人">部署</span><span>色</span><span></span>';
  tbl.appendChild(head);
  state.terrains.forEach((t, i) => {
    const row = document.createElement('div'); row.className = 'row';
    const id = inputEl('number', t.id); id.onchange = () => { t.id = +id.value; indexTerrains(); repaintAll(); };
    const nm = inputEl('text', t.name); nm.onchange = () => { t.name = nm.value.trim(); };
    const th = document.createElement('select');
    const og = document.createElement('option'); og.value = ''; og.textContent = '(通用)'; th.appendChild(og);
    for (const tn of state.themes) { const o = document.createElement('option'); o.value = tn; o.textContent = tn; th.appendChild(o); }
    if (t.theme && !state.themes.includes(t.theme)) { const o = document.createElement('option'); o.value = t.theme; o.textContent = t.theme; th.appendChild(o); }
    th.value = t.theme || '';
    th.onchange = () => { t.theme = th.value; if (state.mode === 'terrain') renderRight(); };
    const dep = document.createElement('input'); dep.type = 'checkbox'; dep.className = 'dep';
    dep.checked = t.deployable !== false; dep.title = '可部署：不勾选则该地块不能放置敌人';
    dep.onchange = () => { t.deployable = dep.checked; repaintAll(); };
    const col = inputEl('color', t.color); col.oninput = () => { t.color = col.value; indexTerrains(); repaintAll(); };
    const del = document.createElement('button'); del.className = 'del'; del.innerHTML = icon('x');
    del.title = '删除该地形'; del.onclick = async () => {
      if (await showConfirm(`删除地形「${t.name}」(#${t.id})？使用它的地图格子会变为未知色。`, { danger: true })) {
        state.terrains.splice(i, 1); indexTerrains(); renderRight(); repaintAll(); refreshOpenConfigEditor('terrain');
      }
    };
    row.append(id, nm, th, dep, col, del); tbl.appendChild(row);
  });
  sec.appendChild(tbl);

  const bar = document.createElement('div'); bar.className = 'toolrow'; bar.style.marginTop = '10px';
  bar.append(
    mkIconBtn('plus', '新增', () => {
      const nextId = state.terrains.reduce((mx, t) => Math.max(mx, t.id), 0) + 1;
      state.terrains.push({ id: nextId, name: 'NewTile', color: '#cccccc', theme: effectiveTheme(), deployable: true });
      indexTerrains(); renderRight(); refreshOpenConfigEditor('terrain');
    }),
    mkIconBtn('download', '从TileType导入', importFromTileType),
    (() => { const b = mkIconBtn('save', '保存配置', saveTerrainConfig); b.className = 'mini primary'; return b; })(),
  );
  sec.appendChild(bar);
  r.appendChild(sec);
}

async function saveTerrainConfig() {
  const ids = state.terrains.map(t => t.id);
  if (new Set(ids).size !== ids.length) return showAlert('存在重复的地形 id，请修正后再保存');
  const r = await API.saveTerrains({ themes: state.themes, terrains: state.terrains });
  if (r.ok) { indexTerrains(); repaintAll(); toast('地形配置已保存'); }
  else showAlert('保存失败');
}

async function importFromTileType() {
  const data = await API.tiletype();
  const list = data.types || [];
  let added = 0;
  for (const e of list) {
    if (e.theme && !state.themes.includes(e.theme)) state.themes.push(e.theme);
    if (!state.terrains.some(t => t.id === e.id)) {
      state.terrains.push({ id: e.id, name: e.name, color: randColor(), theme: e.theme || '', deployable: true });
      added++;
    }
  }
  indexTerrains(); populateMapThemeSelect(); renderRight(); refreshOpenConfigEditor('terrain');
  showAlert(added ? `导入了 ${added} 个新地形，请检查颜色后点「保存配置」` : '没有发现新的地形类型');
}

/* --- enemy panel --- */
function renderEnemyPanel(r) {
  r.innerHTML = '';
  const m = state.current;

  const ps = section('敌人预设', 'skull');
  ps.appendChild(hint('一张地图可有多套预设，按权重随机抽取。点标签切换当前编辑的预设。'));
  const tabs = document.createElement('div'); tabs.className = 'presets';
  const totalW = m.enemyPresets.reduce((s, p) => s + (+p.weight || 0), 0) || 1;
  m.enemyPresets.forEach((p, i) => {
    const b = document.createElement('div');
    b.className = 'preset-tab' + (i === state.activePreset ? ' active' : '');
    b.textContent = `预设${i + 1} · ${Math.round((+p.weight || 0) / totalW * 100)}%`;
    b.onclick = () => { state.activePreset = i; state.selectedEnemy = null; renderRight(); repaintAll(); };
    tabs.appendChild(b);
  });
  const addP = document.createElement('div'); addP.className = 'preset-tab'; addP.innerHTML = icon('plus');
  addP.onclick = () => { edit(() => m.enemyPresets.push({ weight: 50, enemies: [] })); state.activePreset = m.enemyPresets.length - 1; renderRight(); repaintAll(); };
  tabs.appendChild(addP);
  ps.appendChild(tabs);

  const p = curPreset();
  const wrow = document.createElement('div'); wrow.className = 'fieldrow';
  const wIn = inputEl('number', p.weight); wIn.min = 0;
  wIn.onchange = () => { edit(() => { p.weight = clamp(+wIn.value, 0, 100000); }); renderEnemyPanel(r); };
  wrow.append(labelEl('权重'), wIn);
  const delP = mkIconBtn('trash', '删除本预设', async () => {
    if (m.enemyPresets.length <= 1) { showAlert('至少保留一套预设'); return; }
    if (!await showConfirm('删除当前预设？', { danger: true })) return;
    edit(() => m.enemyPresets.splice(state.activePreset, 1));
    state.activePreset = 0; state.selectedEnemy = null; renderRight(); repaintAll();
  });
  delP.className = 'mini danger'; wrow.appendChild(delP);
  ps.appendChild(wrow);
  r.appendChild(ps);

  const us = section('选择要放置的单位');
  us.appendChild(hint('选中后点网格放置；点已有敌人可拖动移动，右键删除。敌人不能进入不可部署地块或玩家部署区。'));
  const ul = document.createElement('div'); ul.className = 'unit-list';
  for (const u of unitsForPicker()) {
    const el = document.createElement('div');
    el.className = 'unit' + (u.id === state.activeUnitId ? ' active' : '') + (u.unknown ? ' unknown' : '');
    el.innerHTML = `<span class="abbr">${escapeHtml(state.abbrevs[u.id] || '')}</span><span class="nm">${escapeHtml(u.id)}</span><span class="prof">${escapeHtml(u.profession || (u.unknown ? '不在EnemyUnits' : ''))}</span>`;
    el.onclick = () => { state.activeUnitId = u.id; renderEnemyPanel(r); };
    ul.appendChild(el);
  }
  us.appendChild(ul);
  r.appendChild(us);

  const es = section(`本预设的敌人 (${p.enemies.length})`);
  const list = document.createElement('div'); list.className = 'enemy-list';
  p.enemies.forEach((en, i) => {
    const row = document.createElement('div');
    row.className = 'enemy-row' + (state.selectedEnemy && state.selectedEnemy.preset === state.activePreset && state.selectedEnemy.index === i ? ' sel' : '');
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = `${en.name} (${en.x},${en.y})`; if (!isKnownUnit(en.name)) nm.textContent += ' ⚠';
    const positionIssues = enemyPositionIssues(en.x, en.y);
    if (positionIssues.length) {
      row.classList.add('invalid-position');
      const warning = document.createElement('span'); warning.className = 'enemy-position-warning';
      warning.textContent = `⚠ ${positionIssues.join('、')}`; warning.title = '该敌人当前站位非法';
      nm.append(document.createElement('br'), warning);
    }
    nm.onclick = () => { state.selectedEnemy = { preset: state.activePreset, index: i }; repaintAll(); renderEnemyPanel(r); scrollToCell(en.x, en.y); };
    const x = document.createElement('span'); x.className = 'x'; x.innerHTML = icon('x');
    x.title = '删除'; x.onclick = () => { edit(() => p.enemies.splice(i, 1)); state.selectedEnemy = null; repaintAll(); renderEnemyPanel(r); };
    row.append(nm, x); list.appendChild(row);
  });
  es.appendChild(list);
  r.appendChild(es);

  renderEnemyUnitConfigEntry(r);
}

function renderEnemyUnitConfigEntry(r) {
  const sec = section('EnemyUnit 配置' + (state.unitsDirty ? ' ●' : ''), 'settings');
  sec.appendChild(hint('在独立的大窗口中编辑单位、职业、技能和装备。'));
  const open = mkBtn('打开 EnemyUnit 配置窗口…', () => openConfigEditor('enemy'));
  open.className = 'config-entry-button'; sec.appendChild(open); r.appendChild(sec);
}

function setEnemyConfig(data) {
  state.enemyConfig = data && typeof data === 'object' ? data : { units: [] };
  if (!Array.isArray(state.enemyConfig.units)) state.enemyConfig.units = [];
  state.units = state.enemyConfig.units;
  state.unitsSavedJson = JSON.stringify(state.enemyConfig);
  state.unitsDirty = false;
  if (state.activeUnitId && !state.units.some(u => u.id === state.activeUnitId)) state.activeUnitId = null;
}

function setEnemyEnums(data) {
  data = data && typeof data === 'object' ? data : {};
  state.enemyEnums = {
    professions: Array.isArray(data.professions) ? data.professions : [],
    skills: Array.isArray(data.skills) ? data.skills : [],
    equipments: Array.isArray(data.equipments) ? data.equipments : [],
  };
}

function markUnitsDirty() {
  state.unitsDirty = JSON.stringify(state.enemyConfig) !== state.unitsSavedJson;
}

function renderEnemyUnitConfig(r) {
  const selected = state.units.find(u => u.id === state.activeUnitId);
  const layout = document.createElement('div'); layout.className = 'enemy-config-layout';
  const nav = document.createElement('div'); nav.className = 'enemy-config-nav';
  const navTitle = document.createElement('h3'); navTitle.textContent = `EnemyUnits (${state.units.length})`; nav.appendChild(navTitle);
  const navList = document.createElement('div'); navList.className = 'enemy-config-nav-list';
  for (const unit of state.units) {
    const item = document.createElement('button');
    item.className = 'enemy-config-unit' + (unit === selected ? ' active' : '');
    item.innerHTML = `<span>${escapeHtml(unit.id)}</span><small>${escapeHtml(unit.profession || '')}</small>`;
    item.onclick = () => { state.activeUnitId = unit.id; refreshOpenConfigEditor('enemy'); };
    navList.appendChild(item);
  }
  nav.appendChild(navList);
  const detail = document.createElement('div'); detail.className = 'enemy-config-detail';
  layout.append(nav, detail); r.appendChild(layout);

  const sec = section('EnemyUnit 配置' + (state.unitsDirty ? ' ●' : ''), 'settings');
  const enums = state.enemyEnums;
  sec.appendChild(hint(`枚举候选：职业 ${enums.professions.length} · 技能 ${enums.skills.length} · 装备 ${enums.equipments.length}。输入可搜索，但保存值必须来自对应的 C# enum。`));

  const tools = document.createElement('div'); tools.className = 'toolrow unit-config-tools';
  tools.append(
    mkIconBtn('plus', '新增', addEnemyUnit),
    mkIconBtn('copy', '复制', () => duplicateEnemyUnit(selected)),
    (() => { const b = mkIconBtn('arrowUp', '', () => moveEnemyUnit(selected, -1)); b.title = '上移'; return b; })(),
    (() => { const b = mkIconBtn('arrowDown', '', () => moveEnemyUnit(selected, 1)); b.title = '下移'; return b; })(),
    (() => { const b = mkIconBtn('trash', '删除', () => deleteEnemyUnit(selected)); b.className = 'mini danger'; return b; })(),
  );
  const save = mkIconBtn('save', '保存配置', saveEnemyUnits); save.className = 'mini primary unit-save';
  tools.appendChild(save);
  sec.appendChild(tools);

  if (!selected) {
    sec.appendChild(hint(state.units.length ? '请在左侧单位列表中选择一个 EnemyUnit 进行编辑。' : '当前没有 EnemyUnit，请点击“新增”。'));
    detail.appendChild(sec);
    return;
  }

  const form = document.createElement('div'); form.className = 'unit-config';
  const idRow = document.createElement('div'); idRow.className = 'fieldrow';
  const id = inputEl('text', selected.id); id.autocomplete = 'off';
  id.onchange = () => renameEnemyUnit(selected, id.value.trim());
  idRow.append(labelEl('ID'), id); form.appendChild(idRow);

  const professionRow = document.createElement('div'); professionRow.className = 'fieldrow';
  professionRow.append(labelEl('Profession'), enumPicker(enums.professions, selected.profession, value => {
    selected.profession = value; markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
  }, '搜索职业'));
  form.appendChild(professionRow);

  const skillTitle = document.createElement('div'); skillTitle.className = 'subhead';
  skillTitle.innerHTML = '<b>Skills</b><span class="grow"></span>';
  const addSkill = mkIconBtn('plus', '技能', () => {
    const value = firstEnumValue(enums.skills);
    if (!value) { showAlert('Skill enum 没有可用成员，请检查路径设置'); return; }
    (selected.skills ||= []).push({ skill: value, level: 1 });
    markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
  });
  skillTitle.appendChild(addSkill); form.appendChild(skillTitle);
  const skills = document.createElement('div'); skills.className = 'unit-sublist';
  (selected.skills ||= []).forEach((entry, index) => {
    const row = document.createElement('div'); row.className = 'unit-skill-row';
    const number = document.createElement('span'); number.className = 'unit-item-index'; number.textContent = `${index + 1}.`;
    const picker = enumPicker(enums.skills, entry.skill, value => {
      entry.skill = value; markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
    }, '搜索技能');
    const level = inputEl('number', entry.level); level.title = '技能等级'; level.step = 1;
    level.onchange = () => {
      const value = Number(level.value);
      if (!Number.isInteger(value)) { showAlert('技能等级必须是整数'); level.value = entry.level; return; }
      entry.level = value; markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
    };
    const del = mkIconBtn('x', '', () => { selected.skills.splice(index, 1); markUnitsDirty(); renderEnemyUnitConfigPanelOnly(); });
    del.className = 'mini danger'; row.append(number, picker, level, del); skills.appendChild(row);
  });
  if (!selected.skills.length) skills.appendChild(hint('没有技能'));
  form.appendChild(skills);

  const equipmentTitle = document.createElement('div'); equipmentTitle.className = 'subhead';
  equipmentTitle.innerHTML = '<b>Equipments</b><span class="grow"></span>';
  const addEquipment = mkIconBtn('plus', '装备', () => {
    const value = firstEnumValue(enums.equipments);
    if (!value) { showAlert('Equipment enum 没有可用成员，请检查路径设置'); return; }
    (selected.equipments ||= []).push(value);
    markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
  });
  equipmentTitle.appendChild(addEquipment); form.appendChild(equipmentTitle);
  const equipments = document.createElement('div'); equipments.className = 'unit-sublist';
  (selected.equipments ||= []).forEach((equipment, index) => {
    const row = document.createElement('div'); row.className = 'unit-equipment-row';
    const number = document.createElement('span'); number.className = 'unit-item-index'; number.textContent = `${index + 1}.`;
    const picker = enumPicker(enums.equipments, equipment, value => {
      selected.equipments[index] = value; markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
    }, '搜索装备');
    const del = mkIconBtn('x', '', () => { selected.equipments.splice(index, 1); markUnitsDirty(); renderEnemyUnitConfigPanelOnly(); });
    del.className = 'mini danger'; row.append(number, picker, del); equipments.appendChild(row);
  });
  if (!selected.equipments.length) equipments.appendChild(hint('没有装备'));
  form.appendChild(equipments);
  sec.appendChild(form);
  detail.appendChild(sec);
}

function enumPicker(values, currentValue, onPick, placeholder) {
  const wrap = document.createElement('div'); wrap.className = 'enum-picker';
  const input = inputEl('text', currentValue == null ? '' : currentValue);
  const menu = document.createElement('div'); menu.className = 'enum-options hidden';
  let accepted = input.value;
  let rankedValues = [], activeIndex = -1, blurTimer = null;
  input.placeholder = placeholder || '输入搜索'; input.autocomplete = 'off';

  function rankValues() {
    const query = input.value.trim().toLocaleLowerCase();
    return values.map((value, index) => {
      const normalized = value.toLocaleLowerCase();
      const rank = query && normalized === query ? 0 : query && normalized.includes(query) ? 1 : 2;
      return { value, index, rank };
    }).sort((a, b) => a.rank - b.rank || a.index - b.index);
  }

  function appendHighlightedLabel(button, value, query) {
    const at = query ? value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) : -1;
    if (at < 0) { button.textContent = value; return; }
    button.append(document.createTextNode(value.slice(0, at)));
    const mark = document.createElement('mark'); mark.textContent = value.slice(at, at + query.length); button.appendChild(mark);
    button.append(document.createTextNode(value.slice(at + query.length)));
  }

  function renderOptions() {
    rankedValues = rankValues(); activeIndex = -1; menu.innerHTML = '';
    const query = input.value.trim();
    let previousRank = -1;
    rankedValues.forEach((entry, index) => {
      const option = document.createElement('button'); option.type = 'button';
      option.className = 'enum-option' + (entry.rank === 0 ? ' exact-match' : entry.rank === 1 ? ' partial-match' : ' unmatched');
      if (entry.rank === 2 && previousRank < 2 && query) option.classList.add('unmatched-start');
      appendHighlightedLabel(option, entry.value, entry.rank < 2 ? query : '');
      option.onmousedown = event => event.preventDefault();
      option.onclick = () => accept(entry.value);
      menu.appendChild(option); previousRank = entry.rank;
    });
    menu.classList.remove('hidden');
  }

  function accept(value) {
    if (!values.includes(value)) return;
    const changed = value !== accepted;
    accepted = value; input.value = value; menu.classList.add('hidden');
    if (changed) onPick(value);
  }

  function moveActive(delta) {
    if (menu.classList.contains('hidden')) renderOptions();
    if (!rankedValues.length) return;
    activeIndex = activeIndex < 0
      ? (delta > 0 ? 0 : rankedValues.length - 1)
      : (activeIndex + delta + rankedValues.length) % rankedValues.length;
    menu.querySelectorAll('.enum-option').forEach((option, index) => option.classList.toggle('keyboard-active', index === activeIndex));
    const active = menu.children[activeIndex]; if (active) active.scrollIntoView({ block: 'nearest' });
  }

  input.onfocus = () => { clearTimeout(blurTimer); input.select(); renderOptions(); };
  input.onclick = () => { clearTimeout(blurTimer); renderOptions(); };
  input.oninput = renderOptions;
  input.onkeydown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      const exact = values.find(value => value.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase());
      const chosen = exact || (activeIndex >= 0 && rankedValues[activeIndex] && rankedValues[activeIndex].value);
      if (chosen) { event.preventDefault(); accept(chosen); }
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); input.value = accepted; menu.classList.add('hidden'); input.blur();
    }
  };
  input.onblur = () => {
    blurTimer = setTimeout(() => {
      const exact = values.find(value => value.toLocaleLowerCase() === input.value.trim().toLocaleLowerCase());
      if (exact) accept(exact); else input.value = accepted;
      menu.classList.add('hidden');
    }, 80);
  };
  wrap.append(input, menu);
  return wrap;
}

function firstEnumValue(values) {
  return values.find(value => value !== 'None') || values[0] || '';
}

function renderEnemyUnitConfigPanelOnly() {
  recomputeAbbrevs();
  renderRight();
  refreshOpenConfigEditor('enemy');
  repaintAll();
}

function nextUnitId(base) {
  const used = new Set(state.units.map(unit => unit.id));
  if (!used.has(base)) return base;
  for (let n = 2; n < 10000; n++) if (!used.has(base + n)) return base + n;
  return base + Date.now();
}

function addEnemyUnit() {
  const profession = firstEnumValue(state.enemyEnums.professions);
  if (!profession) { showAlert('Profession enum 没有可用成员，请检查路径设置'); return; }
  const unit = { id: nextUnitId('NewEnemy'), profession, skills: [], equipments: [] };
  state.units.push(unit); state.activeUnitId = unit.id;
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

function duplicateEnemyUnit(unit) {
  if (!unit) { showAlert('请先选择一个 EnemyUnit'); return; }
  const copy = JSON.parse(JSON.stringify(unit));
  copy.id = nextUnitId(unit.id + 'Copy');
  state.units.splice(state.units.indexOf(unit) + 1, 0, copy);
  state.activeUnitId = copy.id;
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

function moveEnemyUnit(unit, delta) {
  if (!unit) { showAlert('请先选择一个 EnemyUnit'); return; }
  const from = state.units.indexOf(unit), to = clamp(from + delta, 0, state.units.length - 1);
  if (from === to) return;
  state.units.splice(to, 0, state.units.splice(from, 1)[0]);
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

async function renameEnemyUnit(unit, newId) {
  const oldId = unit.id;
  if (newId === oldId) return;
  if (!/^[A-Za-z_]\w*$/.test(newId)) { showAlert('ID 必须是合法标识符：以字母或下划线开头，只包含字母、数字、下划线'); renderEnemyUnitConfigPanelOnly(); return; }
  if (state.units.some(other => other !== unit && other.id === newId)) { showAlert('已经存在同名 EnemyUnit'); renderEnemyUnitConfigPanelOnly(); return; }
  const refs = state.current ? state.current.enemyPresets.reduce((sum, preset) => sum + preset.enemies.filter(enemy => enemy.name === oldId).length, 0) : 0;
  const message = `确定把 EnemyUnit「${oldId}」改名为「${newId}」？\n` +
    (refs ? `当前地图中的 ${refs} 个引用会同步修改，并需要另行保存地图。\n` : '') +
    '其他地图文件中的引用不会自动修改。';
  if (!await showConfirm(message)) { renderEnemyUnitConfigPanelOnly(); return; }
  unit.id = newId; state.activeUnitId = newId;
  if (refs) edit(() => {
    for (const preset of state.current.enemyPresets)
      for (const enemy of preset.enemies) if (enemy.name === oldId) enemy.name = newId;
  });
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

async function deleteEnemyUnit(unit) {
  if (!unit) { showAlert('请先选择一个 EnemyUnit'); return; }
  const refs = state.current ? state.current.enemyPresets.reduce((sum, preset) => sum + preset.enemies.filter(enemy => enemy.name === unit.id).length, 0) : 0;
  const warning = refs ? `\n当前地图中有 ${refs} 个引用，删除后会显示为未知单位。` : '';
  if (!await showConfirm(`确定删除 EnemyUnit「${unit.id}」？${warning}\n其他地图文件不会被修改。`, { danger: true })) return;
  state.units.splice(state.units.indexOf(unit), 1);
  state.activeUnitId = state.units[0] ? state.units[0].id : null;
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

function validateEnemyUnits() {
  const errors = [], ids = new Set();
  const professions = new Set(state.enemyEnums.professions);
  const skills = new Set(state.enemyEnums.skills);
  const equipments = new Set(state.enemyEnums.equipments);
  if (!professions.size) errors.push('无法读取 Profession enum');
  if (!skills.size) errors.push('无法读取 Skill enum');
  if (!equipments.size) errors.push('无法读取 Equipment enum');
  state.units.forEach((unit, unitIndex) => {
    const where = `单位 ${unitIndex + 1}`;
    if (!/^[A-Za-z_]\w*$/.test(unit.id || '')) errors.push(`${where} 的 ID 不合法`);
    else if (ids.has(unit.id)) errors.push(`单位 ID 重复：${unit.id}`);
    else ids.add(unit.id);
    if (!professions.has(unit.profession)) errors.push(`${unit.id || where} 的 profession 不在枚举中：${unit.profession}`);
    if (!Array.isArray(unit.skills)) errors.push(`${unit.id || where} 的 skills 不是数组`);
    else unit.skills.forEach((entry, index) => {
      if (!skills.has(entry.skill)) errors.push(`${unit.id} 的技能 ${index + 1} 不在枚举中：${entry.skill}`);
      if (!Number.isInteger(entry.level)) errors.push(`${unit.id} 的技能 ${entry.skill} 等级必须是整数`);
    });
    if (!Array.isArray(unit.equipments)) errors.push(`${unit.id || where} 的 equipments 不是数组`);
    else unit.equipments.forEach((equipment, index) => {
      if (!equipments.has(equipment)) errors.push(`${unit.id} 的装备 ${index + 1} 不在枚举中：${equipment}`);
    });
  });
  return errors;
}

async function saveEnemyUnits() {
  const errors = validateEnemyUnits();
  if (errors.length) return showAlert('EnemyUnits 校验失败：\n' + errors.slice(0, 12).join('\n') + (errors.length > 12 ? `\n……另有 ${errors.length - 12} 项` : ''));
  const response = await API.saveEnemies(state.enemyConfig);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) return showAlert('EnemyUnits 保存失败：\n' + (result.errors || [result.error || '未知错误']).join('\n'));
  state.unitsSavedJson = JSON.stringify(state.enemyConfig); state.unitsDirty = false;
  renderEnemyUnitConfigPanelOnly(); toast('EnemyUnits 已保存');
}

function unitsForPicker() {
  const out = state.units.map(u => ({ id: u.id, profession: u.profession, unknown: false }));
  const known = new Set(out.map(u => u.id));
  if (state.current) {
    for (const p of state.current.enemyPresets)
      for (const e of p.enemies)
        if (!known.has(e.name)) { known.add(e.name); out.push({ id: e.name, profession: '', unknown: true }); }
  }
  return out;
}

/* --- deploy panel (free-form cell list) --- */
function renderDeployPanel(r) {
  r.innerHTML = '';
  const sec = section('玩家可部署区域 (自由形状)', 'flag');
  sec.appendChild(hint('左键涂格设为玩家可部署，右键擦除（都可拖动）；敌人不能进入该区域。保存为坐标列表 [{x,y}]。'));
  const info = document.createElement('div'); info.className = 'fieldrow';
  info.innerHTML = `<label>已选格子</label><b>${state.current.deployRegion.length}</b>`;
  sec.appendChild(info);
  const clr = mkBtn('清除全部', () => {
    edit(() => { state.current.deployRegion = []; rebuildDeploySet(); });
    repaintAll(); renderDeployPanel(r);
  });
  clr.className = 'mini danger'; sec.appendChild(clr);
  r.appendChild(sec);
}

/* ------------------------------------------------------------------ *
 * Level flow editor (MapThemes.json)
 * ------------------------------------------------------------------ */
function setFlowConfig(data) {
  const root = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  if (!Array.isArray(root.mapThemes)) root.mapThemes = [];
  root.mapThemes = root.mapThemes.map(raw => {
    const theme = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (typeof theme.name !== 'string') theme.name = '';
    if (!Number.isInteger(theme.stage)) theme.stage = 1;
    if (typeof theme.weight !== 'number' || !Number.isFinite(theme.weight)) theme.weight = 100;
    if (!Array.isArray(theme.turnSequence)) theme.turnSequence = [];
    theme.turnSequence = theme.turnSequence.map(rawTurn => {
      const turn = rawTurn && typeof rawTurn === 'object' && !Array.isArray(rawTurn) ? rawTurn : {};
      if (!Array.isArray(turn.mapSet)) turn.mapSet = [];
      turn.mapSet = turn.mapSet.map(normalizeMapEntry).filter(Boolean);
      return turn;
    });
    return theme;
  });
  state.flowConfig = root;
  state.flowSavedJson = flowSnapshot();
  state.flowDirty = false;
  state.flowExpanded = new WeakSet();
}

/* A mapSet entry is { mapName, weight }. Accept legacy bare-string names
 * (migrated to weight 100) and drop anything without a usable name. */
const DEFAULT_MAP_WEIGHT = 100;
function normalizeMapEntry(raw) {
  if (typeof raw === 'string') return raw ? { mapName: raw, weight: DEFAULT_MAP_WEIGHT } : null;
  if (raw && typeof raw === 'object' && typeof raw.mapName === 'string' && raw.mapName) {
    const weight = (typeof raw.weight === 'number' && Number.isFinite(raw.weight) && raw.weight >= 0)
      ? raw.weight : DEFAULT_MAP_WEIGHT;
    return { mapName: raw.mapName, weight };
  }
  return null;
}

function flowSnapshot() { return JSON.stringify(state.flowConfig); }

function markFlowDirty() {
  state.flowDirty = flowSnapshot() !== state.flowSavedJson;
  updateTitle(); renderFlowStats();
}

function editFlow(fn, rerender = true) {
  const before = flowSnapshot();
  fn();
  if (flowSnapshot() !== before) markFlowDirty();
  if (rerender) renderFlowEditor();
}

function flowMapIssue(theme, mapName) {
  const map = state.maps.find(m => m.name === mapName);
  if (!map) return '地图不存在';
  if (map.theme !== theme.name) return map.theme ? `属于主题 ${map.theme}` : '地图未分类';
  return '';
}

function flowReferenceCount(mapName) {
  return state.flowConfig.mapThemes.reduce((total, theme) => total +
    theme.turnSequence.reduce((sum, turn) =>
      sum + turn.mapSet.filter(entry => entry.mapName === mapName).length, 0), 0);
}

function flowTotals() {
  const themes = state.flowConfig.mapThemes;
  const turns = themes.reduce((n, theme) => n + theme.turnSequence.length, 0);
  const refs = themes.reduce((n, theme) => n + theme.turnSequence.reduce((m, turn) => m + turn.mapSet.length, 0), 0);
  const stages = new Set(themes.filter(theme => Number.isInteger(theme.stage)).map(theme => theme.stage)).size;
  return { stages, themes: themes.length, turns, refs };
}

function renderFlowStats() {
  const el = $('#flowStats'); if (!el) return;
  const n = flowTotals();
  el.textContent = `${n.stages} 阶段 · ${n.themes} 主题 · ${n.turns} 回合 · ${n.refs} 次地图引用`;
}

function orderedFlowThemeIndices() {
  return state.flowConfig.mapThemes.map((_, index) => index).sort((a, b) => {
    const sa = state.flowConfig.mapThemes[a].stage;
    const sb = state.flowConfig.mapThemes[b].stage;
    const va = Number.isInteger(sa) ? sa : Number.MAX_SAFE_INTEGER;
    const vb = Number.isInteger(sb) ? sb : Number.MAX_SAFE_INTEGER;
    return va - vb || a - b;
  });
}

function renderFlowEditor() {
  const list = $('#flowStageList'); if (!list) return;
  renderFlowStats();
  list.innerHTML = '';
  const indices = orderedFlowThemeIndices();
  if (!indices.length) {
    const empty = document.createElement('div'); empty.className = 'flow-empty';
    empty.innerHTML = '<b>还没有流程主题</b><span>点击右上角「添加主题」开始编排第一个阶段。</span>';
    list.appendChild(empty);
    return;
  }

  let stageSection = null, previousStage = Symbol('first');
  for (const themeIndex of indices) {
    const theme = state.flowConfig.mapThemes[themeIndex];
    const stage = Number.isInteger(theme.stage) ? theme.stage : null;
    if (stage !== previousStage) {
      stageSection = document.createElement('section'); stageSection.className = 'flow-stage';
      const head = document.createElement('div'); head.className = 'flow-stage-head';
      const title = document.createElement('span'); title.className = 'flow-stage-title';
      title.textContent = stage === null ? '未设置阶段' : `阶段 ${stage}`;
      const count = indices.filter(i => state.flowConfig.mapThemes[i].stage === theme.stage).length;
      const meta = document.createElement('span'); meta.textContent = `${count} 个主题`;
      head.append(title, meta); stageSection.appendChild(head); list.appendChild(stageSection);
      previousStage = stage;
    }
    stageSection.appendChild(renderFlowThemeCard(theme, themeIndex));
  }
}

function renderFlowThemeCard(theme, themeIndex) {
  const expanded = state.flowExpanded.has(theme);
  const card = document.createElement('article'); card.className = 'flow-theme-card' + (expanded ? ' expanded' : '');
  const header = document.createElement('div'); header.className = 'flow-theme-header';
  const toggle = document.createElement('button'); toggle.className = 'flow-theme-toggle';
  toggle.innerHTML = icon(expanded ? 'chevronDown' : 'chevronRight'); toggle.title = expanded ? '收起主题' : '展开主题';
  const heading = document.createElement('div'); heading.className = 'flow-theme-heading';
  const name = document.createElement('h2'); name.textContent = theme.name || '未命名主题';
  const badges = document.createElement('div'); badges.className = 'flow-theme-badges';
  badges.append(flowBadge(`阶段 ${theme.stage}`, 'stage'), flowBadge(`权重 ${theme.weight}`, 'weight'));
  heading.append(name, badges);

  const summary = document.createElement('div'); summary.className = 'flow-theme-summary';
  const counts = theme.turnSequence.map(turn => turn.mapSet.length);
  summary.textContent = counts.length
    ? `${counts.length} 回合 · 每回合地图数 ${counts.join(' / ')}`
    : '0 回合 · 尚未编排地图';
  const issues = theme.turnSequence.reduce((n, turn) =>
    n + turn.mapSet.filter(entry => flowMapIssue(theme, entry.mapName)).length, 0);
  if (issues) summary.appendChild(flowBadge(`${issues} 个引用需检查`, 'warning'));

  const del = document.createElement('button'); del.className = 'mini danger flow-theme-delete';
  del.innerHTML = icon('trash') + '<span>删除</span>'; del.onclick = () => deleteFlowTheme(themeIndex);
  const toggleExpanded = () => {
    if (expanded) state.flowExpanded.delete(theme); else state.flowExpanded.add(theme);
    renderFlowEditor();
  };
  toggle.onclick = toggleExpanded; heading.onclick = toggleExpanded; summary.onclick = toggleExpanded;
  header.append(toggle, heading, summary, del); card.appendChild(header);
  if (expanded) card.appendChild(renderFlowThemeBody(theme, themeIndex));
  return card;
}

function flowBadge(text, kind) {
  const badge = document.createElement('span'); badge.className = 'flow-badge ' + (kind || '');
  badge.textContent = text; return badge;
}

function renderFlowThemeBody(theme, themeIndex) {
  const body = document.createElement('div'); body.className = 'flow-theme-body';
  const settings = document.createElement('div'); settings.className = 'flow-theme-settings';

  const themeSelect = document.createElement('select');
  const names = [...state.themes];
  if (theme.name && !names.includes(theme.name)) names.push(theme.name);
  for (const item of names) {
    const option = document.createElement('option'); option.value = item;
    option.textContent = item + (state.themes.includes(item) ? '' : '（主题配置中不存在）');
    themeSelect.appendChild(option);
  }
  themeSelect.value = theme.name;
  themeSelect.onchange = () => editFlow(() => { theme.name = themeSelect.value; });

  const stageInput = inputEl('number', theme.stage); stageInput.min = '1'; stageInput.step = '1';
  stageInput.onchange = () => editFlow(() => { theme.stage = Math.max(1, Math.round(+stageInput.value || 1)); });
  const weightInput = inputEl('number', theme.weight); weightInput.min = '0'; weightInput.step = 'any';
  weightInput.onchange = () => editFlow(() => { theme.weight = Math.max(0, +weightInput.value || 0); });
  settings.append(flowSetting('主题', themeSelect), flowSetting('阶段', stageInput), flowSetting('权重', weightInput));
  body.appendChild(settings);

  const layout = document.createElement('div'); layout.className = 'flow-theme-layout';
  layout.append(renderFlowMapPalette(theme, themeIndex), renderFlowTurns(theme, themeIndex));
  body.appendChild(layout);
  return body;
}

function flowSetting(label, control) {
  const wrap = document.createElement('label'); wrap.className = 'flow-setting';
  const text = document.createElement('span'); text.textContent = label;
  wrap.append(text, control); return wrap;
}

function renderFlowMapPalette(theme, themeIndex) {
  const palette = document.createElement('aside'); palette.className = 'flow-map-palette';
  const head = document.createElement('div'); head.className = 'flow-subhead';
  const title = document.createElement('b'); title.textContent = '可用地图';
  const count = document.createElement('span');
  const maps = state.maps.filter(map => map.theme === theme.name).sort((a, b) => a.name.localeCompare(b.name));
  count.textContent = `${maps.length} 张`; head.append(title, count); palette.appendChild(head);
  palette.appendChild(hint('拖入右侧任意回合；重复拖入即可多次引用。'));
  const mapList = document.createElement('div'); mapList.className = 'flow-palette-list';
  if (!maps.length) mapList.appendChild(hint(theme.name ? '该主题下没有地图。' : '请先选择主题。'));
  for (const map of maps) {
    const item = document.createElement('div'); item.className = 'flow-palette-map';
    item.draggable = true; item.tabIndex = 0; item.title = '拖到回合中；双击快速加入最后一回合';
    const mapName = document.createElement('span'); mapName.textContent = map.name;
    const refs = document.createElement('span'); refs.className = 'flow-reference-count';
    refs.textContent = String(flowReferenceCount(map.name)); refs.title = '整个流程中的引用次数';
    item.append(mapName, refs);
    item.ondragstart = event => beginFlowDrag(event, { kind:'palette', themeIndex, name:map.name });
    item.ondragend = endFlowDrag;
    item.ondblclick = () => addMapToLastTurn(theme, map.name);
    item.onkeydown = event => { if (event.key === 'Enter') addMapToLastTurn(theme, map.name); };
    mapList.appendChild(item);
  }
  palette.appendChild(mapList);

  const invalid = [];
  for (const turn of theme.turnSequence)
    for (const entry of turn.mapSet) {
      const issue = flowMapIssue(theme, entry.mapName);
      if (issue && !invalid.some(x => x.name === entry.mapName && x.issue === issue)) invalid.push({ name:entry.mapName, issue });
    }
  if (invalid.length) {
    const warnings = document.createElement('div'); warnings.className = 'flow-reference-warnings';
    const warningTitle = document.createElement('b'); warningTitle.textContent = '引用检查'; warnings.appendChild(warningTitle);
    for (const item of invalid) {
      const line = document.createElement('span'); line.textContent = `${item.name}：${item.issue}`; warnings.appendChild(line);
    }
    palette.appendChild(warnings);
  }
  return palette;
}

function renderFlowTurns(theme, themeIndex) {
  const panel = document.createElement('div'); panel.className = 'flow-turn-panel';
  const toolbar = document.createElement('div'); toolbar.className = 'flow-turn-toolbar';
  const title = document.createElement('div'); title.className = 'flow-subhead';
  title.innerHTML = `<b>回合序列</b><span>${theme.turnSequence.length} 回合</span>`;
  const add = mkIconBtn('plus', '添加回合', () => editFlow(() => theme.turnSequence.push({ mapSet: [] })));
  toolbar.append(title, add); panel.appendChild(toolbar);
  const board = document.createElement('div'); board.className = 'flow-turn-board';
  if (!theme.turnSequence.length) {
    const empty = document.createElement('button'); empty.className = 'flow-add-first-turn';
    empty.innerHTML = icon('plus') + '<span>添加第 1 回合</span>'; empty.onclick = add.onclick; board.appendChild(empty);
  }
  theme.turnSequence.forEach((turn, turnIndex) =>
    board.appendChild(renderFlowTurn(theme, themeIndex, turn, turnIndex)));
  panel.appendChild(board); return panel;
}

function renderFlowTurn(theme, themeIndex, turn, turnIndex) {
  const card = document.createElement('div'); card.className = 'flow-turn-card';
  const head = document.createElement('div'); head.className = 'flow-turn-head';
  const label = document.createElement('b'); label.textContent = `回合 ${turnIndex + 1}`;
  const total = document.createElement('span'); total.textContent = `${turn.mapSet.length} 张地图`;
  const actions = document.createElement('div'); actions.className = 'flow-turn-actions';
  const left = mkIconBtn('arrowLeft', '', () => moveFlowTurn(theme, turnIndex, -1)); left.title = '前移回合'; left.disabled = turnIndex === 0;
  const right = mkIconBtn('arrowRight', '', () => moveFlowTurn(theme, turnIndex, 1)); right.title = '后移回合'; right.disabled = turnIndex === theme.turnSequence.length - 1;
  const del = mkIconBtn('x', '', () => deleteFlowTurn(theme, turnIndex)); del.classList.add('danger'); del.title = '删除回合';
  actions.append(left, right, del); head.append(label, total, actions); card.appendChild(head);

  const maps = document.createElement('div'); maps.className = 'flow-turn-maps';
  turn.mapSet.forEach((entry, mapIndex) => {
    const insert = document.createElement('div'); insert.className = 'flow-insert-zone';
    bindFlowDrop(insert, themeIndex, turnIndex, mapIndex); maps.appendChild(insert);
    const chip = document.createElement('div'); chip.className = 'flow-turn-map';
    const issue = flowMapIssue(theme, entry.mapName);
    if (issue) { chip.classList.add('invalid'); chip.title = issue; }
    const grip = document.createElement('span'); grip.className = 'flow-map-grip'; grip.innerHTML = icon('grip');
    grip.title = '拖动以调整顺序 / 移动到其它回合';
    const name = document.createElement('span'); name.textContent = entry.mapName; name.title = entry.mapName;
    const weight = inputEl('number', entry.weight); weight.className = 'flow-map-weight';
    weight.min = '0'; weight.step = 'any'; weight.title = '该地图在本回合内被抽中的权重';
    weight.onchange = () => editFlow(() => { entry.weight = Math.max(0, +weight.value || 0); });
    const remove = document.createElement('button'); remove.innerHTML = icon('x'); remove.title = '移除这次引用';
    remove.onclick = () => editFlow(() => turn.mapSet.splice(mapIndex, 1));
    chip.append(grip, name, weight, remove);
    // Only the grip starts a drag, so the weight field stays clickable/editable.
    chip.draggable = false;
    grip.addEventListener('mousedown', () => { chip.draggable = true; });
    grip.addEventListener('mouseup', () => { chip.draggable = false; });
    chip.ondragstart = event => beginFlowDrag(event, { kind:'turnMap', themeIndex, turnIndex, mapIndex });
    chip.ondragend = event => { endFlowDrag(event); chip.draggable = false; };
    maps.appendChild(chip);
  });
  const end = document.createElement('div');
  end.className = 'flow-insert-zone end' + (turn.mapSet.length ? '' : ' empty');
  end.textContent = turn.mapSet.length ? '拖到末尾' : '将地图拖到这里';
  bindFlowDrop(end, themeIndex, turnIndex, turn.mapSet.length); maps.appendChild(end);
  card.appendChild(maps); return card;
}

/* Custom drag MIME. NOT text/plain — some browsers' "super-drag" feature
 * (松开鼠标以搜索文本) hijacks any dragged plain text and offers to search it. */
const FLOW_DRAG_MIME = 'application/x-mapmaker-flow';

function beginFlowDrag(event, payload) {
  state.flowDrag = payload;
  event.dataTransfer.effectAllowed = payload.kind === 'palette' ? 'copy' : 'move';
  event.dataTransfer.setData(FLOW_DRAG_MIME, JSON.stringify(payload));
  document.body.classList.add('flow-dragging');
}

function endFlowDrag() {
  state.flowDrag = null; document.body.classList.remove('flow-dragging');
  document.querySelectorAll('.flow-drop-active').forEach(el => el.classList.remove('flow-drop-active'));
}

function bindFlowDrop(element, themeIndex, turnIndex, insertIndex) {
  element.ondragover = event => {
    const drag = state.flowDrag;
    if (!drag || drag.themeIndex !== themeIndex) return;
    event.preventDefault(); event.dataTransfer.dropEffect = drag.kind === 'palette' ? 'copy' : 'move';
    element.classList.add('flow-drop-active');
  };
  element.ondragleave = () => element.classList.remove('flow-drop-active');
  element.ondrop = event => {
    event.preventDefault(); event.stopPropagation(); element.classList.remove('flow-drop-active');
    let drag = state.flowDrag;
    try { drag = JSON.parse(event.dataTransfer.getData(FLOW_DRAG_MIME)) || drag; } catch (_) { /* use live drag */ }
    if (!drag || drag.themeIndex !== themeIndex) return;
    editFlow(() => {
      const themes = state.flowConfig.mapThemes;
      const target = themes[themeIndex].turnSequence[turnIndex].mapSet;
      let at = insertIndex, entry;
      if (drag.kind === 'turnMap') {
        const source = themes[drag.themeIndex].turnSequence[drag.turnIndex].mapSet;
        entry = source[drag.mapIndex];                 // move the existing entry, keeping its weight
        source.splice(drag.mapIndex, 1);
        if (source === target && drag.mapIndex < at) at--;
      } else {
        entry = { mapName: drag.name, weight: DEFAULT_MAP_WEIGHT };   // palette -> new reference
      }
      target.splice(clamp(at, 0, target.length), 0, entry);
    });
    endFlowDrag();
  };
}

function addMapToLastTurn(theme, mapName) {
  editFlow(() => {
    if (!theme.turnSequence.length) theme.turnSequence.push({ mapSet: [] });
    theme.turnSequence[theme.turnSequence.length - 1].mapSet.push({ mapName, weight: DEFAULT_MAP_WEIGHT });
  });
}

function moveFlowTurn(theme, turnIndex, delta) {
  const next = turnIndex + delta;
  if (next < 0 || next >= theme.turnSequence.length) return;
  editFlow(() => {
    const [turn] = theme.turnSequence.splice(turnIndex, 1);
    theme.turnSequence.splice(next, 0, turn);
  });
}

async function deleteFlowTurn(theme, turnIndex) {
  const turn = theme.turnSequence[turnIndex];
  if (turn.mapSet.length && !await showConfirm(`回合 ${turnIndex + 1} 中有 ${turn.mapSet.length} 次地图引用，仍要删除？`, { danger: true })) return;
  editFlow(() => theme.turnSequence.splice(turnIndex, 1));
}

async function deleteFlowTheme(themeIndex) {
  const theme = state.flowConfig.mapThemes[themeIndex];
  const refs = theme.turnSequence.reduce((n, turn) => n + turn.mapSet.length, 0);
  const suffix = refs ? `\n其中的 ${refs} 次地图引用也会一并移除。` : '';
  if (!await showConfirm(`从流程中删除主题「${theme.name}」？${suffix}`, { danger: true })) return;
  editFlow(() => state.flowConfig.mapThemes.splice(themeIndex, 1));
}

async function addFlowTheme() {
  if (!state.themes.length) return showAlert('请先在左侧「主题」中创建至少一个地图主题。');
  const maxStage = Math.max(1, ...state.flowConfig.mapThemes.map(theme => Number.isInteger(theme.stage) ? theme.stage : 1));
  const values = await showModal('添加流程主题', [
    { key:'name', label:'地图主题', type:'select', value:state.themes[0],
      options:state.themes.map(name => ({ value:name, label:name })) },
    { key:'stage', label:'游戏阶段', type:'number', value:maxStage },
    { key:'weight', label:'出现权重', type:'number', value:100 },
  ]);
  if (!values) return;
  const theme = {
    name: values.name,
    stage: Math.max(1, Math.round(+values.stage || 1)),
    weight: Math.max(0, +values.weight || 0),
    turnSequence: [],
  };
  state.flowExpanded.add(theme);
  editFlow(() => state.flowConfig.mapThemes.push(theme));
}

function validateFlowForSave() {
  const errors = [], warnings = [];
  state.flowConfig.mapThemes.forEach((theme, themeIndex) => {
    const base = `第 ${themeIndex + 1} 个主题`;
    if (!theme.name) errors.push(`${base}缺少主题名`);
    if (!Number.isInteger(theme.stage) || theme.stage < 1) errors.push(`${base}的阶段必须是大于等于 1 的整数`);
    if (!Number.isFinite(theme.weight) || theme.weight < 0) errors.push(`${base}的权重必须大于等于 0`);
    theme.turnSequence.forEach((turn, turnIndex) => {
      if (!turn.mapSet.length) warnings.push(`${theme.name} / 回合 ${turnIndex + 1} 没有地图`);
      for (const entry of turn.mapSet) {
        const issue = flowMapIssue(theme, entry.mapName);
        if (issue) warnings.push(`${theme.name} / 回合 ${turnIndex + 1} / ${entry.mapName}：${issue}`);
      }
    });
  });
  return { errors, warnings };
}

async function saveFlowConfig() {
  const result = validateFlowForSave();
  if (result.errors.length) return showAlert('无法保存：\n' + result.errors.join('\n'));
  if (result.warnings.length &&
      !await showConfirm(`发现 ${result.warnings.length} 个编排提示：\n\n${result.warnings.slice(0, 8).join('\n')}${result.warnings.length > 8 ? '\n…' : ''}\n\n仍要保存吗？`)) return;
  let response;
  try { response = await API.saveMapThemes(state.flowConfig); }
  catch (err) { return showAlert('保存失败：' + err); }
  if (!response.ok) {
    let data = {};
    try { data = await response.json(); } catch (_) { /* use fallback */ }
    return showAlert('保存失败：\n' + ((data.errors || [data.error || response.statusText]).join('\n')));
  }
  state.flowSavedJson = flowSnapshot(); state.flowDirty = false;
  updateTitle(); renderFlowStats(); toast('关卡流程已保存');
}

/* ------------------------------------------------------------------ *
 * Map list (grouped by theme)
 * ------------------------------------------------------------------ */
function renderMapList() {
  const ul = $('#mapList'); ul.innerHTML = '';
  const groups = new Map();
  for (const th of state.themes) groups.set(th, []);          // known themes first (even if empty)
  for (const m of state.maps) {
    const key = (m.theme && state.themes.includes(m.theme)) ? m.theme : '（未分类）';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const order = [...state.themes];
  for (const k of groups.keys()) if (!order.includes(k)) order.push(k);  // 未分类 last
  for (const key of order) {
    const arr = groups.get(key) || [];
    if (key === '（未分类）' && !arr.length) continue;
    const head = document.createElement('li'); head.className = 'group-head';
    head.textContent = `${key} (${arr.length})`;
    ul.appendChild(head);
    for (const m of arr) {
      const li = document.createElement('li');
      li.className = 'map-item' + (m.name === state.currentName ? ' active' : '');
      li.textContent = m.name;
      if (m.name === state.currentName && state.dirty) {
        const d = document.createElement('span'); d.className = 'dot'; d.textContent = '●'; li.appendChild(d);
      }
      li.onclick = () => loadMap(m.name);
      ul.appendChild(li);
    }
  }
  const has = !!state.current;
  ['#dupBtn','#renameBtn','#resizeBtn','#delBtn'].forEach(s => $(s).disabled = !has);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function section(title, iconName) {
  const s = document.createElement('div'); s.className = 'section';
  const h = document.createElement('h3');
  if (iconName) h.innerHTML = icon(iconName) + `<span>${escapeHtml(title)}</span>`;
  else h.textContent = title;
  s.appendChild(h);
  return s;
}
function hint(t) { const p = document.createElement('div'); p.className = 'hint'; p.textContent = t; return p; }
function labelEl(t) { const l = document.createElement('label'); l.textContent = t; return l; }
function inputEl(type, val) { const i = document.createElement('input'); i.type = type; i.value = val; return i; }
function mkBtn(label, fn) { const b = document.createElement('button'); b.className = 'mini'; b.textContent = label; b.onclick = fn; return b; }
function clamp(v, lo, hi) { v = isNaN(v) ? lo : v; return Math.max(lo, Math.min(hi, v)); }
function brushLabel() { const r = state.brushRadius; return r === 0 ? '笔刷 单格' : `笔刷 半径 ${r}`; }
function syncBrushUI() {
  const sl = $('#brushRadius'); if (sl) sl.value = state.brushRadius;
  const lab = $('#brushSizeLabel'); if (lab) lab.textContent = brushLabel();
}
function isKnownUnit(name) { return state.units.some(u => u.id === name); }
function isTerrainDeployable(x, y) {             // false only if the tile's terrain is explicitly non-deployable
  const m = state.current;
  const t = state.terrainById[m.tiles[y * m.width + x]];
  return !t || t.deployable !== false;
}
function enemyPositionIssues(x, y) {
  const issues = [];
  if (!isTerrainDeployable(x, y)) issues.push('不可部署地块');
  if (inDeploy(x, y)) issues.push('玩家部署区');
  return issues;
}
function terrainOptions(list) { return (list || state.terrains).map(t => ({ value: t.id, label: `${t.name} (#${t.id})` })); }
function initials(name) { return (state.abbrevs && state.abbrevs[name]) || fallbackAbbr(name); }
function fallbackAbbr(name) {
  const L = (name.match(/[A-Za-z]/g) || []);
  if (!L.length) return name.slice(0, 3);
  return L[0].toUpperCase() + L.slice(1, 3).join('').toLowerCase();
}
/* Assign each unit a unique 3-letter marker; on collision, vary the 2nd/3rd
 * letters using the name's own letters, falling back to a digit suffix. */
function recomputeAbbrevs() { state.abbrevs = computeAbbrevs(unitsForPicker().map(u => u.id)); }
function computeAbbrevs(names) {
  const used = new Set(), out = {};
  for (const name of names) {
    const L = (name.match(/[A-Za-z]/g) || []);
    let abbr;
    if (L.length === 0) {
      abbr = uniquify((name.slice(0, 3) || '?').toUpperCase(), used);
    } else if (L.length <= 3) {
      abbr = uniquify(L[0].toUpperCase() + L.slice(1).join('').toLowerCase(), used);
    } else {
      const first = L[0].toUpperCase();
      abbr = null;
      for (let i = 1; i < L.length && !abbr; i++)
        for (let j = i + 1; j < L.length; j++) {
          const cand = first + L[i].toLowerCase() + L[j].toLowerCase();
          if (!used.has(cand)) { abbr = cand; break; }
        }
      if (!abbr) abbr = uniquify(first + L[1].toLowerCase() + L[2].toLowerCase(), used);
    }
    used.add(abbr); out[name] = abbr;
  }
  return out;
}
function uniquify(base, used) {
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) { const c = base.slice(0, 2) + n; if (!used.has(c)) return c; }
  return base;
}
function randColor() {
  const ch = () => (60 + Math.floor(Math.random() * 150)).toString(16).padStart(2, '0');
  return '#' + ch() + ch() + ch();
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function scrollToCell(x, y) {
  const c = state.cellEls[y] && state.cellEls[y][x];
  if (c) c.scrollIntoView({ block:'center', inline:'center', behavior:'smooth' });
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 1800);
}

/* ------------------------------------------------------------------ *
 * Custom alert / confirm (replace the browser's native dialogs).
 * Rendered in #dialogLayer, which stacks ABOVE #modalLayer so a confirm
 * can pop over an open config window without destroying it.
 * ------------------------------------------------------------------ */
function showMessage({ title = '提示', message = '', confirmText = '确定', cancelText = null, danger = false }) {
  return new Promise(resolve => {
    const layer = $('#dialogLayer'); layer.classList.remove('hidden');
    const box = document.createElement('div'); box.className = 'modal dialog-modal';
    const h = document.createElement('h2'); h.textContent = title; box.appendChild(h);
    const body = document.createElement('div'); body.className = 'dialog-message'; body.textContent = message; box.appendChild(body);
    const actions = document.createElement('div'); actions.className = 'actions';
    if (cancelText != null) { const c = mkBtn(cancelText, () => close(false)); c.className = ''; actions.appendChild(c); }
    const ok = document.createElement('button');
    ok.className = 'primary' + (danger ? ' danger-confirm' : ''); ok.textContent = confirmText;
    ok.onclick = () => close(true);
    actions.appendChild(ok); box.appendChild(actions);
    layer.innerHTML = ''; layer.appendChild(box); ok.focus();
    layer.onclick = e => { if (e.target === layer) close(cancelText != null ? false : true); };
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(cancelText != null ? false : true); }
    }
    function close(val) {
      layer.classList.add('hidden'); layer.innerHTML = ''; layer.onclick = null;
      document.removeEventListener('keydown', onKey, true); resolve(val);
    }
    document.addEventListener('keydown', onKey, true);   // capture: don't leak Esc/Enter to underlying handlers
  });
}
function showAlert(message, title) { return showMessage({ title: title || '提示', message, confirmText: '确定' }); }
function showConfirm(message, opts = {}) {
  return showMessage({
    title: opts.title || '确认', message,
    confirmText: opts.confirmText || '确定', cancelText: opts.cancelText || '取消', danger: !!opts.danger,
  });
}

/* modal: fields -> Promise<values|null> */
function showModal(title, fields) {
  return new Promise(resolve => {
    const layer = $('#modalLayer'); layer.classList.remove('hidden');
    const box = document.createElement('div'); box.className = 'modal';
    box.innerHTML = `<h2>${escapeHtml(title)}</h2>`;
    const inputs = {};
    for (const f of fields) {
      const row = document.createElement('div'); row.className = 'mfield';
      row.appendChild(labelEl(f.label));
      let inp;
      if (f.type === 'select') {
        inp = document.createElement('select');
        for (const o of f.options) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; inp.appendChild(op); }
        inp.value = f.value;
      } else { inp = inputEl(f.type, f.value); }
      inputs[f.key] = inp; row.appendChild(inp); box.appendChild(row);
    }
    const actions = document.createElement('div'); actions.className = 'actions';
    const cancel = mkBtn('取消', () => close(null)); cancel.className = '';
    const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = '确定';
    actions.append(cancel, ok); box.appendChild(actions);
    layer.innerHTML = ''; layer.appendChild(box);

    const first = box.querySelector('input,select'); if (first) first.focus();
    function done() { const v = {}; for (const k in inputs) v[k] = inputs[k].value; close(v); }
    function close(val) { layer.classList.add('hidden'); layer.innerHTML = ''; layer.onclick = null; document.removeEventListener('keydown', onKey); resolve(val || null); }
    ok.onclick = done;
    layer.onclick = e => { if (e.target === layer) close(null); };
    function onKey(e) { if (e.key === 'Enter') done(); if (e.key === 'Escape') close(null); }
    document.addEventListener('keydown', onKey);
  });
}

init();

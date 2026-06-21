'use strict';

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */
const API = {
  async maps()        { return (await fetch('/api/maps')).json(); },
  async map(n)        { return (await fetch('/api/maps/' + encodeURIComponent(n))).json(); },
  saveMap(n, obj)     { return fetch('/api/maps/' + encodeURIComponent(n),
                          { method:'PUT', headers:{'Content-Type':'application/json'},
                            body: JSON.stringify(obj) }); },
  delMap(n)           { return fetch('/api/maps/' + encodeURIComponent(n), { method:'DELETE' }); },
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
 * Init
 * ------------------------------------------------------------------ */
async function init() {
  try {
    const t = await API.terrains();
    state.terrains = t.terrains || [];
    state.themes = t.themes || [];
    indexTerrains();
    const e = await API.enemies();   setEnemyConfig(e);
    setEnemyEnums(await API.enemyEnums());
    const m = await API.maps();      state.maps = m.maps || [];
  } catch (err) {
    alert('无法连接本地服务，请确认 start.bat 正在运行。\n' + err);
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
  if ((state.dirty || state.unitsDirty) && !confirm('刷新会丢弃未保存的地图或 EnemyUnit 修改并从磁盘重读，继续？')) return;
  let t, e, enemyEnums, m;
  try {
    [t, e, enemyEnums, m] = await Promise.all([
      API.terrains(), API.enemies(), API.enemyEnums(), API.maps(),
    ]);
  } catch (err) { return alert('刷新失败：' + err); }
  state.dirty = false;                       // already confirmed -> skip loadMap's prompt
  state.terrains = t.terrains || []; state.themes = t.themes || [];
  indexTerrains(); setEnemyConfig(e); setEnemyEnums(enemyEnums); state.maps = m.maps || [];
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
  toast('已从磁盘刷新');
}

/* Settings: choose Maps folder / EnemyUnits / TileType paths (persisted in prefs.json). */
async function openSettings() {
  const data = await API.prefs();
  const layer = $('#modalLayer'); layer.classList.remove('hidden');
  const box = document.createElement('div'); box.className = 'modal'; box.style.minWidth = '560px';
  box.innerHTML = '<h2>⚙ 路径设置</h2>';
  box.appendChild(hint('指向你游戏工程里的实际文件，即可直接编辑/读取。留空=用默认内置路径。改动会立即保存到 config/prefs.json，下次启动自动加载。'));

  const fields = [
    { key: 'mapsDir',      label: 'Maps 文件夹', kind: 'dir',  defaultLabel: '软件目录/Maps' },
    { key: 'enemyFile',    label: 'EnemyUnits 文件', kind: 'file', defaultLabel: '软件目录/config/EnemyUnits.json' },
    { key: 'tileTypeFile', label: 'TileType 文件', kind: 'file', defaultLabel: '软件目录/config/TileType.cs' },
    { key: 'professionFile', label: 'Profession 文件', kind: 'file', defaultLabel: '软件目录/config/Profession.cs' },
    { key: 'skillFile',      label: 'Skill 文件', kind: 'file', defaultLabel: '软件目录/config/Skill.cs' },
    { key: 'equipmentFile',  label: 'Equipment 文件', kind: 'file', defaultLabel: '软件目录/config/Equipment.cs' },
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
    ex.textContent = data.exists[f.key] ? '✓' : '✗'; ex.style.color = data.exists[f.key] ? 'var(--ok)' : 'var(--danger)';
    const browse = mkBtn('浏览…', async () => {
      const r = await API.pick(f.kind, f.label);
      if (r.error) return alert('系统选择框不可用，请直接粘贴路径。\n(' + r.error + ')');
      if (r.path) { inp.value = r.path; ex.textContent = '✓'; ex.style.color = 'var(--ok)'; }
    });
    inputs[f.key] = inp;
    row.append(lab, inp, browse, ex); box.appendChild(row);
  }

  const actions = document.createElement('div'); actions.className = 'actions';
  const reset = mkBtn('恢复默认', () => { for (const f of fields) inputs[f.key].value = ''; });
  const cancel = mkBtn('取消', close);
  const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = '保存并重载';
  ok.onclick = async () => {
    const discarding = state.dirty || state.unitsDirty;
    if (discarding && !confirm('更换路径并重载会丢弃未保存的地图或 EnemyUnit 修改，继续？')) return;
    const body = {}; for (const f of fields) body[f.key] = inputs[f.key].value.trim();
    const r = await API.savePrefs(body).then(x => x.json());
    if (!r.ok) return alert('保存失败：\n' + (r.errors || ['未知错误']).join('\n'));
    if (discarding) { state.dirty = false; state.unitsDirty = false; }
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
  $('#saveBtn').onclick    = saveMap;
  $('#refreshBtn').onclick = refreshAll;
  $('#settingsBtn').onclick = openSettings;
  $('#undoBtn').onclick    = undo;
  $('#redoBtn').onclick    = redo;
  $('#mapTheme').onchange  = onMapThemeChange;
  $('#inferBtn').onclick   = inferCurrentTheme;
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveMap(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (e.key === 'Delete' && state.mode === 'enemy' && state.selectedEnemy) deleteSelectedEnemy();
  });
  window.addEventListener('beforeunload', e => {
    if (state.dirty || state.unitsDirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

function setMode(m) {
  state.mode = m;
  document.querySelectorAll('#modeTabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === m));
  applyGridModeClass();
  renderRight();
  repaintAll();
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
  $('#undoBtn').disabled = !state.undoStack.length;
  $('#redoBtn').disabled = !state.redoStack.length;
}

/* ------------------------------------------------------------------ *
 * Map loading / management
 * ------------------------------------------------------------------ */
async function confirmDiscard() {
  return !state.dirty || confirm('当前地图有未保存的修改，确定放弃并切换吗？');
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
  } else alert('保存失败');
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
  if (!/^[A-Za-z0-9_\-]+$/.test(v.name)) return alert('名称只能用字母/数字/下划线/连字符');
  if (mapNameExists(v.name)) return alert('已存在同名地图');
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
  if (!/^[A-Za-z0-9_\-]+$/.test(v.name)) return alert('名称非法');
  if (mapNameExists(v.name)) return alert('已存在同名地图');
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
  if (!/^[A-Za-z0-9_\-]+$/.test(v.name)) return alert('名称非法');
  if (mapNameExists(v.name)) return alert('已存在同名地图');
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
  if (!confirm(`确定删除地图「${state.currentName}」？此操作不可撤销。`)) return;
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
  function delTheme(th) {
    const maps = state.maps.filter(m => m.theme === th).map(m => m.name);
    const tiles = state.terrains.filter(t => t.theme === th).length;
    let msg = `删除主题「${th}」？`;
    if (maps.length) msg += `\n${maps.length} 张地图用到它，将变为「未分类」（数据不变）。`;
    if (tiles) msg += `\n${tiles} 个地块的主题会被清空（变为通用）。`;
    if (!confirm(msg)) return;
    state.themes = state.themes.filter(x => x !== th);
    for (const t of state.terrains) if (t.theme === th) t.theme = '';
    persist(); render();
  }
  async function doRename(oldName, nn) {
    const affectsCurrent = state.current && state.current.theme === oldName;
    if (affectsCurrent && state.dirty &&
        !confirm('当前地图有未保存修改，重命名主题会一并保存当前地图，继续？')) { render(); return; }
    state.themes = state.themes.map(t => t === oldName ? nn : t);
    for (const t of state.terrains) if (t.theme === oldName) t.theme = nn;
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
    toast(`已重命名为「${nn}」`);
  }
  async function inferAll() {
    if (state.dirty) {
      if (!confirm('批量推断会读写磁盘上的地图。当前地图有未保存修改，先保存？')) return;
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
    alert(`批量推断完成：\n归类 ${changed} 张，已有主题跳过 ${already} 张，无法推断 ${skipped} 张。`);
  }
  function render() {
    box.innerHTML = '<h2>🏷 管理主题</h2>';
    box.appendChild(hint('每个主题是一组地块。地图选定主题后，只能使用该主题的地块 +「通用」(无主题)地块。改名后回车即重命名（会同步更新用到它的地图与地块）。'));
    const list = document.createElement('div'); list.className = 'theme-list';
    if (!state.themes.length) list.appendChild(hint('（暂无主题，请在下方添加）'));
    for (const th of state.themes) {
      const row = document.createElement('div'); row.className = 'theme-row';
      const nm = inputEl('text', th); nm.className = 'nm'; nm.title = '改名后按回车重命名';
      nm.onchange = () => {
        const nn = nm.value.trim();
        if (!nn || nn === th) { nm.value = th; return; }
        if (state.themes.includes(nn)) { alert('已存在该主题'); nm.value = th; return; }
        doRename(th, nn);
      };
      const cnt = document.createElement('span'); cnt.className = 'cnt';
      cnt.textContent = `${state.terrains.filter(t => t.theme === th).length} 地块 · ${state.maps.filter(m => m.theme === th).length} 图`;
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕';
      del.title = '删除主题'; del.onclick = () => delTheme(th);
      row.append(nm, cnt, del); list.appendChild(row);
    }
    box.appendChild(list);
    const addRow = document.createElement('div'); addRow.className = 'mfield';
    const inp = inputEl('text', ''); inp.placeholder = '新主题名称';
    const addBtn = mkBtn('＋ 添加', () => {
      const val = inp.value.trim();
      if (!val) return;
      if (state.themes.includes(val)) return alert('已存在该主题');
      state.themes.push(val); persist(); render();
    });
    addRow.append(inp, addBtn); box.appendChild(addRow);
    const ops = document.createElement('div'); ops.className = 'toolrow'; ops.style.marginTop = '4px';
    ops.appendChild(mkBtn('🔍 批量推断未分类地图', inferAll));
    box.appendChild(ops);
    const actions = document.createElement('div'); actions.className = 'actions';
    const done = document.createElement('button'); done.className = 'primary'; done.textContent = '完成';
    done.onclick = () => {
      layer.classList.add('hidden'); layer.innerHTML = '';
      populateMapThemeSelect(); renderMapList(); renderRight();
    };
    actions.append(done); box.appendChild(actions);
  }
  render();
  layer.innerHTML = ''; layer.appendChild(box);
  layer.onclick = e => { if (e.target === layer) { layer.classList.add('hidden'); layer.innerHTML = ''; populateMapThemeSelect(); renderMapList(); renderRight(); } };
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
  c.classList.toggle('nodeploy', !isDeployable(x, y));
  c.innerHTML = '';
  const en = enemyAt(x, y);
  if (en) {
    const d = document.createElement('div');
    d.className = 'enemy';
    if (!isKnownUnit(en.name)) d.classList.add('unknown');
    if (isSelected(x, y)) d.classList.add('sel');
    d.textContent = initials(en.name);
    d.title = `${en.name} (${x},${y})`;
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
      if (!isDeployable(x, y)) { toast('该地块不可部署，不能放置敌人'); return; }
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
  if (en) s += `   👾 ${en.name}`;
  if (inDeploy(x, y)) s += '   🚩 部署区';
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
  if (!isDeployable(x, y)) return;                                // can't stand here
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

  const sec = section('🎨 地形画笔');
  const tools = document.createElement('div'); tools.className = 'toolrow';
  for (const [k, lbl] of [['brush','🖌 画笔'],['rect','▭ 矩形'],['fill','🪣 填充']]) {
    const b = document.createElement('button'); b.textContent = lbl;
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
  const sec = section('⚙ 地形配置');
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
  const close = mkBtn('✕', closeConfigEditor); close.className = 'config-modal-close'; close.title = '关闭';
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
    ? '⚙ 地形配置'
    : `⚙ EnemyUnit 配置${state.unitsDirty ? ' ●' : ''}`;
}

function renderOpenConfigEditor() {
  const body = $('#configEditorBody');
  if (!body || !activeConfigKind) return;
  const scrollTop = body.scrollTop;
  body.innerHTML = '';
  body.classList.toggle('enemy-config-body', activeConfigKind === 'enemy');
  $('#configEditorTitle').textContent = configEditorTitle();
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
  const sec = section('⚙ 地形配置');
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
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕';
    del.title = '删除该地形'; del.onclick = () => {
      if (confirm(`删除地形「${t.name}」(#${t.id})？使用它的地图格子会变为未知色。`)) {
        state.terrains.splice(i, 1); indexTerrains(); renderRight(); repaintAll(); refreshOpenConfigEditor('terrain');
      }
    };
    row.append(id, nm, th, dep, col, del); tbl.appendChild(row);
  });
  sec.appendChild(tbl);

  const bar = document.createElement('div'); bar.className = 'toolrow'; bar.style.marginTop = '10px';
  bar.append(
    mkBtn('＋ 新增', () => {
      const nextId = state.terrains.reduce((mx, t) => Math.max(mx, t.id), 0) + 1;
      state.terrains.push({ id: nextId, name: 'NewTile', color: '#cccccc', theme: effectiveTheme(), deployable: true });
      indexTerrains(); renderRight(); refreshOpenConfigEditor('terrain');
    }),
    mkBtn('↻ 从TileType导入', importFromTileType),
    (() => { const b = mkBtn('💾 保存配置', saveTerrainConfig); b.className = 'mini primary'; return b; })(),
  );
  sec.appendChild(bar);
  r.appendChild(sec);
}

async function saveTerrainConfig() {
  const ids = state.terrains.map(t => t.id);
  if (new Set(ids).size !== ids.length) return alert('存在重复的地形 id，请修正后再保存');
  const r = await API.saveTerrains({ themes: state.themes, terrains: state.terrains });
  if (r.ok) { indexTerrains(); repaintAll(); toast('地形配置已保存'); }
  else alert('保存失败');
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
  alert(added ? `导入了 ${added} 个新地形，请检查颜色后点「保存配置」` : '没有发现新的地形类型');
}

/* --- enemy panel --- */
function renderEnemyPanel(r) {
  r.innerHTML = '';
  const m = state.current;

  const ps = section('👾 敌人预设');
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
  const addP = document.createElement('div'); addP.className = 'preset-tab'; addP.textContent = '＋';
  addP.onclick = () => { edit(() => m.enemyPresets.push({ weight: 50, enemies: [] })); state.activePreset = m.enemyPresets.length - 1; renderRight(); repaintAll(); };
  tabs.appendChild(addP);
  ps.appendChild(tabs);

  const p = curPreset();
  const wrow = document.createElement('div'); wrow.className = 'fieldrow';
  const wIn = inputEl('number', p.weight); wIn.min = 0;
  wIn.onchange = () => { edit(() => { p.weight = clamp(+wIn.value, 0, 100000); }); renderEnemyPanel(r); };
  wrow.append(labelEl('权重'), wIn);
  const delP = mkBtn('删除本预设', () => {
    if (m.enemyPresets.length <= 1) return alert('至少保留一套预设');
    if (!confirm('删除当前预设？')) return;
    edit(() => m.enemyPresets.splice(state.activePreset, 1));
    state.activePreset = 0; state.selectedEnemy = null; renderRight(); repaintAll();
  });
  delP.className = 'mini danger'; wrow.appendChild(delP);
  ps.appendChild(wrow);
  r.appendChild(ps);

  const us = section('选择要放置的单位');
  us.appendChild(hint('选中后点网格放置；点已有敌人可拖动移动，右键删除。'));
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
    nm.onclick = () => { state.selectedEnemy = { preset: state.activePreset, index: i }; repaintAll(); renderEnemyPanel(r); scrollToCell(en.x, en.y); };
    const x = document.createElement('span'); x.className = 'x'; x.textContent = '✕';
    x.title = '删除'; x.onclick = () => { edit(() => p.enemies.splice(i, 1)); state.selectedEnemy = null; repaintAll(); renderEnemyPanel(r); };
    row.append(nm, x); list.appendChild(row);
  });
  es.appendChild(list);
  r.appendChild(es);

  renderEnemyUnitConfigEntry(r);
}

function renderEnemyUnitConfigEntry(r) {
  const sec = section(`⚙ EnemyUnit 配置${state.unitsDirty ? ' ●' : ''}`);
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

  const sec = section(`⚙ EnemyUnit 配置${state.unitsDirty ? ' ●' : ''}`);
  const enums = state.enemyEnums;
  sec.appendChild(hint(`枚举候选：职业 ${enums.professions.length} · 技能 ${enums.skills.length} · 装备 ${enums.equipments.length}。输入可搜索，但保存值必须来自对应的 C# enum。`));

  const tools = document.createElement('div'); tools.className = 'toolrow unit-config-tools';
  tools.append(
    mkBtn('＋ 新增', addEnemyUnit),
    mkBtn('复制', () => duplicateEnemyUnit(selected)),
    mkBtn('↑', () => moveEnemyUnit(selected, -1)),
    mkBtn('↓', () => moveEnemyUnit(selected, 1)),
    (() => { const b = mkBtn('删除', () => deleteEnemyUnit(selected)); b.className = 'mini danger'; return b; })(),
  );
  const save = mkBtn('💾 保存配置', saveEnemyUnits); save.className = 'mini primary unit-save';
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
  const addSkill = mkBtn('＋ 技能', () => {
    const value = firstEnumValue(enums.skills);
    if (!value) return alert('Skill enum 没有可用成员，请检查路径设置');
    (selected.skills ||= []).push({ skill: value, level: 1 });
    markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
  });
  skillTitle.appendChild(addSkill); form.appendChild(skillTitle);
  const skills = document.createElement('div'); skills.className = 'unit-sublist';
  (selected.skills ||= []).forEach((entry, index) => {
    const row = document.createElement('div'); row.className = 'unit-skill-row';
    const picker = enumPicker(enums.skills, entry.skill, value => {
      entry.skill = value; markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
    }, '搜索技能');
    const level = inputEl('number', entry.level); level.title = '技能等级'; level.step = 1;
    level.onchange = () => {
      const value = Number(level.value);
      if (!Number.isInteger(value)) { alert('技能等级必须是整数'); level.value = entry.level; return; }
      entry.level = value; markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
    };
    const del = mkBtn('✕', () => { selected.skills.splice(index, 1); markUnitsDirty(); renderEnemyUnitConfigPanelOnly(); });
    del.className = 'mini danger'; row.append(picker, level, del); skills.appendChild(row);
  });
  if (!selected.skills.length) skills.appendChild(hint('没有技能'));
  form.appendChild(skills);

  const equipmentTitle = document.createElement('div'); equipmentTitle.className = 'subhead';
  equipmentTitle.innerHTML = '<b>Equipments</b><span class="grow"></span>';
  const addEquipment = mkBtn('＋ 装备', () => {
    const value = firstEnumValue(enums.equipments);
    if (!value) return alert('Equipment enum 没有可用成员，请检查路径设置');
    (selected.equipments ||= []).push(value);
    markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
  });
  equipmentTitle.appendChild(addEquipment); form.appendChild(equipmentTitle);
  const equipments = document.createElement('div'); equipments.className = 'unit-sublist';
  (selected.equipments ||= []).forEach((equipment, index) => {
    const row = document.createElement('div'); row.className = 'unit-equipment-row';
    const picker = enumPicker(enums.equipments, equipment, value => {
      selected.equipments[index] = value; markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
    }, '搜索装备');
    const del = mkBtn('✕', () => { selected.equipments.splice(index, 1); markUnitsDirty(); renderEnemyUnitConfigPanelOnly(); });
    del.className = 'mini danger'; row.append(picker, del); equipments.appendChild(row);
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
  if (!profession) return alert('Profession enum 没有可用成员，请检查路径设置');
  const unit = { id: nextUnitId('NewEnemy'), profession, skills: [], equipments: [] };
  state.units.push(unit); state.activeUnitId = unit.id;
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

function duplicateEnemyUnit(unit) {
  if (!unit) return alert('请先选择一个 EnemyUnit');
  const copy = JSON.parse(JSON.stringify(unit));
  copy.id = nextUnitId(unit.id + 'Copy');
  state.units.splice(state.units.indexOf(unit) + 1, 0, copy);
  state.activeUnitId = copy.id;
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

function moveEnemyUnit(unit, delta) {
  if (!unit) return alert('请先选择一个 EnemyUnit');
  const from = state.units.indexOf(unit), to = clamp(from + delta, 0, state.units.length - 1);
  if (from === to) return;
  state.units.splice(to, 0, state.units.splice(from, 1)[0]);
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

function renameEnemyUnit(unit, newId) {
  const oldId = unit.id;
  if (newId === oldId) return;
  if (!/^[A-Za-z_]\w*$/.test(newId)) { alert('ID 必须是合法标识符：以字母或下划线开头，只包含字母、数字、下划线'); renderEnemyUnitConfigPanelOnly(); return; }
  if (state.units.some(other => other !== unit && other.id === newId)) { alert('已经存在同名 EnemyUnit'); renderEnemyUnitConfigPanelOnly(); return; }
  const refs = state.current ? state.current.enemyPresets.reduce((sum, preset) => sum + preset.enemies.filter(enemy => enemy.name === oldId).length, 0) : 0;
  const message = `确定把 EnemyUnit「${oldId}」改名为「${newId}」？\n` +
    (refs ? `当前地图中的 ${refs} 个引用会同步修改，并需要另行保存地图。\n` : '') +
    '其他地图文件中的引用不会自动修改。';
  if (!confirm(message)) { renderEnemyUnitConfigPanelOnly(); return; }
  unit.id = newId; state.activeUnitId = newId;
  if (refs) edit(() => {
    for (const preset of state.current.enemyPresets)
      for (const enemy of preset.enemies) if (enemy.name === oldId) enemy.name = newId;
  });
  markUnitsDirty(); renderEnemyUnitConfigPanelOnly();
}

function deleteEnemyUnit(unit) {
  if (!unit) return alert('请先选择一个 EnemyUnit');
  const refs = state.current ? state.current.enemyPresets.reduce((sum, preset) => sum + preset.enemies.filter(enemy => enemy.name === unit.id).length, 0) : 0;
  const warning = refs ? `\n当前地图中有 ${refs} 个引用，删除后会显示为未知单位。` : '';
  if (!confirm(`确定删除 EnemyUnit「${unit.id}」？${warning}\n其他地图文件不会被修改。`)) return;
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
  if (errors.length) return alert('EnemyUnits 校验失败：\n' + errors.slice(0, 12).join('\n') + (errors.length > 12 ? `\n……另有 ${errors.length - 12} 项` : ''));
  const response = await API.saveEnemies(state.enemyConfig);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) return alert('EnemyUnits 保存失败：\n' + (result.errors || [result.error || '未知错误']).join('\n'));
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
  const sec = section('🚩 可部署区域 (自由形状)');
  sec.appendChild(hint('左键涂格设为可部署，右键擦除（都可拖动）。保存为坐标列表 [{x,y}]。'));
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
function section(title) {
  const s = document.createElement('div'); s.className = 'section';
  const h = document.createElement('h3'); h.textContent = title; s.appendChild(h);
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
function isDeployable(x, y) {                    // false only if the tile's terrain is explicitly non-deployable
  const m = state.current;
  const t = state.terrainById[m.tiles[y * m.width + x]];
  return !t || t.deployable !== false;
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

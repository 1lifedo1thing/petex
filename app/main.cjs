const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, screen, protocol, net, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Library, normalizeSettings } = require('./library.cjs');
const {findArchive, readBuiltins} = require('./codex-builtins.cjs');
const { DragTracker } = require('./drag.cjs');

if (process.env.PEDEX_DATA_DIR) app.setPath('userData', process.env.PEDEX_DATA_DIR);
app.setName('Pedex');
// Anonymous image loads need a CORS-enabled scheme to preserve canvas alpha reads.
protocol.registerSchemesAsPrivileged([{scheme: 'pet-asset', privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true}}]);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let library, settings, pets = [], petWindow, settingsWindow, tray, timer, drag = null, quitting = false;
let queue = Promise.resolve();
const enqueue = action => { const result = queue.then(action); queue = result.catch(() => {}); return result; };
const rendererPath = name => path.join(__dirname, 'renderer', name);
const selectedPet = () => pets.find(p => p.id === settings.petId) || pets[0];
const snapshot = () => ({settings, pets, platform: process.platform, version: app.getVersion(), loginAvailable: app.isPackaged && !process.env.PEDEX_DATA_DIR});
function broadcast() {
  for (const win of [petWindow, settingsWindow]) if (win && !win.isDestroyed()) win.webContents.send('state:changed', snapshot());
  updateTray();
}
function secure(win) {
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
}
function windowOptions() { return {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: true}; }
function dimensions() { return {width: settings.size + 32, height: Math.ceil(settings.size * 208 / 192) + 32}; }
function clampPosition(position) {
  const {width, height} = dimensions();
  const area = screen.getDisplayNearestPoint({x: Math.round(position.x + width / 2), y: Math.round(position.y + height / 2)}).workArea;
  return {x: Math.round(Math.min(Math.max(position.x, area.x), area.x + area.width - width)), y: Math.round(Math.min(Math.max(position.y, area.y), area.y + area.height - height))};
}
function resetPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  const {width, height} = dimensions();
  settings.position = clampPosition({x: area.x + area.width - width - 64, y: area.y + area.height - height - 24});
  petWindow.setPosition(settings.position.x, settings.position.y);
}
function applySettings() {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (!settings.visible && drag) finishPress();
  const {width, height} = dimensions();
  const current = petWindow.getBounds();
  const pos = clampPosition(settings.position || current);
  petWindow.setBounds({...pos, width, height});
  settings.position = pos;
  petWindow.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  if (process.platform === 'darwin') petWindow.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true});
  if (settings.visible) petWindow.showInactive(); else petWindow.hide();
  broadcast();
}
function showSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({width: 660, height: 660, minWidth: 560, minHeight: 600, title: 'Pedex', backgroundColor: '#f7f8f2', titleBarStyle: 'hidden', ...(process.platform === 'darwin' ? {trafficLightPosition: {x: 20, y: 21}} : {titleBarOverlay: {color: '#f7f8f2', symbolColor: '#354330', height: 42}}), autoHideMenuBar: true, show: false, webPreferences: windowOptions()});
  secure(settingsWindow);
  settingsWindow.loadFile(rendererPath('settings.html'));
  settingsWindow.once('ready-to-show', () => {settingsWindow.show(); settingsWindow.focus();});
  settingsWindow.on('closed', () => {settingsWindow = null;});
}
function updateTray() {
  if (!tray || !settings) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: `Pedex · ${selectedPet().displayName}`, enabled: false},
    {label: 'Settings…', click: showSettings},
    {type: 'separator'},
    {label: settings.visible ? 'Hide pet' : 'Show pet', click: () => enqueue(async () => {settings.visible = !settings.visible; applySettings(); await library.saveSettings(settings);})},
    {label: settings.motion ? 'Pause animation' : 'Resume animation', click: () => enqueue(async () => {settings.motion = !settings.motion; broadcast(); await library.saveSettings(settings);})},
    {label: 'Reset pet position', click: () => enqueue(async () => {settings.visible = true; resetPosition(); applySettings(); await library.saveSettings(settings);})},
    {type: 'separator'},
    {label: 'Quit Pedex', accelerator: 'CommandOrControl+Q', click: () => app.quit()},
  ]));
}
function petMenu() {
  Menu.buildFromTemplate([
    {label: 'Wave', click: () => petWindow.webContents.send('pet:action', 'waving')},
    {label: 'Jump', click: () => petWindow.webContents.send('pet:action', 'jumping')},
    {type: 'separator'},
    {label: 'Settings…', click: showSettings},
    {label: 'Hide pet', click: () => enqueue(async () => {settings.visible = false; applySettings(); await library.saveSettings(settings);})},
    {type: 'separator'},
    {label: 'Quit Pedex', click: () => app.quit()},
  ]).popup({window: petWindow});
}
function handler(channel, allowed, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!allowed().includes(win) || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted request.');
    try { return {ok: true, value: await action(...args)}; } catch (error) { return {ok: false, error: error.message || 'Something went wrong. Please try again.'}; }
  });
}
function updateDrag(cursor) {
  if (!drag) return null;
  const state = drag.update(cursor, performance.now());
  if (state.dragging) {
    const position = clampPosition(state.position);
    const current = petWindow.getBounds();
    if (position.x !== current.x || position.y !== current.y) petWindow.setPosition(position.x, position.y);
  }
  return state;
}
function pollCursor() {
  if (!settings.visible || petWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const movement = updateDrag(cursor);
  const bounds = petWindow.getBounds();
  petWindow.webContents.send('pet:cursor', {
    x: cursor.x - bounds.x, y: cursor.y - bounds.y,
    dragging: movement?.dragging || false,
    direction: movement?.direction || null,
    dragGaze: movement?.gaze || null,
  });
}
function setCursorPolling(interval) {
  clearInterval(timer);
  timer = setInterval(pollCursor, interval);
}
function finishPress() {
  if (drag) {
    updateDrag(screen.getCursorScreenPoint());
    drag = null;
    settings.position = clampPosition(petWindow.getBounds());
  }
  setCursorPolling(50);
}
function configureIPC() {
  const both = () => [petWindow, settingsWindow].filter(Boolean);
  const settingsOnly = () => [settingsWindow].filter(Boolean);
  handler('state:get', both, () => snapshot());
  handler('settings:update', settingsOnly, patch => enqueue(async () => {
    if (!patch || typeof patch !== 'object') throw new Error('Invalid settings.');
    const permitted = ['petId', 'size', 'alwaysOnTop', 'motion', 'randomAnimations', 'followCursor', 'launchAtLogin', 'visible'];
    const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => permitted.includes(key)));
    if (clean.petId && !pets.some(p => p.id === clean.petId)) throw new Error('That pet is no longer in your collection.');
    const next = normalizeSettings({...settings, ...clean});
    if (next.launchAtLogin !== settings.launchAtLogin) {
      if (!snapshot().loginAvailable) throw new Error('Launch at login is available in the installed app.');
      app.setLoginItemSettings({openAtLogin: next.launchAtLogin, ...(process.platform === 'win32' ? {args: ['--hidden']} : {})});
      next.launchAtLogin = app.getLoginItemSettings().openAtLogin;
    }
    settings = next;
    applySettings(); await library.saveSettings(settings); return snapshot();
  }));
  async function importPaths(paths) {
    const results = [];
    for (const file of paths.slice(0, 30)) {
      try { results.push({...await library.import(file), source: path.basename(file)}); }
      catch (error) { results.push({error: error.message, source: path.basename(file)}); }
    }
    pets = await library.list();
    const first = results.find(r => r.pet);
    if (first) {settings.petId = first.pet.id; settings.visible = true;}
    applySettings(); await library.saveSettings(settings); return results;
  }
  handler('pets:import-dialog', settingsOnly, async kind => {
    const result = await dialog.showOpenDialog(settingsWindow, kind === 'folder' ? {title: 'Choose a Codex pet folder', properties: ['openDirectory']} : {title: 'Import a pet', properties: ['openFile', 'multiSelections'], filters: [{name: 'Codex pets', extensions: ['zip', 'json', 'png', 'webp']}]});
    if (result.canceled) return [];
    return enqueue(() => importPaths(result.filePaths));
  });
  handler('pets:import-dropped', settingsOnly, paths => {
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) throw new Error('Drop a pet folder or file.');
    return enqueue(() => importPaths(paths));
  });
  handler('pets:import-builtins', settingsOnly, async () => {
    let archive = process.mas ? null : await findArchive(process.env.PEDEX_CODEX_APP);
    if (!archive) {
      const result = await dialog.showOpenDialog(settingsWindow, {title:'Choose the installed ChatGPT or Codex app', properties:['openFile','openDirectory'], defaultPath:process.platform === 'darwin' ? '/Applications' : undefined});
      if(result.canceled)return [];
      archive = await findArchive(result.filePaths[0]);
      if(!archive)throw new Error('Choose the ChatGPT or Codex app, its installation folder, or app.asar.');
    }
    const builtins = await readBuiltins(archive);
    return enqueue(async () => {
      const results=[];
      for(const {manifest,bytes} of builtins)results.push({...await library.importSprite(manifest,bytes),source:manifest.displayName});
      pets=await library.list();
      const added=results.find(r=>!r.duplicate);
      if(added){settings.petId=added.pet.id;settings.visible=true;}
      applySettings();await library.saveSettings(settings);return results;
    });
  });
  handler('pets:discover', settingsOnly, () => enqueue(async () => {
    let home = process.env.PEDEX_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    if(process.mas){
      const choice=await dialog.showOpenDialog(settingsWindow,{title:'Choose your .codex folder',properties:['openDirectory','showHiddenFiles']});
      if(choice.canceled)return {found:0,results:[]};
      home=choice.filePaths[0];
    }
    const found = await library.discover(home);
    return {found: found.length, results: await importPaths(found.map(p => p.source))};
  }));
  handler('pets:remove', settingsOnly, id => enqueue(async () => {
    const pet = pets.find(p => p.id === id && !p.builtin);
    if (!pet) throw new Error('This pet cannot be removed.');
    const answer = await dialog.showMessageBox(settingsWindow, {type: 'question', message: `Remove ${pet.displayName}?`, detail: 'This removes the Pedex copy. Your original Codex pet stays where it is.', buttons: ['Keep pet', 'Remove'], defaultId: 0, cancelId: 0});
    if (answer.response !== 1) return false;
    await library.remove(id); pets = await library.list();
    if (settings.petId === id) settings.petId = 'miso';
    applySettings(); await library.saveSettings(settings); return true;
  }));
  handler('pet:home', settingsOnly, () => enqueue(async () => {settings.visible = true; resetPosition(); applySettings(); await library.saveSettings(settings);}));
  handler('pet:play', settingsOnly, name => {
    const valid = selectedPet().builtin ? ['waving','jumping','running-left','running-right'] : ['waving','jumping','failed','waiting','running','review','running-left','running-right'];
    if (!valid.includes(name)) throw new Error('Unsupported animation.');
    petWindow.webContents.send('pet:action', name);
  });
  handler('settings:close', settingsOnly, () => settingsWindow.close());
  handler('repository:open', settingsOnly, () => shell.openExternal('https://github.com/iebb/petex'));
  handler('pets:open-folder', settingsOnly, async () => {
    const error = await shell.openPath(library.petsPath);
    if (error) throw new Error(error);
  });
  handler('pet:menu', () => [petWindow], petMenu);
  handler('pet:press-start', () => [petWindow], () => {
    drag = new DragTracker(screen.getCursorScreenPoint(), petWindow.getBounds(), performance.now());
    petWindow.setIgnoreMouseEvents(false);
    setCursorPolling(16);
  });
  handler('pet:press-end', () => [petWindow], () => {
    finishPress();
    return enqueue(() => library.saveSettings(settings));
  });
  handler('pet:hit', () => [petWindow], hit => {if (!drag) petWindow.setIgnoreMouseEvents(hit !== true, {forward: true});});
}
app.on('second-instance', showSettings);
app.on('activate', () => {if (library) showSettings();});
app.on('window-all-closed', () => {});
app.on('before-quit', () => {quitting = true; clearInterval(timer);});
if (locked) app.whenReady().then(async () => {
  library = new Library(app.getPath('userData')); await library.init();
  settings = await library.settings(); pets = await library.list();
  if (!pets.some(p => p.id === settings.petId)) settings.petId = 'miso';
  if (snapshot().loginAvailable) settings.launchAtLogin = app.getLoginItemSettings().openAtLogin;
  protocol.handle('pet-asset', async request => {
    const url = new URL(request.url);
    const match = /^\/([a-f0-9-]{36})\/(spritesheet\.(?:png|webp))$/.exec(url.pathname);
    if (url.hostname !== 'library' || !match || !pets.some(p => p.id === match[1])) return new Response('Not found', {status: 404});
    const file = path.join(library.petsPath, match[1], match[2]);
    try {
      const actual = await fs.realpath(file);
      if (path.dirname(actual) !== await fs.realpath(path.dirname(file))) return new Response('Forbidden', {status: 403});
      const response = await net.fetch(pathToFileURL(actual).href);
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, {status: response.status, headers});
    } catch { return new Response('Not found', {status: 404}); }
  });
  petWindow = new BrowserWindow({...dimensions(), frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, show: false, title: 'Pedex pet', webPreferences: windowOptions()});
  secure(petWindow);
  petWindow.setIgnoreMouseEvents(true, {forward: true});
  petWindow.on('close', e => {if (!quitting) {e.preventDefault(); petWindow.hide();}});
  configureIPC();
  await petWindow.loadFile(rendererPath('pet.html'));
  if (!settings.position) resetPosition();
  applySettings();
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('Pedex');
  tray.on('double-click', showSettings);
  updateTray();
  if (process.platform === 'darwin') app.dock.hide();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label: 'Pedex', submenu: [{label: 'Settings…', accelerator: 'CommandOrControl+,', click: showSettings}, {role: 'quit'}]}, {role: 'editMenu'}]));
  setCursorPolling(50);
  screen.on('display-removed', () => enqueue(async () => {settings.position = clampPosition(petWindow.getBounds()); applySettings(); await library.saveSettings(settings);}));
  screen.on('display-metrics-changed', () => applySettings());
  if (!process.argv.includes('--hidden') && !app.getLoginItemSettings().wasOpenedAtLogin) showSettings();
}).catch(error => {dialog.showErrorBox('Pedex could not start', error.message); app.quit();});

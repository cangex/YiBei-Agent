import { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile, mkdir, stat, rename } from 'node:fs/promises';
import { ProjectStore } from './lib/project-store.mjs';
import { createLocalServer } from './lib/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setName('益贝医疗智能体');
app.setAppUserModelId('cn.yibei.medical.desktop');
if (process.env.YIBEI_TEST_USER_DATA && !app.isPackaged) app.setPath('userData', path.resolve(process.env.YIBEI_TEST_USER_DATA));
else app.setPath('userData', path.join(app.getPath('appData'), 'YiBeiMedical'));
app.enableSandbox();
let window, server, store, mayClose = false, closePending = false;
const logFolder = path.join(app.getPath('userData'), 'logs');
async function log(message) {
  await mkdir(logFolder, { recursive: true });
  const file = path.join(logFolder, 'desktop.log');
  if ((await stat(file).catch(() => ({ size: 0 }))).size > 2 * 1024 * 1024) await rename(file, `${file}.previous`).catch(() => {});
  await appendFile(file, `${new Date().toISOString()} ${String(message).slice(0, 1800)}\n`).catch(() => {});
}
function sendAction(action) { window?.webContents.send('project:action', action); }
const safeError = (error) => {
  if (error.code === 'ENOSPC') return '磁盘空间不足，请清理空间后再保存。';
  if (error.code === 'EACCES' || error.code === 'EPERM') return '没有项目目录的读写权限，请检查目录权限。';
  if (error.code === 'ENOENT') return '项目或模型文件已被移动，请重新打开完整项目。';
  if (error instanceof SyntaxError) return '项目文件损坏，无法读取。原文件未被修改。';
  return error.message || '操作失败，请重试。';
};
function handler(name, action) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== server.origin) throw new Error('拒绝未授权请求');
    try { return { ok: true, value: await action(...args) }; }
    catch (error) { await log(`${name}: ${safeError(error)}`); return { ok: false, error: safeError(error) }; }
  });
}
function buildMenu() {
  const project = { label: '项目', submenu: [
    { label: '新建项目…', accelerator: 'CmdOrCtrl+N', click: () => sendAction('new') },
    { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: () => sendAction('open') },
    { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => sendAction('save') },
    { type: 'separator' },
    { label: '打开项目所在目录', click: () => { if (store?.file) shell.showItemInFolder(store.file); } },
    { type: 'separator' }, { role: 'quit', label: '退出' },
  ] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu', label: '益贝医疗智能体' }] : []), project,
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '视图', submenu: [{ label: '重新加载界面', accelerator: 'CmdOrCtrl+R', click: () => sendAction('reload') }, { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '全屏' }] },
    { label: '帮助', submenu: [
      { label: '使用说明', click: () => sendAction('help') },
      { label: '打开日志目录', click: () => shell.openPath(logFolder) },
      { label: '关于益贝', click: () => dialog.showMessageBox(window, { type: 'info', title: '益贝医疗智能体', message: `益贝医疗智能体 ${app.getVersion()}`, detail: '离线桌面版 · 前端确定性演示\n本版本不执行真实 AI 推理或临床验证。\n手动升级：关闭本软件后运行新版本安装包。客户项目独立保存，不随升级覆盖。' }) },
    ] },
  ]));
}

async function start() {
  await app.whenReady();
  await log(`start version=${app.getVersion()} platform=${process.platform} arch=${process.arch}`);
  store = new ProjectStore(app.getPath('userData'), path.join(here, 'renderer', 'models', 'demo.stl'));
  try { await store.initialize(); }
  catch (error) {
    const choice = await dialog.showMessageBox({ type: 'warning', buttons: ['打开已有项目', '新建项目', '退出'], defaultId: 0, cancelId: 2, message: '上次项目无法自动恢复', detail: `${safeError(error)}\n已有项目不会被删除或覆盖。` });
    if (choice.response === 2) { app.quit(); return; }
    if (choice.response === 0) {
      const selected = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '益贝项目', extensions: ['yibei'] }] });
      if (selected.canceled) { app.quit(); return; }
      await store.openProject(selected.filePaths[0]);
    } else await store.create();
  }
  server = await createLocalServer(path.join(here, 'renderer'), store, (error) => log(`server: ${error.message}`));
  const isolated = session.fromPartition('yibei-offline');
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', (event) => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: !['blob:', 'data:', 'devtools:'].includes(url.protocol) && url.origin !== server.origin });
  });
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    if (new URL(details.url).origin === server.origin) details.requestHeaders['X-Yibei-Session'] = server.token;
    callback({ requestHeaders: details.requestHeaders });
  });
  window = new BrowserWindow({
    width: 1440, height: 960, minWidth: 1000, minHeight: 700, show: false,
    title: '益贝医疗智能体', backgroundColor: '#eef1ec', icon: path.join(here, 'icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true, spellcheck: false, webviewTag: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = new URL(url);
    if (['https:', 'http:'].includes(parsed.protocol) && parsed.origin !== server.origin && !/^(localhost|127\.|0\.|\[::)/.test(parsed.hostname)) {
      dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '打开系统浏览器'], message: '即将打开外部链接', detail: parsed.origin }).then(({ response }) => { if (response === 1) shell.openExternal(url); });
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== server.origin) event.preventDefault(); });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', async (_event, details) => {
    await log(`renderer gone: ${details.reason}`);
    const answer = await dialog.showMessageBox(window, { type: 'error', buttons: ['重新加载', '退出'], message: '界面渲染中断', detail: '项目已保存的部分仍在。可重新加载；如反复发生，请降低渲染质量。' });
    if (answer.response === 0) window.loadURL(server.origin); else { mayClose = true; app.quit(); }
  });
  window.webContents.on('unresponsive', () => log('renderer temporarily unresponsive'));
  window.webContents.on('did-fail-load', (_event, code, description) => { if (code !== -3) { log(`load failed ${code}: ${description}`); dialog.showErrorBox('界面加载失败', '请关闭并重新启动软件。详细信息已写入本地日志。'); } });
  window.on('close', (event) => {
    if (mayClose) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true; sendAction('close');
    const deadline = setTimeout(async () => {
      if (mayClose || !window || window.isDestroyed()) return;
      const choice = await dialog.showMessageBox(window, { type: 'warning', buttons: ['继续等待', '使用上次保存并退出'], message: '正在等待界面保存项目', detail: '强制退出可能丢失最后一秒的演示进度，不会修改原始 STL。' });
      closePending = false;
      if (choice.response === 1) { await store.queue; mayClose = true; window.close(); }
    }, 10000);
    deadline.unref();
  });
  handler('project:read', () => store.describe());
  handler('project:new', (name) => store.create(name));
  handler('project:open', async () => {
    const selected = await dialog.showOpenDialog(window, { title: '打开益贝项目', defaultPath: path.join(app.getPath('userData'), 'projects'), properties: ['openFile'], filters: [{ name: '益贝项目', extensions: ['yibei'] }] });
    return selected.canceled ? null : store.openProject(selected.filePaths[0]);
  });
  handler('project:save', (id, state) => store.save(state, id));
  handler('project:import', (id, bytes, name) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('模型数据无效。');
    return store.importModel(bytes, name, id);
  });
  handler('project:quality', (quality) => store.setQuality(quality));
  handler('project:reveal', () => { shell.showItemInFolder(store.file); return true; });
  handler('project:close-ready', async () => { if (!closePending) return; await store.queue; mayClose = true; window.close(); });
  buildMenu();
  window.once('ready-to-show', () => window.show());
  await window.loadURL(server.origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { server?.close(); });
  start().catch(async (error) => { await log(`startup: ${safeError(error)}`); dialog.showErrorBox('益贝医疗智能体无法启动', `${safeError(error)}\n请检查安装是否完整以及用户目录是否可写。`); mayClose = true; app.quit(); });
}

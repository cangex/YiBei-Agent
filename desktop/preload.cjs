// Electron's sandboxed preload intentionally uses its restricted CommonJS loader.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');
async function call(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
contextBridge.exposeInMainWorld('yibeiDesktop', {
  read: () => call('project:read'),
  create: (name) => call('project:new', name),
  open: () => call('project:open'),
  save: (id, state) => call('project:save', id, state),
  importSTL: (id, bytes, name) => call('project:import', id, bytes, name),
  quality: (value) => call('project:quality', value),
  reveal: () => call('project:reveal'),
  closeReady: () => call('project:close-ready'),
  onAction: (callback) => {
    const listener = (_event, action) => { if (['new','open','save','reload','close','help'].includes(action)) callback(action); };
    ipcRenderer.on('project:action', listener);
    return () => ipcRenderer.removeListener('project:action', listener);
  },
});

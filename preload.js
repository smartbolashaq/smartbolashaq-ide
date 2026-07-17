const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sb', {
  ensureSetup: () => ipcRenderer.invoke('setup:ensure'),
  compile: (code, fqbn) => ipcRenderer.invoke('sketch:compile', { code, fqbn }),
  upload: (code, fqbn, port) => ipcRenderer.invoke('sketch:upload', { code, fqbn, port }),
  listPorts: () => ipcRenderer.invoke('ports:list'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getTemplate: () => ipcRenderer.invoke('template:get'),
  listMaterials: () => ipcRenderer.invoke('materials:list'),
  openMaterial: (file) => ipcRenderer.invoke('materials:open', { file }),
  openMaterialExternal: (file) => ipcRenderer.invoke('materials:openExternal', { file }),
  onCliOutput: (cb) => ipcRenderer.on('cli-output', (_e, text) => cb(text)),
  onSetupProgress: (cb) => ipcRenderer.on('setup-progress', (_e, stage) => cb(stage))
});

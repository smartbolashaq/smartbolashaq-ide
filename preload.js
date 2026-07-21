const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sb', {
  /* Подготовка и настройки */
  ensureSetup: () => ipcRenderer.invoke('setup:ensure'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  appVersion: () => ipcRenderer.invoke('app:version'),

  /* Компиляция и прошивка */
  compile: (code, fqbn) => ipcRenderer.invoke('sketch:compile', { code, fqbn }),
  upload: (code, fqbn, port) => ipcRenderer.invoke('sketch:upload', { code, fqbn, port }),
  listPorts: () => ipcRenderer.invoke('ports:list'),
  getTemplate: () => ipcRenderer.invoke('template:get'),

  /* Монитор порта */
  monitorStart: (port, baud) => ipcRenderer.invoke('monitor:start', { port, baud }),
  monitorSend: (text) => ipcRenderer.invoke('monitor:send', { text }),
  monitorStop: () => ipcRenderer.invoke('monitor:stop'),
  onMonitorData: (cb) => ipcRenderer.on('monitor-data', (_e, t) => cb(t)),
  onMonitorClosed: (cb) => ipcRenderer.on('monitor-closed', () => cb()),

  /* Уроки (PDF из облака) */
  listMaterials: () => ipcRenderer.invoke('materials:list'),
  openMaterial: (file) => ipcRenderer.invoke('materials:open', { file }),

  /* Библиотеки */
  listLibs: () => ipcRenderer.invoke('libs:list'),
  syncLibs: (force) => ipcRenderer.invoke('libs:sync', { force }),
  installLibZip: () => ipcRenderer.invoke('libs:installZip'),
  installLibByName: (name) => ipcRenderer.invoke('libs:installByName', { name }),
  onLibsUpdated: (cb) => ipcRenderer.on('libs-updated', (_e, names) => cb(names)),

  /* Проекты и автосохранение */
  listProjects: () => ipcRenderer.invoke('projects:list'),
  saveProject: (name, code) => ipcRenderer.invoke('projects:save', { name, code }),
  loadProject: (name) => ipcRenderer.invoke('projects:load', { name }),
  deleteProject: (name) => ipcRenderer.invoke('projects:delete', { name }),
  autosaveSet: (key, code) => ipcRenderer.invoke('autosave:set', { key, code }),
  autosaveGet: (key) => ipcRenderer.invoke('autosave:get', { key }),

  /* Обновления */
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  updaterOpenDownloadPage: () => ipcRenderer.invoke('updater:openDownloadPage'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, i) => cb(i)),
  onUpdateAvailableManual: (cb) => ipcRenderer.on('update-available-manual', (_e, i) => cb(i)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),

  /* Служебные события */
  onCliOutput: (cb) => ipcRenderer.on('cli-output', (_e, text) => cb(text)),
  onSetupProgress: (cb) => ipcRenderer.on('setup-progress', (_e, stage) => cb(stage))
});

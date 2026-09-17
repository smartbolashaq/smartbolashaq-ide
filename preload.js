const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sb', {
  /* Настройки */
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  setZoom: (factor) => ipcRenderer.invoke('zoom:set', factor),
  appVersion: () => ipcRenderer.invoke('app:version'),

  /* Уроки (PDF из облака) */
  listMaterials: () => ipcRenderer.invoke('materials:list'),
  openMaterial: (file) => ipcRenderer.invoke('materials:open', { file }),
  getQuiz: (lessonId) => ipcRenderer.invoke('quiz:get', { lessonId }),

  /* Проекты ученика — файлы .py в видимой папке */
  listProjects: () => ipcRenderer.invoke('projects:list'),
  saveProject: (name, code) => ipcRenderer.invoke('projects:save', { name, code }),
  loadProject: (name) => ipcRenderer.invoke('projects:load', { name }),
  deleteProject: (name) => ipcRenderer.invoke('projects:delete', { name }),
  renameProject: (from, to) => ipcRenderer.invoke('projects:rename', { from, to }),
  projectExists: (name) => ipcRenderer.invoke('projects:exists', { name }),
  projectsDir: () => ipcRenderer.invoke('projects:dir'),
  chooseProjectsDir: () => ipcRenderer.invoke('projects:chooseDir'),
  revealProject: (name) => ipcRenderer.invoke('projects:reveal', { name }),
  pyFilesList: () => ipcRenderer.invoke('pyfiles:list'),
  pyFilesApply: (writes, deletes) => ipcRenderer.invoke('pyfiles:apply', { writes, deletes }),
  autosaveSet: (key, code) => ipcRenderer.invoke('autosave:set', { key, code }),
  autosaveGet: (key) => ipcRenderer.invoke('autosave:get', { key }),

  /* «Бортовой компьютер» (Python на машинке) */
  carConnect: (host) => ipcRenderer.invoke('car:connect', { host }),
  carDisconnect: () => ipcRenderer.invoke('car:disconnect'),
  carRun: (code) => ipcRenderer.invoke('car:run', { code }),
  carSave: (code) => ipcRenderer.invoke('car:save', { code }),
  carClear: () => ipcRenderer.invoke('car:clear'),
  carStop: () => ipcRenderer.invoke('car:stop'),
  carHit: () => ipcRenderer.invoke('car:hit'),
  onCarOutput: (cb) => ipcRenderer.on('car-output', (_e, t) => cb(t)),
  onCarState: (cb) => ipcRenderer.on('car-state', (_e, st) => cb(st)),

  /* Обновления */
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download'),
  updaterInstall: () => ipcRenderer.invoke('updater:install'),
  updaterOpenDownloadPage: () => ipcRenderer.invoke('updater:openDownloadPage'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, i) => cb(i)),
  onUpdateAvailableManual: (cb) => ipcRenderer.on('update-available-manual', (_e, i) => cb(i)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb())
});

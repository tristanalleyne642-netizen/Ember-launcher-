'use strict';
/** Preload bridge — the only API the renderer page gets. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ember', {
  listGames: () => ipcRenderer.invoke('games:list'),
  addGame: (name, path, opts) => ipcRenderer.invoke('games:add', { name, path, ...(opts || {}) }),
  removeGame: (index) => ipcRenderer.invoke('games:remove', index),
  toggleFavorite: (index) => ipcRenderer.invoke('games:toggle-favorite', index),
  launchGame: (index) => ipcRenderer.invoke('games:launch', index),
  stopGame: (index) => ipcRenderer.invoke('games:stop', index),
  gamesStatus: () => ipcRenderer.invoke('games:status'),
  listEngines: () => ipcRenderer.invoke('engines:list'),
  installEngine: (id) => ipcRenderer.invoke('engines:install', id),
  onEngineProgress: (cb) =>
    ipcRenderer.on('engines:progress', (_event, progress) => cb(progress)),
});

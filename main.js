'use strict';
/**
 * Ember Launcher — Electron main process (Linux-only).
 *
 * The game library starts EMPTY. Games are added from the UI or by
 * editing games.json; the launcher never downloads games. The Engines
 * tab lists NovaSource and installs it from its release tarball
 * (see lib/engines.js).
 */
const path = require('path');
const { app, BrowserWindow, ipcMain, Menu } = require('electron');

// Needed when running as root (e.g. on this dev VM).
app.commandLine.appendSwitch('no-sandbox');

const { resolveConfigPath, loadGames, saveGames, validateGame, gameInstalled } = require('./lib/store');
const { GameRunner } = require('./lib/launcher');
const { listEngines, installEngine } = require('./lib/engines');

let configPath;
let games = [];
let runner;
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    title: 'Ember Launcher',
    backgroundColor: '#0f1116',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);

  // EMBER_TAB=engines opens straight on the Engines tab (used for
  // screenshots / testing).
  const hash = process.env.EMBER_TAB === 'engines' ? '#engines' : '';
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash });
}

app.whenReady().then(() => {
  const appDir = app.getAppPath();
  configPath = resolveConfigPath(appDir, app.getPath('userData'));
  games = loadGames(configPath);
  runner = new GameRunner();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Games are detached, so closing the launcher never kills a game.
  app.quit();
});

// --- Games IPC ---

// What the renderer sees: each game plus a live `installed` flag
// (true when its executable is actually on disk). The flag is derived
// here and never written into games.json.
function gamesForRenderer() {
  return games.map((g) => ({ ...g, installed: gameInstalled(g.path) }));
}

ipcMain.handle('games:list', () => ({
  games: gamesForRenderer(),
  running: runner ? runner.runningIndices() : [],
  configPath,
}));

ipcMain.handle('games:add', (_event, { name, path: gamePath, cover, collection }) => {
  const error = validateGame(name, gamePath, games);
  if (error) return { ok: false, error };
  const entry = { name: name.trim(), path: gamePath.trim(), addedAt: Date.now() };
  if (cover) entry.cover = cover;
  if (collection && collection.trim()) entry.collection = collection.trim();
  games.push(entry);
  saveGames(configPath, games);
  return { ok: true, games: gamesForRenderer() };
});

ipcMain.handle('games:remove', (_event, index) => {
  if (index < 0 || index >= games.length) return { ok: false, error: 'No such game.' };
  if (runner.isRunning(index)) {
    return { ok: false, error: 'Stop the game before removing it.' };
  }
  const [removed] = games.splice(index, 1);
  runner.shiftAfterRemoval(index);
  saveGames(configPath, games);
  return { ok: true, games: gamesForRenderer(), removed: removed.name };
});

ipcMain.handle('games:toggle-favorite', (_event, index) => {
  if (index < 0 || index >= games.length) return { ok: false, error: 'No such game.' };
  games[index].favorite = !games[index].favorite;
  saveGames(configPath, games);
  return { ok: true, games: gamesForRenderer() };
});

ipcMain.handle('games:launch', async (_event, index) => {
  const game = games[index];
  if (!game) return { ok: false, error: 'No such game.' };
  return runner.launch(index, game);
});

ipcMain.handle('games:stop', (_event, index) => {
  const game = games[index];
  if (!game) return { ok: false, error: 'No such game.' };
  const stopped = runner.stop(index);
  return { ok: stopped, error: stopped ? null : `"${game.name}" is not running.` };
});

ipcMain.handle('games:status', () => ({
  running: runner ? runner.runningIndices() : [],
}));

// --- Engines IPC ---

ipcMain.handle('engines:list', () => listEngines());

ipcMain.handle('engines:install', async (_event, engineId) => {
  // Installs from the bundled NovaSource release tarball, streaming
  // progress back to the renderer so the button can show its stage.
  return installEngine(engineId, (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('engines:progress', progress);
    }
  });
});

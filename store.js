'use strict';
/**
 * Game library store — reads/writes the games.json config file.
 * Plain Node, no Electron dependency, so it can be unit-tested directly.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'games.json';

/**
 * Where the config lives.
 * - If a games.json already exists in `appDir` (dev run from the project
 *   folder) and that dir is writable, use it.
 * - Otherwise use `userDataDir` (the packaged-app location).
 */
function resolveConfigPath(appDir, userDataDir) {
  if (appDir && !appDir.includes('.asar')) {
    const inApp = path.join(appDir, CONFIG_FILE);
    if (fs.existsSync(inApp)) return inApp;
    try {
      fs.accessSync(appDir, fs.constants.W_OK);
      return inApp;
    } catch (_) { /* fall through */ }
  }
  return path.join(userDataDir, CONFIG_FILE);
}

function loadGames(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.games)) return [];
    return data.games.filter(
      (g) => g && typeof g.name === 'string' && typeof g.path === 'string'
    );
  } catch (_) {
    return [];
  }
}

function saveGames(configPath, games) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({ games }, null, 2) + '\n',
    'utf8'
  );
}

/** True when a game's executable is actually on disk (the library's
 * INSTALLED filter). Missing files still load into the library — the
 * card just shows a "Missing file" note. */
function gameInstalled(gamePath) {
  try {
    return fs.statSync(gamePath).isFile();
  } catch (_) {
    return false;
  }
}

/** Validate a new game. Returns an error string, or null if it is fine. */
function validateGame(name, gamePath, existingGames) {  if (!name || !name.trim()) return 'Give the game a name first.';
  if (!gamePath || !gamePath.trim()) return "Enter the path to the game's executable.";
  const p = gamePath.trim();
  let stat;
  try {
    stat = fs.statSync(p);
  } catch (_) {
    return `That file does not exist: ${p}`;
  }
  if (!stat.isFile()) return `That is not a file: ${p}`;
  try {
    fs.accessSync(p, fs.constants.X_OK);
  } catch (_) {
    return `That file is not executable: ${p}`;
  }
  if (existingGames.some((g) => g.name === name.trim())) {
    return `"${name.trim()}" is already in the library.`;
  }
  return null;
}

module.exports = { CONFIG_FILE, resolveConfigPath, loadGames, saveGames, validateGame, gameInstalled };

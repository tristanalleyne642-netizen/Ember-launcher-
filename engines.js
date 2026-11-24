'use strict';
/**
 * Engines catalogue — the "Engines" tab of Ember Launcher.
 *
 * Modelled on how the Epic Games Launcher offers Unreal Engine: engines
 * are listed here and can be downloaded + installed from the launcher.
 *
 * NovaSource v0.2.0 ships as a release tarball
 * (novasource-linux-0.2.0.tar.gz: the engine binary — which runs the
 * Nova Fortress demo — plus README, VERSION and LICENSE). Install works
 * from a local copy of that tarball:
 *   1. a copy bundled with the launcher (engines-release/, packed into
 *      the AppImage), or
 *   2. the NovaSource project's releases/ folder (dev layout), or
 *   3. EMBER_NOVASOURCE_TARBALL pointing at a tarball anywhere.
 *
 * Install extracts the tarball into
 *   ~/.local/share/ember-launcher/engines/novasource-0.2.0/
 * (EMBER_ENGINES_DIR overrides that root) and records nothing else —
 * `listEngines()` detects an install by the binary being there, so a
 * fresh launch still shows it as installed.
 *
 * The library still starts EMPTY: installing the engine does NOT add
 * any game to the library. To play Nova Fortress, add the installed
 * binary as a game from the Games tab.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const ENGINE_VERSION = '0.2.0';
const TARBALL_NAME = `novasource-linux-${ENGINE_VERSION}.tar.gz`;
const EXTRACT_DIR_NAME = `novasource-linux-${ENGINE_VERSION}`;
const BINARY_NAME = 'novasource';

const ENGINES = [
  {
    id: 'novasource',
    name: 'NovaSource',
    version: ENGINE_VERSION,
    tagline: 'A C++ game engine for Linux, built from scratch.',
    description:
      'NovaSource is Tristan\u2019s own game engine (C++, SDL2 + OpenGL, Linux-only), ' +
      'now with real TF2 gameplay inside: Scout / Soldier / Heavy classes, TF2 ' +
      'movement, and Scattergun + Rocket Launcher weapons. Installing it gives ' +
      'you the engine and the playable Nova Fortress demo.',
    // state + installPath are derived live by listEngines():
    // 'not-installed' | 'installed'
    installPath: null,
    firstGame: 'Nova Fortress',
  },
];

function enginesRootDir() {
  if (process.env.EMBER_ENGINES_DIR) return process.env.EMBER_ENGINES_DIR;
  return path.join(os.homedir(), '.local', 'share', 'ember-launcher', 'engines');
}

function installDir() {
  return path.join(enginesRootDir(), `novasource-${ENGINE_VERSION}`);
}

function installedBinaryPath() {
  return path.join(installDir(), EXTRACT_DIR_NAME, BINARY_NAME);
}

function isInstalled() {
  try {
    fs.accessSync(installedBinaryPath(), fs.constants.X_OK);
    return true;
  } catch (_) {
    return false;
  }
}

/** Where the release tarball lives, or null when it cannot be found. */
function findTarball() {
  const candidates = [];
  if (process.env.EMBER_NOVASOURCE_TARBALL) {
    candidates.push(process.env.EMBER_NOVASOURCE_TARBALL);
  }
  // Bundled with the launcher (packed into the AppImage as
  // engines-release/, or sitting next to the source checkout), and
  // the dev-layout NovaSource releases folder. Tests can turn these
  // fallbacks off with EMBER_NO_BUNDLED_TARBALL=1 so a missing
  // tarball is genuinely missing.
  if (!process.env.EMBER_NO_BUNDLED_TARBALL) {
    candidates.push(path.join(__dirname, '..', 'engines-release', TARBALL_NAME));
    if (process.resourcesPath) {
      candidates.push(
        path.join(process.resourcesPath, 'engines-release', TARBALL_NAME)
      );
    }
    // Dev layout: the NovaSource project's releases/ folder.
    candidates.push(
      path.join(__dirname, '..', '..', 'novasource', 'releases', TARBALL_NAME)
    );
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) { /* try the next one */ }
  }
  return null;
}

function listEngines() {
  const installed = isInstalled();
  return ENGINES.map((e) => ({
    ...e,
    state: installed ? 'installed' : 'not-installed',
    installPath: installed ? installedBinaryPath() : null,
  }));
}

/**
 * Download + install an engine (from the local release tarball).
 * Reports progress via onProgress({ done, total, stage }) and resolves
 * with { ok: true, installPath } once installed. Installing twice is
 * harmless — it just reports the existing install.
 */
async function installEngine(engineId, onProgress) {
  const engine = ENGINES.find((e) => e.id === engineId);
  if (!engine) return { ok: false, error: `Unknown engine: ${engineId}` };

  if (isInstalled()) {
    return { ok: true, installPath: installedBinaryPath(), alreadyInstalled: true };
  }

  let tarball = findTarball();
  if (!tarball) {
    return {
      ok: false,
      error:
        `${engine.name} v${ENGINE_VERSION} could not be found to install — ` +
        `the release tarball (${TARBALL_NAME}) is missing.`,
    };
  }

  const dir = installDir();
  fs.mkdirSync(dir, { recursive: true });
  if (typeof onProgress === 'function') {
    onProgress({ done: 0, total: 100, stage: 'extracting' });
  }

  // A tarball packed inside an .asar archive cannot be read by the
  // `tar` command directly, so copy it out to a temp file first.
  let tarballForTar = tarball;
  let tmpCopy = null;
  if (tarball.includes('.asar')) {
    tmpCopy = path.join(os.tmpdir(), TARBALL_NAME);
    fs.copyFileSync(tarball, tmpCopy);
    tarballForTar = tmpCopy;
  }

  try {
    await execFileAsync('tar', ['-xzf', tarballForTar, '-C', dir]);
  } catch (err) {
    return { ok: false, error: `Could not extract ${TARBALL_NAME}: ${err.message}` };
  } finally {
    if (tmpCopy) {
      try { fs.unlinkSync(tmpCopy); } catch (_) { /* already gone */ }
    }
  }

  const binary = installedBinaryPath();
  try {
    fs.accessSync(binary, fs.constants.F_OK);
  } catch (_) {
    return {
      ok: false,
      error: `Install finished but the engine binary was not found at ${binary}.`,
    };
  }
  fs.chmodSync(binary, 0o755);
  if (typeof onProgress === 'function') {
    onProgress({ done: 100, total: 100, stage: 'done' });
  }
  return { ok: true, installPath: binary };
}

module.exports = { listEngines, installEngine, ENGINE_VERSION, TARBALL_NAME };

'use strict';
/* Headless tests for lib/store.js and lib/launcher.js.
 * Run: npm test
 * No Electron needed — these modules are plain Node. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadGames, saveGames, validateGame, resolveConfigPath, gameInstalled } = require('../lib/store');
const { GameRunner } = require('../lib/launcher');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-test-'));
const configPath = path.join(tmp, 'games.json');

async function main() {
  // 1. Empty config loads as an empty library.
  assert.deepEqual(loadGames(configPath), []);
  console.log('ok - empty config loads as empty library');

  // 2. resolveConfigPath prefers an existing games.json in the app dir.
  fs.writeFileSync(configPath, '{"games":[]}');
  assert.equal(resolveConfigPath(tmp, '/nonexistent-user-data'), configPath);
  console.log('ok - config path resolves to project games.json');

  // 3. Validation rejects bad input.
  let games = [];
  assert.match(validateGame('', '/bin/sleep', games), /name/i);
  assert.match(validateGame('X', '/does/not/exist', games), /does not exist/);
  assert.match(validateGame('X', tmp, games), /not a file/);
  assert.match(validateGame('X', path.join(tmp, 'games.json'), games), /not executable/);
  assert.equal(validateGame('Sleeper', '/bin/sleep', games), null);
  console.log('ok - validation rejects bad games, accepts a real executable');

  // 4. Save + reload round-trips, including optional cover /
  // collection / favorite / addedAt fields (the library UI's data).
  games = [
    { name: 'Sleeper', path: '/bin/sleep' },
    { name: 'Nova Fortress', path: '/bin/sleep', cover: 'covers/nova-fortress.svg', collection: 'Arcade', favorite: true, addedAt: 1795490000000 },
  ];
  saveGames(configPath, games);
  assert.deepEqual(loadGames(configPath), games);
  console.log('ok - games.json save/load round-trip (incl. cover/collection/favorite)');

  // 4b. gameInstalled: a real file is installed, a missing one is not.
  assert.equal(gameInstalled('/bin/sleep'), true);
  assert.equal(gameInstalled('/does/not/exist'), false);
  assert.equal(gameInstalled(tmp), false); // a directory is not a game
  console.log('ok - gameInstalled flags real files, missing files and dirs');

  // 5. Duplicate names are rejected.
  games = [{ name: 'Sleeper', path: '/bin/sleep' }];
  assert.match(validateGame('Sleeper', '/bin/sleep', games), /already in the library/);
  console.log('ok - duplicate names rejected');

  // 6. Wrapper script that sleeps: launch -> running -> stop -> not running.
  const script = path.join(tmp, 'sleeper.sh');
  fs.writeFileSync(script, '#!/bin/sh\nsleep 60\n');
  fs.chmodSync(script, 0o755);
  assert.equal(validateGame('Wrapper', script, games), null);
  const runner = new GameRunner();
  const launched = await runner.launch(1, { name: 'Wrapper', path: script });
  assert.equal(launched.ok, true, 'launch should succeed: ' + JSON.stringify(launched));
  assert.equal(runner.isRunning(1), true);
  assert.deepEqual(runner.runningIndices(), [1]);
  console.log('ok - game launches detached and shows as running');

  assert.equal(runner.stop(1), true);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(runner.isRunning(1), false);
  console.log('ok - stop ends the game and clears running status');

  // 7. Removing a game above a running one shifts the running indices
  // down, so the Running badge stays on the right card.
  const script2 = path.join(tmp, 'sleeper2.sh');
  fs.writeFileSync(script2, '#!/bin/sh\nsleep 60\n');
  fs.chmodSync(script2, 0o755);
  const runner2 = new GameRunner();
  await runner2.launch(1, { name: 'A', path: script });
  await runner2.launch(2, { name: 'B', path: script2 });
  assert.deepEqual(runner2.runningIndices(), [1, 2]);
  runner2.shiftAfterRemoval(0); // library removed the game at index 0
  assert.deepEqual(runner2.runningIndices(), [0, 1]);
  assert.equal(runner2.isRunning(0), true);
  assert.equal(runner2.isRunning(2), false);
  runner2.stop(0);
  runner2.stop(1);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(runner2.runningIndices(), []);
  console.log('ok - running indices shift when a game above is removed');

  // 8. Launching a missing executable fails gracefully.
  const bad = await runner.launch(2, { name: 'Ghost', path: '/bin/does-not-exist' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Could not start/);
  console.log('ok - launch failure returns an error instead of crashing');

  // 9. Engines catalogue lists NovaSource v0.2.0 as downloadable, and
  // installing it from a release tarball actually works.
  // Point the install at a scratch dir so the test never touches the
  // real ~/.local/share install, and build a fixture tarball in tmp
  // (same layout as the real release: novasource-linux-0.2.0/ with a
  // binary inside) so the test does not depend on the real tarball.
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const execFileAsync = promisify(execFile);
  const enginesDir = path.join(tmp, 'engines');
  process.env.EMBER_ENGINES_DIR = enginesDir;
  const fixtureRoot = path.join(tmp, 'fixture');
  const fixtureDir = path.join(fixtureRoot, 'novasource-linux-0.2.0');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixtureBinary = path.join(fixtureDir, 'novasource');
  fs.writeFileSync(fixtureBinary, '#!/bin/sh\necho fixture-engine\n');
  fs.chmodSync(fixtureBinary, 0o755);
  fs.writeFileSync(path.join(fixtureDir, 'VERSION'), '0.2.0\n');
  const fixtureTarball = path.join(tmp, 'novasource-linux-0.2.0.tar.gz');
  await execFileAsync('tar', ['-czf', fixtureTarball, '-C', fixtureRoot, 'novasource-linux-0.2.0']);
  process.env.EMBER_NOVASOURCE_TARBALL = fixtureTarball;
  const { listEngines, installEngine } = require('../lib/engines');
  let engines = listEngines();
  assert.equal(engines.length, 1);
  assert.equal(engines[0].id, 'novasource');
  assert.equal(engines[0].version, '0.2.0');
  assert.equal(engines[0].state, 'not-installed');
  assert.equal(engines[0].installPath, null);
  const inst = await installEngine('novasource');
  assert.equal(inst.ok, true, 'install should succeed: ' + JSON.stringify(inst));
  assert.match(inst.installPath, /novasource$/);
  assert.equal(fs.existsSync(inst.installPath), true);
  fs.accessSync(inst.installPath, fs.constants.X_OK);
  engines = listEngines();
  assert.equal(engines[0].state, 'installed');
  assert.equal(engines[0].installPath, inst.installPath);
  console.log('ok - NovaSource v0.2.0 installs from its tarball and lists as installed');

  // 10. Installing again is harmless and reports the existing install.
  const again = await installEngine('novasource');
  assert.equal(again.ok, true);
  assert.equal(again.alreadyInstalled, true);
  assert.equal(again.installPath, inst.installPath);
  console.log('ok - re-install reports the existing install');

  // 11. Unknown engine, and a missing tarball, fail gracefully.
  const unknown = await installEngine('no-such-engine');
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown engine/);
  process.env.EMBER_NOVASOURCE_TARBALL = path.join(tmp, 'does-not-exist.tar.gz');
  // Turn off the bundled/dev tarball fallbacks too, or findTarball()
  // would find the real engines-release/ copy and the install would
  // succeed.
  process.env.EMBER_NO_BUNDLED_TARBALL = '1';
  // (install dir already has it installed, so clear that first)
  fs.rmSync(enginesDir, { recursive: true, force: true });
  const missing = await installEngine('novasource');
  assert.equal(missing.ok, false);
  assert.match(missing.error, /could not be found/i);
  console.log('ok - unknown engine and missing tarball fail gracefully');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nAll tests passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

'use strict';
/* Ember Launcher — renderer. Talks to the main process only through
   window.ember (see preload.js).
   Library view: Steam Deck / Epic style portrait cover grid with filter
   tabs (All / Installed / Favorites / Collections), search, sort and a
   status filter. Games with no cover art get a styled placeholder card
   (fox mark + bold title); Nova Fortress gets its bundled original cover. */

let games = [];
let running = new Set();
let configPath = '';
let currentTab = 'games';
let filterTab = 'all';
let searchQuery = '';
let sortMode = 'name';
let statusFilter = 'all';

const $ = (id) => document.getElementById(id);

/* The bundled original cover for Nova Fortress (added from the Engines
   tab). Any other game uses its own `cover` field when one is set. */
const NOVA_FORTRESS_COVER = 'covers/nova-fortress.svg';

function showMessage(text, isError) {
  const el = $('games-message');
  el.textContent = text;
  el.className = 'message ' + (isError ? 'error' : 'ok');
}

function showEnginesMessage(text, isError) {
  const el = $('engines-message');
  el.textContent = text;
  el.className = 'message ' + (isError ? 'error' : 'ok');
}

/* ---------------- tabs ---------------- */

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === 'panel-' + tab);
  });
}

document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

/* ---------------- library filters / search / sort ---------------- */

function collectionNames() {
  return [...new Set(
    games.filter((g) => g.collection && g.collection.trim())
      .map((g) => g.collection.trim())
  )].sort((a, b) => a.localeCompare(b));
}

function updateCounts() {
  $('count-all').textContent = games.length;
  $('count-installed').textContent = games.filter((g) => g.installed).length;
  $('count-favorites').textContent = games.filter((g) => g.favorite).length;
  $('count-collections').textContent = collectionNames().length;
}

function sortGames(list) {
  const copy = [...list];
  if (sortMode === 'recent') {
    // games.json is append-ordered; addedAt (when present) is newest first.
    copy.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } else {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy;
}

function applyFilters(list) {
  let out = list;
  if (filterTab === 'installed') out = out.filter((g) => g.installed);
  if (filterTab === 'favorites') out = out.filter((g) => g.favorite);
  if (filterTab === 'collections') {
    out = out.filter((g) => g.collection && g.collection.trim());
  }
  if (searchQuery) {
    out = out.filter((g) => g.name.toLowerCase().includes(searchQuery));
  }
  if (statusFilter === 'running') out = out.filter((g) => running.has(games.indexOf(g)));
  if (statusFilter === 'not-running') out = out.filter((g) => !running.has(games.indexOf(g)));
  return out;
}

document.querySelectorAll('.filter-tab').forEach((b) => {
  b.addEventListener('click', () => {
    filterTab = b.dataset.filter;
    document.querySelectorAll('.filter-tab').forEach((t) => {
      t.classList.toggle('active', t === b);
    });
    renderGames();
  });
});

$('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderGames();
});

$('sort-select').addEventListener('change', (e) => {
  sortMode = e.target.value;
  renderGames();
});

$('status-filter').addEventListener('change', (e) => {
  statusFilter = e.target.value;
  renderGames();
});

/* ---------------- covers ---------------- */

/** Resolve a game's cover art, or null when it has none (placeholder). */
function coverSrc(game) {
  const raw = game.cover || (game.name === 'Nova Fortress' ? NOVA_FORTRESS_COVER : null);
  if (!raw) return null;
  try {
    return new URL(raw, window.location.href).href;
  } catch (_) {
    return null;
  }
}

function makePlaceholderCover(game) {
  const holder = document.createElement('div');
  holder.className = 'cover-placeholder';
  const fox = document.createElement('img');
  fox.className = 'cover-fox';
  fox.src = 'fox.svg';
  fox.alt = '';
  const title = document.createElement('span');
  title.className = 'cover-title';
  title.textContent = game.name;
  const tag = document.createElement('span');
  tag.className = 'cover-tag';
  tag.textContent = 'EMBER LAUNCHER';
  holder.appendChild(fox);
  holder.appendChild(title);
  holder.appendChild(tag);
  return holder;
}

/* ---------------- games grid ---------------- */

function emptyState(title, detail) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const fox = document.createElement('img');
  fox.className = 'empty-fox';
  fox.src = 'fox.svg';
  fox.alt = '';
  const t = document.createElement('p');
  t.className = 'empty-title';
  t.textContent = title;
  empty.appendChild(fox);
  empty.appendChild(t);
  if (detail) {
    const d = document.createElement('p');
    d.textContent = detail;
    empty.appendChild(d);
  }
  return empty;
}

function makeGameCard(game, index) {
  const isRunning = running.has(index);

  const card = document.createElement('div');
  card.className = 'game-card';

  const cover = document.createElement('div');
  cover.className = 'cover';
  cover.title = isRunning ? game.name : `Play ${game.name}`;
  cover.tabIndex = 0;
  const playGame = async () => {
    if (running.has(index)) return;
    const res = await window.ember.launchGame(index);
    showMessage(
      res.ok ? `Started "${game.name}".` : (res.error || 'Could not start the game.'),
      !res.ok
    );
    await refreshStatus();
  };
  cover.addEventListener('click', playGame);
  cover.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') playGame();
  });

  const src = coverSrc(game);
  if (src) {
    const img = document.createElement('img');
    img.className = 'cover-art';
    img.src = src;
    img.alt = `${game.name} cover art`;
    img.addEventListener('error', () => {
      img.replaceWith(makePlaceholderCover(game));
    });
    cover.appendChild(img);
  } else {
    cover.appendChild(makePlaceholderCover(game));
  }

  if (isRunning) {
    const badge = document.createElement('span');
    badge.className = 'badge running';
    badge.textContent = '● Running';
    cover.appendChild(badge);
  }

  const fav = document.createElement('button');
  fav.className = 'fav-btn' + (game.favorite ? ' faved' : '');
  fav.textContent = game.favorite ? '★' : '☆';
  fav.title = game.favorite ? 'Remove from favorites' : 'Add to favorites';
  fav.setAttribute('aria-label', fav.title);
  fav.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await window.ember.toggleFavorite(index);
    if (res.ok) {
      games = res.games;
      renderGames();
    } else {
      showMessage(res.error, true);
    }
  });
  cover.appendChild(fav);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  if (isRunning) {
    const stop = document.createElement('button');
    stop.className = 'btn danger';
    stop.textContent = '■ Stop';
    stop.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await window.ember.stopGame(index);
      showMessage(
        res.ok ? `Stopped "${game.name}".` : res.error,
        !res.ok
      );
      await refreshStatus();
    });
    actions.appendChild(stop);
  } else {
    const play = document.createElement('button');
    play.className = 'btn primary';
    play.textContent = '▶ Play';
    play.addEventListener('click', async (e) => {
      e.stopPropagation();
      await playGame();
    });
    actions.appendChild(play);
  }

  const remove = document.createElement('button');
  remove.className = 'btn icon';
  remove.textContent = '✕';
  remove.title = `Remove ${game.name}`;
  remove.setAttribute('aria-label', remove.title);
  remove.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (running.has(index)) {
      showMessage('Stop the game before removing it.', true);
      return;
    }
    const res = await window.ember.removeGame(index);
    if (res.ok) {
      games = res.games;
      showMessage(`Removed "${res.removed}".`, false);
      updateFooter();
      renderGames();
    } else {
      showMessage(res.error, true);
    }
  });
  actions.appendChild(remove);

  cover.appendChild(actions);
  card.appendChild(cover);

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = game.name;
  card.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'card-sub';
  if (!game.installed) {
    sub.classList.add('missing');
    sub.textContent = 'Missing file — check the path';
  } else if (game.collection) {
    sub.textContent = '▦ ' + game.collection;
  }
  card.appendChild(sub);

  return card;
}

function renderGames() {
  const list = $('games-list');
  list.innerHTML = '';
  updateCounts();

  if (games.length === 0) {
    list.appendChild(emptyState(
      'No games yet — add one to get started',
      'Use the form below, or edit games.json.'
    ));
    return;
  }

  const visible = applyFilters(games);
  if (visible.length === 0) {
    let title = 'No games match this filter.';
    if (searchQuery) title = `No games match "${searchQuery}".`;
    else if (filterTab === 'favorites') title = 'No favorites yet — tap the ★ on a game to favorite it.';
    else if (filterTab === 'collections') title = 'No collections yet — add a collection name when you add a game.';
    else if (filterTab === 'installed') title = 'No installed games found — check the executable paths.';
    else if (statusFilter === 'running') title = 'No games are running right now.';
    list.appendChild(emptyState(title, ''));
    return;
  }

  if (filterTab === 'collections') {
    // Group the visible games under their collection headings.
    collectionNames().forEach((name) => {
      const inCollection = sortGames(
        visible.filter((g) => g.collection && g.collection.trim() === name)
      );
      if (inCollection.length === 0) return;
      const heading = document.createElement('h3');
      heading.className = 'collection-heading';
      heading.textContent = '▦ ' + name + ' ';
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `(${inCollection.length})`;
      heading.appendChild(count);
      list.appendChild(heading);
      inCollection.forEach((game) => {
        list.appendChild(makeGameCard(game, games.indexOf(game)));
      });
    });
    return;
  }

  sortGames(visible).forEach((game) => {
    list.appendChild(makeGameCard(game, games.indexOf(game)));
  });
}

async function refreshStatus() {
  const res = await window.ember.gamesStatus();
  const next = new Set(res.running);
  const changed =
    next.size !== running.size ||
    [...next].some((i) => !running.has(i));
  running = next;
  if (changed) renderGames();
}

function updateFooter() {
  $('config-path').textContent =
    `Config: ${configPath}  •  ${games.length} game(s)`;
}

async function loadGames() {
  const res = await window.ember.listGames();
  games = res.games;
  running = new Set(res.running);
  configPath = res.configPath;
  updateFooter();
  renderGames();
}

$('add-game-btn').addEventListener('click', async () => {
  const name = $('new-name').value;
  const path = $('new-path').value;
  const collection = $('new-collection').value.trim();
  const res = await window.ember.addGame(
    name, path, collection ? { collection } : undefined
  );
  if (res.ok) {
    games = res.games;
    $('new-name').value = '';
    $('new-path').value = '';
    $('new-collection').value = '';
    showMessage(`Added "${name.trim()}" to the library.`, false);
    updateFooter();
    renderGames();
  } else {
    showMessage(res.error, true);
  }
});

// Enter in any field adds the game.
[$('new-name'), $('new-path'), $('new-collection')].forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('add-game-btn').click();
  });
});

/* ---------------- engines ---------------- */

function renderEngines(engines) {
  const list = $('engines-list');
  list.innerHTML = '';

  engines.forEach((engine) => {
    const card = document.createElement('div');
    card.className = 'engine-card';

    const info = document.createElement('div');
    info.className = 'engine-info';

    const nameRow = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'engine-name';
    name.textContent = engine.name;
    nameRow.appendChild(name);
    if (engine.version) {
      const ver = document.createElement('span');
      ver.className = 'badge version';
      ver.textContent = 'v' + engine.version;
      ver.style.marginLeft = '8px';
      nameRow.appendChild(ver);
    }
    info.appendChild(nameRow);

    const desc = document.createElement('div');
    desc.className = 'engine-desc';
    desc.textContent = engine.description;
    info.appendChild(desc);

    const meta = document.createElement('div');
    meta.className = 'engine-meta';
    meta.textContent =
      `Platform: Linux-only` +
      (engine.firstGame ? `  •  First game built on it: ${engine.firstGame}` : '') +
      (engine.installPath ? `  •  Installed at: ${engine.installPath}` : '');
    info.appendChild(meta);

    card.appendChild(info);

    if (engine.state === 'coming-soon') {
      const badge = document.createElement('span');
      badge.className = 'badge coming-soon';
      badge.textContent = 'Coming soon';
      card.appendChild(badge);

      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = '⬇ Download';
      btn.disabled = true;
      btn.title = 'Not ready to download yet';
      card.appendChild(btn);
    } else if (engine.state === 'installed') {
      const badge = document.createElement('span');
      badge.className = 'badge running';
      badge.textContent = 'Installed';
      card.appendChild(badge);

      // The installed engine binary IS the Nova Fortress demo game —
      // offer to add it to the library so it can be played from the
      // Games tab. (The library itself still starts empty.)
      if (engine.installPath && engine.firstGame) {
        const addBtn = document.createElement('button');
        addBtn.className = 'btn primary';
        addBtn.textContent = `＋ Add ${engine.firstGame} to library`;
        addBtn.addEventListener('click', async () => {
          const res = await window.ember.addGame(
            engine.firstGame,
            engine.installPath,
            { cover: NOVA_FORTRESS_COVER }
          );
          if (res.ok) {
            games = res.games;
            showEnginesMessage(
              `"${engine.firstGame}" added to your library — find it on the Games tab.`,
              false
            );
            updateFooter();
            renderGames();
            switchTab('games');
          } else {
            showEnginesMessage(res.error, true);
          }
        });
        card.appendChild(addBtn);
      }
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn primary';
      btn.textContent = '⬇ Download';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '⬇ Installing…';
        installingBtn = btn;
        const res = await window.ember.installEngine(engine.id);
        installingBtn = null;
        showEnginesMessage(
          res.ok
            ? res.alreadyInstalled
              ? `${engine.name} is already installed.`
              : `${engine.name} installed at ${res.installPath}.`
            : res.error,
          !res.ok
        );
        await loadEngines();
      });
      card.appendChild(btn);
    }

    list.appendChild(card);
  });
}

/* The Download button currently running an install, if any — the
   progress events from the main process update its label live. */
let installingBtn = null;

if (window.ember.onEngineProgress) {
  window.ember.onEngineProgress((progress) => {
    if (!installingBtn) return;
    if (progress.stage === 'extracting') {
      installingBtn.textContent = '⬇ Extracting…';
    } else if (progress.stage === 'done') {
      installingBtn.textContent = '⬇ Installed';
    }
  });
}

async function loadEngines() {
  const engines = await window.ember.listEngines();
  renderEngines(engines);
}

/* ---------------- init ---------------- */

(async () => {
  // Open on the Engines tab when the URL hash says so
  // (EMBER_TAB=engines in the main process).
  if (window.location.hash === '#engines') switchTab('engines');
  await loadGames();
  await loadEngines();
  setInterval(refreshStatus, 1000);
})();

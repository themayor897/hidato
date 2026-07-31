(function () {
  "use strict";

  const els = {
    home: document.getElementById("btn-home"),
    settingsBtn: document.getElementById("btn-settings"),
    settingsOverlay: document.getElementById("settings-overlay"),
    settingsClose: document.getElementById("settings-close"),
    settingsHowto: document.getElementById("settings-howto"),
    settingsUpdate: document.getElementById("settings-update"),
    settingsUpdateLabel: document.getElementById("settings-update-label"),
    darkModeToggle: document.getElementById("dark-mode-toggle"),
    infoOverlay: document.getElementById("info-overlay"),
    infoClose: document.getElementById("info-close"),
    title: document.getElementById("app-title"),
    viewList: document.getElementById("view-list"),
    viewPlay: document.getElementById("view-play"),
    groups: document.getElementById("difficulty-groups"),
    board: document.getElementById("board"),
    boardWrap: document.getElementById("board-wrap"),
    svg: document.getElementById("trace-svg"),
    timer: document.getElementById("timer"),
    hint: document.getElementById("btn-hint"),
    restart: document.getElementById("btn-restart"),
    dirUp: document.getElementById("btn-dir-up"),
    dirDown: document.getElementById("btn-dir-down"),
    erase: document.getElementById("btn-erase"),
    banner: document.getElementById("status-banner"),
    numpadOverlay: document.getElementById("numpad-overlay"),
    numpadGrid: document.getElementById("numpad-grid"),
    numpadLabel: document.getElementById("numpad-label"),
    numpadClose: document.getElementById("numpad-close"),
    numpadErase: document.getElementById("numpad-erase"),
    newPuzzle: document.getElementById("btn-new"),
  };

  const DIFF_ORDER = ["Easy", "Normal", "Hard", "Very Hard", "Ultra"];

  let current = null;      // current puzzle object
  let filled = new Map();  // "r,c" -> value (givens + player fills)
  let blockedSet = new Set();
  let givenSet = new Set();
  let cellEls = new Map(); // "r,c" -> element
  let cellSize = 0;
  let N = 0;
  let timerHandle = null;
  let elapsed = 0;
  let solved = false;
  let activeNumpadCell = null;
  let eraseMode = false;
  let dragDirection = "up"; // "up" fills head+1 when dragging, "down" fills head-1

  let drag = {
    active: false,
    moved: false,
    startKey: null,
    headKey: null,
    headValue: null,
    path: [],         // every head position visited this gesture, path[0] = start
    newlyFilled: null, // Set of keys created (not bridged) during this gesture
    lastKey: null,
    lastPointerLocal: null, // raw pointer position in board-local px, for the live trace tip
  };

  const SQRT3 = Math.sqrt(3);

  function key(col, row) { return col + "," + row; }
  function parseKey(k) { const [col, row] = k.split(",").map(Number); return { col, row }; }

  function activeKey(diff) { return "hidato_active_" + diff; }
  function bestKey(diff) { return "hidato_best_" + diff; }

  function loadActive(diff) {
    try {
      const raw = localStorage.getItem(activeKey(diff));
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Ignore saves from an older puzzle format -- they're not resumable
      // as-is (different coordinate system / board shape).
      if (!data || !data.puzzle || data.puzzle.format !== HidatoGen.FORMAT) return null;
      return data;
    } catch (e) { return null; }
  }

  function clearActive(diff) {
    try { localStorage.removeItem(activeKey(diff)); } catch (e) {}
  }

  function saveActive() {
    if (!current || solved) return;
    const data = {
      puzzle: current,
      filled: Array.from(filled.entries()).filter(([k]) => !givenSet.has(k)),
      elapsed,
    };
    try { localStorage.setItem(activeKey(current.difficulty), JSON.stringify(data)); } catch (e) {}
  }

  function loadBest(diff) {
    try {
      const raw = localStorage.getItem(bestKey(diff));
      return raw ? Number(raw) : null;
    } catch (e) { return null; }
  }

  function saveBest(diff, time) {
    const prev = loadBest(diff);
    const best = prev ? Math.min(prev, time) : time;
    try { localStorage.setItem(bestKey(diff), String(best)); } catch (e) {}
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  // ---------- List view ----------

  function renderList() {
    els.title.textContent = "Hidato";
    els.home.hidden = true;
    els.viewPlay.hidden = true;
    els.viewList.hidden = false;
    stopTimer();

    els.groups.innerHTML = "";
    const group = document.createElement("div");
    group.className = "diff-group";
    const grid = document.createElement("div");
    grid.className = "puzzle-grid";

    DIFF_ORDER.forEach((diff) => {
      const meta = HidatoGen.DIFFS[diff];
      const active = loadActive(diff);
      const best = loadBest(diff);
      const tile = document.createElement("button");
      tile.className = "puzzle-tile";
      tile.innerHTML =
        '<div class="tile-id">' + diff + "</div>" +
        '<div class="tile-size">' + meta.cells + " cells</div>" +
        '<div class="tile-meta">' +
        (active ? "In progress &middot; " + fmtTime(active.elapsed || 0) : "Tap for a new puzzle") +
        (best ? " &middot; best " + fmtTime(best) : "") +
        "</div>";
      tile.addEventListener("click", () => {
        if (active) {
          openPuzzle(active.puzzle, active);
        } else {
          generateAndOpen(diff, tile);
        }
      });
      grid.appendChild(tile);
    });
    group.appendChild(grid);
    els.groups.appendChild(group);
  }

  function generateAndOpen(diff, tileEl) {
    if (tileEl) {
      tileEl.disabled = true;
      tileEl.innerHTML =
        '<div class="tile-id">' + diff + "</div>" +
        '<div class="tile-size">Generating&hellip;</div>';
    }
    // Yield a frame so the "Generating..." state paints before the
    // (synchronous) puzzle search runs.
    setTimeout(() => {
      const puzzle = HidatoGen.generate(diff);
      openPuzzle(puzzle, null);
    }, 20);
  }

  // ---------- Play view ----------

  function openPuzzle(p, resumeData) {
    current = p;
    N = p.n_cells;
    blockedSet = new Set(p.blocked.map((b) => key(b.col, b.row)));
    givenSet = new Set(p.givens.map((g) => key(g.col, g.row)));
    filled = new Map();
    p.givens.forEach((g) => filled.set(key(g.col, g.row), g.v));

    elapsed = 0;
    solved = false;
    if (resumeData) {
      elapsed = resumeData.elapsed || 0;
      (resumeData.filled || []).forEach(([k, v]) => filled.set(k, v));
    }
    setEraseMode(false);
    setDragDirection("up");

    els.title.textContent = current.difficulty;
    els.home.hidden = false;
    els.viewList.hidden = true;
    els.viewPlay.hidden = false;
    els.banner.hidden = true;

    buildBoard();
    renderBoard();
    startTimer();
  }

  // Pixel center of a hex cell in board-local coordinates (pointy-top,
  // odd rows shifted right by half a hex-width). hexOffsetX/Y shift the
  // whole board so the top-left-most hex starts flush at (0,0);
  // buildBoard sets them each time the board is (re)built, before this is
  // used for cell placement.
  let hexOffsetX = 0, hexOffsetY = 0;
  function hexCenter(col, row) {
    return {
      x: cellSize * SQRT3 * (col + 0.5 * (row % 2)) - hexOffsetX,
      y: cellSize * 1.5 * row - hexOffsetY,
    };
  }

  // Same axial-neighbor logic generator.js uses, kept in sync here so
  // isAdjacent agrees with what the generator considers adjacent.
  function offsetToAxial(col, row) { return { q: col - Math.floor(row / 2), r: row }; }

  function isAdjacent(k1, k2) {
    if (k1 === k2) return false;
    const a = parseKey(k1), b = parseKey(k2);
    const aAxial = offsetToAxial(a.col, a.row), bAxial = offsetToAxial(b.col, b.row);
    const dq = aAxial.q - bAxial.q, dr = aAxial.r - bAxial.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 === 1;
  }

  function buildBoard() {
    els.board.innerHTML = "";
    cellEls = new Map();
    const cols = current.cols, rows = current.rows;

    // Size purely off available width so cell size stays constant across
    // every difficulty (cols is fixed for all of them) -- taller boards
    // simply extend the board (and page) downward instead of shrinking
    // cells to fit one screen's height. The widest row spans cols+0.5
    // hex-widths (the extra half from the odd-row horizontal offset).
    const wrapWidth = Math.min(window.innerWidth - 32, 520);
    cellSize = Math.floor(wrapWidth / ((cols + 0.5) * SQRT3));
    cellSize = Math.max(cellSize, 14);

    const hexW = SQRT3 * cellSize;
    const hexH = 2 * cellSize;
    // Render each hex slightly smaller than its full tessellating size so a
    // gap (revealing the board's background) shows between every pair of
    // neighboring cells -- a border-like separator that doesn't depend on
    // how `border` happens to render against a clip-path hexagon.
    const renderW = hexW * 0.94;
    const renderH = hexH * 0.94;

    // First pass (offset still 0): find the raw bounding box of every cell
    // center in the full cols x rows board, blocked or not.
    hexOffsetX = 0;
    hexOffsetY = 0;
    const keys = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        keys.push(key(col, row));
        const { x, y } = hexCenter(col, row);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    hexOffsetX = minX - hexW / 2;
    hexOffsetY = minY - hexH / 2;

    const boardWidth = (maxX - minX) + hexW;
    const boardHeight = (maxY - minY) + hexH;

    els.board.style.width = boardWidth + "px";
    els.board.style.height = boardHeight + "px";
    els.boardWrap.style.width = boardWidth + "px";
    els.boardWrap.style.height = boardHeight + "px";
    els.svg.setAttribute("width", boardWidth);
    els.svg.setAttribute("height", boardHeight);
    els.svg.setAttribute("viewBox", "0 0 " + boardWidth + " " + boardHeight);

    keys.forEach((k) => {
      if (blockedSet.has(k)) return; // no DOM element at all for holes
      const { col, row } = parseKey(k);
      const { x, y } = hexCenter(col, row);
      const div = document.createElement("div");
      div.className = "cell";
      div.style.width = renderW + "px";
      div.style.height = renderH + "px";
      div.style.left = (x - renderW / 2) + "px";
      div.style.top = (y - renderH / 2) + "px";
      div.style.fontSize = Math.max(10, Math.floor(hexW * 0.4)) + "px";
      div.dataset.key = k;
      div.addEventListener("pointerdown", onPointerDown);
      els.board.appendChild(div);
      cellEls.set(k, div);
    });

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  // ---------- Rendering / validation ----------

  function renderBoard() {
    const errorCells = computeErrors();
    cellEls.forEach((div, k) => {
      const v = filled.get(k);
      div.textContent = v ? v : "";
      div.classList.toggle("given", givenSet.has(k));
      div.classList.toggle("filled", !!v && !givenSet.has(k));
      div.classList.toggle("error", errorCells.has(k));
      div.classList.toggle("endpoint", v === 1 || v === N);
      div.classList.toggle("selected", drag.headKey === k && drag.active);
    });
    drawTrace(errorCells);
  }

  function computeErrors() {
    const errors = new Set();
    const valueToCells = new Map();
    filled.forEach((v, k) => {
      if (!valueToCells.has(v)) valueToCells.set(v, []);
      valueToCells.get(v).push(k);
    });
    valueToCells.forEach((cells, v) => {
      if (cells.length > 1) cells.forEach((k) => errors.add(k));
    });
    filled.forEach((v, k) => {
      const nextCells = valueToCells.get(v + 1);
      if (nextCells && nextCells.length === 1) {
        if (!isAdjacent(k, nextCells[0])) {
          errors.add(k);
          errors.add(nextCells[0]);
        }
      }
    });
    return errors;
  }

  function drawTrace(errorCells) {
    els.svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    let run = [];
    const runs = [];
    for (let v = 1; v <= N; v++) {
      const cellsAtV = [];
      filled.forEach((val, k) => { if (val === v) cellsAtV.push(k); });
      if (cellsAtV.length !== 1) { if (run.length) runs.push(run); run = []; continue; }
      const k = cellsAtV[0];
      if (errorCells.has(k)) { if (run.length) runs.push(run); run = []; continue; }
      if (run.length && !isAdjacent(run[run.length - 1], k)) { runs.push(run); run = []; }
      run.push(k);
    }
    if (run.length) runs.push(run);

    runs.forEach((run) => {
      if (run.length < 2) return;
      const pts = run.map((k) => {
        const { col, row } = parseKey(k);
        const { x, y } = hexCenter(col, row);
        return x + "," + y;
      }).join(" ");
      const poly = document.createElementNS(ns, "polyline");
      poly.setAttribute("points", pts);
      poly.setAttribute("fill", "none");
      poly.style.stroke = "var(--amber)";
      poly.setAttribute("stroke-width", Math.max(2, cellSize * 0.06));
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("opacity", "0.55");
      els.svg.appendChild(poly);
    });

    renderLiveTrace();
  }

  function toLocalPoint(clientX, clientY) {
    const rect = els.boardWrap.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Live line for the in-progress drag gesture: starts at the center of the
  // cell the drag began on and follows the raw pointer position (not
  // snapped to a cell) through the centers of every cell filled so far.
  // Separate from drawTrace's persisted per-number trace so it can be
  // updated on every pointermove without recomputing errors/board state.
  function renderLiveTrace() {
    const existing = els.svg.querySelector("#live-trace-line");
    if (existing) existing.remove();

    if (!drag.active || drag.headKey === null || !drag.lastPointerLocal) return;

    const ns = "http://www.w3.org/2000/svg";
    const points = drag.path.map((k) => {
      const { col, row } = parseKey(k);
      const { x, y } = hexCenter(col, row);
      return x + "," + y;
    });
    points.push(drag.lastPointerLocal.x + "," + drag.lastPointerLocal.y);

    const poly = document.createElementNS(ns, "polyline");
    poly.id = "live-trace-line";
    poly.setAttribute("points", points.join(" "));
    poly.setAttribute("fill", "none");
    poly.style.stroke = "var(--amber)";
    poly.setAttribute("stroke-width", Math.max(3, cellSize * 0.09));
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    els.svg.appendChild(poly);
  }

  // ---------- Interaction ----------

  function onPointerDown(e) {
    if (solved || drag.active) return;
    const k = e.currentTarget.dataset.key;
    if (!k) return;

    if (eraseMode) {
      if (filled.has(k) && !givenSet.has(k)) {
        filled.delete(k);
        renderBoard();
        saveActive();
      }
      return;
    }

    drag.active = true;
    drag.moved = false;
    drag.startKey = k;
    drag.path = [k];
    drag.newlyFilled = new Set();
    drag.lastKey = k;
    if (filled.has(k)) {
      drag.headKey = k;
      drag.headValue = filled.get(k);
    } else {
      drag.headKey = null;
      drag.headValue = null;
    }
    drag.lastPointerLocal = toLocalPoint(e.clientX, e.clientY);
    renderBoard();
  }

  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cellEl = el.closest ? el.closest(".cell") : null;
    if (!cellEl || !cellEl.dataset.key) return null;
    return cellEl.dataset.key;
  }

  function onPointerMove(e) {
    if (!drag.active || solved) return;

    drag.lastPointerLocal = toLocalPoint(e.clientX, e.clientY);
    renderLiveTrace(); // cheap: keep the tip following the pointer every frame

    const k = cellFromPoint(e.clientX, e.clientY);
    if (!k || k === drag.lastKey) return;
    drag.moved = true;
    drag.lastKey = k;

    if (drag.headKey === null || drag.headValue === null) return; // started on empty cell: no auto-chain

    // Retract: moved back onto the cell just before the current head in this gesture's path
    if (drag.path.length >= 2 && drag.path[drag.path.length - 2] === k) {
      const leaving = drag.path.pop();
      if (drag.newlyFilled.has(leaving)) {
        filled.delete(leaving);
        drag.newlyFilled.delete(leaving);
      }
      drag.headKey = drag.path[drag.path.length - 1];
      drag.headValue = filled.get(drag.headKey);
      renderBoard();
      return;
    }

    if (drag.path.indexOf(k) !== -1) return; // already visited this gesture, not an immediate step-back
    if (!isAdjacent(drag.headKey, k)) return;
    if (blockedSet.has(k)) return;

    const step = dragDirection === "down" ? -1 : 1;
    const existingVal = filled.get(k);
    if (existingVal === undefined) {
      const nextVal = drag.headValue + step;
      if (nextVal < 1 || nextVal > N) return;
      let dupKey = null;
      filled.forEach((v, kk) => { if (v === nextVal) dupKey = kk; });
      if (dupKey !== null) {
        if (givenSet.has(dupKey)) return; // can't relocate a fixed clue
        filled.delete(dupKey);
      }
      filled.set(k, nextVal);
      drag.newlyFilled.add(k);
      drag.path.push(k);
      drag.headKey = k;
      drag.headValue = nextVal;
      renderBoard();
    } else if (existingVal === drag.headValue + step) {
      // bridge into an already-known number (given or previously filled)
      drag.path.push(k);
      drag.headKey = k;
      drag.headValue = existingVal;
      renderBoard();
    }
    // else: mismatched target, ignore until pointer reaches a valid cell
  }

  function onPointerUp(e) {
    if (!drag.active) return;
    const wasTap = !drag.moved;
    const tapKey = drag.startKey;
    drag.active = false;
    drag.path = [];
    drag.newlyFilled = null;
    drag.headKey = null;
    drag.headValue = null;

    if (wasTap && tapKey && !blockedSet.has(tapKey) && !givenSet.has(tapKey)) {
      openNumpad(tapKey);
    } else {
      saveActive();
      checkWin();
    }
    renderBoard();
  }

  function setEraseMode(on) {
    eraseMode = on;
    els.erase.classList.toggle("active", eraseMode);
  }

  function setDragDirection(dir) {
    dragDirection = dir;
    els.dirUp.classList.toggle("active", dir === "up");
    els.dirUp.setAttribute("aria-pressed", String(dir === "up"));
    els.dirDown.classList.toggle("active", dir === "down");
    els.dirDown.setAttribute("aria-pressed", String(dir === "down"));
  }

  function restartPuzzle() {
    if (!confirm("Restart this puzzle? Your entries will be cleared.")) return;
    const keysToRemove = [];
    filled.forEach((v, k) => { if (!givenSet.has(k)) keysToRemove.push(k); });
    keysToRemove.forEach((k) => filled.delete(k));
    solved = false;
    elapsed = 0;
    els.banner.hidden = true;
    startTimer();
    renderBoard();
    saveActive();
  }

  function giveHint() {
    if (solved || !current) return;
    const sol = current.solution;
    for (let v = 1; v <= N; v++) {
      const target = sol.find((s) => s.v === v);
      const k = key(target.col, target.row);
      if (filled.get(k) !== v) {
        filled.set(k, v);
        renderBoard();
        saveActive();
        checkWin();
        return;
      }
    }
  }

  // ---------- Numpad ----------

  function openNumpad(k) {
    activeNumpadCell = k;
    els.numpadLabel.textContent = "Cell value";
    els.numpadGrid.innerHTML = "";
    const used = new Set(filled.values());
    for (let n = 1; n <= N; n++) {
      const btn = document.createElement("button");
      btn.textContent = n;
      if (used.has(n) && filled.get(k) !== n) btn.classList.add("used");
      btn.addEventListener("click", () => {
        // remove n from wherever it currently sits (if anywhere else)
        let existingKeyForN = null;
        filled.forEach((v, kk) => { if (v === n) existingKeyForN = kk; });
        if (existingKeyForN && existingKeyForN !== k && !givenSet.has(existingKeyForN)) {
          filled.delete(existingKeyForN);
        }
        filled.set(k, n);
        closeNumpad();
        renderBoard();
        saveActive();
        checkWin();
      });
      els.numpadGrid.appendChild(btn);
    }
    els.numpadOverlay.hidden = false;
  }

  function closeNumpad() {
    els.numpadOverlay.hidden = true;
    activeNumpadCell = null;
  }

  els.numpadClose.addEventListener("click", closeNumpad);
  els.numpadOverlay.addEventListener("click", (e) => {
    if (e.target === els.numpadOverlay) closeNumpad();
  });
  els.numpadErase.addEventListener("click", () => {
    if (!activeNumpadCell) return;
    filled.delete(activeNumpadCell);
    closeNumpad();
    renderBoard();
    saveActive();
  });

  // ---------- Timer / win ----------

  function startTimer() {
    stopTimer();
    els.timer.textContent = fmtTime(elapsed);
    timerHandle = setInterval(() => {
      elapsed += 1;
      els.timer.textContent = fmtTime(elapsed);
    }, 1000);
  }
  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
  }

  function checkWin() {
    if (filled.size !== N) return;
    const errors = computeErrors();
    if (errors.size !== 0) return;
    const values = new Set(filled.values());
    if (values.size !== N) return;
    solved = true;
    stopTimer();
    clearActive(current.difficulty);
    saveBest(current.difficulty, elapsed);
    showSolvedBanner();
  }

  function showSolvedBanner() {
    els.banner.hidden = false;
    els.banner.className = "status-banner solved";
    els.banner.textContent = "Solved in " + fmtTime(elapsed) + " \u2014 nice work.";
  }

  // ---------- Settings ----------

  const DARK_MODE_KEY = "hidato_dark_mode";

  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function setDarkMode(isDark, persist) {
    document.documentElement.classList.toggle("dark", isDark);
    els.darkModeToggle.checked = isDark;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", isDark ? "#1B1F24" : "#EEF2F6");
    if (persist) {
      try { localStorage.setItem(DARK_MODE_KEY, isDark ? "1" : "0"); } catch (e) {}
    }
  }

  function initDarkMode() {
    let stored = null;
    try {
      const raw = localStorage.getItem(DARK_MODE_KEY);
      stored = raw === null ? null : raw === "1";
    } catch (e) {}
    setDarkMode(stored === null ? systemPrefersDark() : stored, false);
  }

  function checkForUpdate() {
    els.settingsUpdate.disabled = true;
    els.settingsUpdateLabel.textContent = "Updating…";
    Promise.resolve()
      .then(async () => {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.unregister();
        }
        if ("caches" in window) {
          const names = await caches.keys();
          for (const n of names) await caches.delete(n);
        }
      })
      .catch(() => {})
      .then(() => { location.reload(); });
  }

  // ---------- Wiring ----------

  els.home.addEventListener("click", () => {
    saveActive();
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    renderList();
  });
  els.hint.addEventListener("click", giveHint);
  els.restart.addEventListener("click", restartPuzzle);
  els.dirUp.addEventListener("click", () => setDragDirection("up"));
  els.dirDown.addEventListener("click", () => setDragDirection("down"));
  els.erase.addEventListener("click", () => setEraseMode(!eraseMode));
  els.newPuzzle.addEventListener("click", () => {
    if (!current) return;
    if (!confirm("Start a new " + current.difficulty + " puzzle? Current progress will be lost.")) return;
    const diff = current.difficulty;
    clearActive(diff);
    generateAndOpen(diff, null);
  });
  els.settingsBtn.addEventListener("click", () => { els.settingsOverlay.hidden = false; });
  els.settingsClose.addEventListener("click", () => { els.settingsOverlay.hidden = true; });
  els.settingsOverlay.addEventListener("click", (e) => {
    if (e.target === els.settingsOverlay) els.settingsOverlay.hidden = true;
  });
  els.settingsHowto.addEventListener("click", () => {
    els.settingsOverlay.hidden = true;
    els.infoOverlay.hidden = false;
  });
  els.infoClose.addEventListener("click", () => { els.infoOverlay.hidden = true; });
  els.infoOverlay.addEventListener("click", (e) => {
    if (e.target === els.infoOverlay) els.infoOverlay.hidden = true;
  });
  els.darkModeToggle.addEventListener("change", () => {
    setDarkMode(els.darkModeToggle.checked, true);
  });
  els.settingsUpdate.addEventListener("click", checkForUpdate);

  window.addEventListener("resize", () => {
    if (current && !els.viewPlay.hidden) {
      buildBoard();
      renderBoard();
    }
  });

  // ---------- Boot ----------

  initDarkMode();
  renderList();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();

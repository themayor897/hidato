(function () {
  "use strict";

  const els = {
    home: document.getElementById("btn-home"),
    info: document.getElementById("btn-info"),
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
    undo: document.getElementById("btn-undo"),
    clear: document.getElementById("btn-clear"),
    banner: document.getElementById("status-banner"),
    numpadOverlay: document.getElementById("numpad-overlay"),
    numpadGrid: document.getElementById("numpad-grid"),
    numpadLabel: document.getElementById("numpad-label"),
    numpadClose: document.getElementById("numpad-close"),
    numpadErase: document.getElementById("numpad-erase"),
  };

  const DIFF_ORDER = ["Easy", "Medium", "Hard", "Expert"];

  let PUZZLES = [];
  let current = null;      // current puzzle object
  let filled = new Map();  // "r,c" -> value (givens + player fills)
  let blockedSet = new Set();
  let givenSet = new Set();
  let cellEls = new Map(); // "r,c" -> element
  let cellSize = 0;
  let N = 0;
  let undoStack = [];
  let timerHandle = null;
  let elapsed = 0;
  let solved = false;
  let activeNumpadCell = null;

  let drag = {
    active: false,
    moved: false,
    startKey: null,
    headKey: null,
    headValue: null,
    path: [],         // every head position visited this gesture, path[0] = start
    newlyFilled: null, // Set of keys created (not bridged) during this gesture
    lastKey: null,
  };

  function key(r, c) { return r + "," + c; }
  function parseKey(k) { const [r, c] = k.split(",").map(Number); return { r, c }; }

  function progressKey(id) { return "hidato_progress_" + id; }

  function loadProgress(id) {
    try {
      const raw = localStorage.getItem(progressKey(id));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveProgress() {
    if (!current) return;
    const data = {
      filled: Array.from(filled.entries()).filter(([k]) => !givenSet.has(k)),
      elapsed,
      completed: solved,
      bestTime: (loadProgress(current.id) || {}).bestTime || null,
    };
    if (solved) {
      const prevBest = (loadProgress(current.id) || {}).bestTime;
      data.bestTime = prevBest ? Math.min(prevBest, elapsed) : elapsed;
    }
    try { localStorage.setItem(progressKey(current.id), JSON.stringify(data)); } catch (e) {}
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
    DIFF_ORDER.forEach((diff) => {
      const items = PUZZLES.filter((p) => p.difficulty === diff);
      if (!items.length) return;
      const group = document.createElement("div");
      group.className = "diff-group";
      const h2 = document.createElement("h2");
      h2.textContent = diff;
      group.appendChild(h2);
      const grid = document.createElement("div");
      grid.className = "puzzle-grid";
      items.forEach((p, idx) => {
        const prog = loadProgress(p.id);
        const tile = document.createElement("button");
        tile.className = "puzzle-tile" + (prog && prog.completed ? " solved" : "");
        tile.innerHTML =
          '<div class="tile-id">' + diff + " " + (idx + 1) + "</div>" +
          '<div class="tile-size">' + p.rows + "&times;" + p.cols + "</div>" +
          '<div class="tile-meta">' + p.n_cells + " cells &middot; " + p.n_givens + " givens" +
          (prog && prog.bestTime ? " &middot; best " + fmtTime(prog.bestTime) : "") +
          "</div>";
        tile.addEventListener("click", () => openPuzzle(p));
        grid.appendChild(tile);
      });
      group.appendChild(grid);
      els.groups.appendChild(group);
    });
  }

  // ---------- Play view ----------

  function openPuzzle(p) {
    current = p;
    N = p.n_cells;
    blockedSet = new Set(p.blocked.map((b) => key(b.r, b.c)));
    givenSet = new Set(p.givens.map((g) => key(g.r, g.c)));
    filled = new Map();
    p.givens.forEach((g) => filled.set(key(g.r, g.c), g.v));

    const prog = loadProgress(p.id);
    elapsed = 0;
    solved = false;
    if (prog) {
      elapsed = prog.completed ? (prog.bestTime || 0) : (prog.elapsed || 0);
      solved = !!prog.completed;
      if (prog.filled) {
        prog.filled.forEach(([k, v]) => filled.set(k, v));
      }
    }
    undoStack = [];

    els.title.textContent = current.difficulty + " " + (current.id.split("-")[1] || "");
    els.home.hidden = false;
    els.viewList.hidden = true;
    els.viewPlay.hidden = false;
    els.banner.hidden = true;

    buildBoard();
    renderBoard();
    if (solved) {
      showSolvedBanner();
    } else {
      startTimer();
    }
  }

  function buildBoard() {
    els.board.innerHTML = "";
    cellEls = new Map();
    const rows = current.rows, cols = current.cols;

    const wrapWidth = Math.min(window.innerWidth - 32, 520);
    const wrapHeight = window.innerHeight - 230;
    cellSize = Math.floor(Math.min(wrapWidth / cols, wrapHeight / rows, 84));
    cellSize = Math.max(cellSize, 30);

    els.board.style.gridTemplateColumns = "repeat(" + cols + ", " + cellSize + "px)";
    els.board.style.gridTemplateRows = "repeat(" + rows + ", " + cellSize + "px)";
    els.board.style.width = (cellSize * cols) + "px";
    els.board.style.height = (cellSize * rows) + "px";
    els.boardWrap.style.width = (cellSize * cols) + "px";
    els.boardWrap.style.height = (cellSize * rows) + "px";
    els.svg.setAttribute("width", cellSize * cols);
    els.svg.setAttribute("height", cellSize * rows);
    els.svg.setAttribute("viewBox", "0 0 " + (cellSize * cols) + " " + (cellSize * rows));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = key(r, c);
        const div = document.createElement("div");
        div.className = "cell";
        div.style.fontSize = Math.max(11, Math.floor(cellSize * 0.34)) + "px";
        if (blockedSet.has(k)) {
          div.classList.add("blocked");
        } else {
          div.dataset.key = k;
          div.addEventListener("pointerdown", onPointerDown);
        }
        els.board.appendChild(div);
        cellEls.set(k, div);
      }
    }
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  function neighborsOf(r, c) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr, cc = c + dc;
        const k = key(rr, cc);
        if (cellEls.has(k) && !blockedSet.has(k)) out.push(k);
      }
    }
    return out;
  }

  function isAdjacent(k1, k2) {
    const a = parseKey(k1), b = parseKey(k2);
    return Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1 && k1 !== k2;
  }

  // ---------- Rendering / validation ----------

  function renderBoard() {
    const errorCells = computeErrors();
    cellEls.forEach((div, k) => {
      if (blockedSet.has(k)) return;
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

    runs.forEach((r) => {
      if (r.length < 2) return;
      const pts = r.map((k) => {
        const { r: row, c: col } = parseKey(k);
        return (col * cellSize + cellSize / 2) + "," + (row * cellSize + cellSize / 2);
      }).join(" ");
      const poly = document.createElementNS(ns, "polyline");
      poly.setAttribute("points", pts);
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", "#B5772B");
      poly.setAttribute("stroke-width", Math.max(2, cellSize * 0.06));
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("opacity", "0.55");
      els.svg.appendChild(poly);
    });
  }

  // ---------- Interaction ----------

  function onPointerDown(e) {
    if (solved || drag.active) return;
    const k = e.currentTarget.dataset.key;
    if (!k) return;
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
    pushUndoSnapshot();
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

    const existingVal = filled.get(k);
    if (existingVal === undefined) {
      const nextVal = drag.headValue + 1;
      if (nextVal > N) return;
      let dup = false;
      filled.forEach((v) => { if (v === nextVal) dup = true; });
      if (dup) return;
      filled.set(k, nextVal);
      drag.newlyFilled.add(k);
      drag.path.push(k);
      drag.headKey = k;
      drag.headValue = nextVal;
      renderBoard();
    } else if (existingVal === drag.headValue + 1) {
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

    if (wasTap && tapKey && !blockedSet.has(tapKey)) {
      if (!givenSet.has(tapKey)) {
        openNumpad(tapKey);
        undoStack.pop(); // no board change happened on a bare tap; discard the snapshot we pre-pushed
      } else {
        undoStack.pop();
      }
    } else {
      saveProgress();
      checkWin();
    }
    renderBoard();
  }

  function pushUndoSnapshot() {
    undoStack.push(new Map(filled));
    if (undoStack.length > 60) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return;
    filled = undoStack.pop();
    solved = false;
    renderBoard();
    saveProgress();
  }

  function clearProgress() {
    if (!confirm("Clear all your entries in this puzzle?")) return;
    pushUndoSnapshot();
    const keysToRemove = [];
    filled.forEach((v, k) => { if (!givenSet.has(k)) keysToRemove.push(k); });
    keysToRemove.forEach((k) => filled.delete(k));
    solved = false;
    elapsed = 0;
    els.banner.hidden = true;
    startTimer();
    renderBoard();
    saveProgress();
  }

  function giveHint() {
    if (solved || !current) return;
    pushUndoSnapshot();
    const sol = current.solution;
    for (let v = 1; v <= N; v++) {
      const target = sol.find((s) => s.v === v);
      const k = key(target.r, target.c);
      if (filled.get(k) !== v) {
        filled.set(k, v);
        renderBoard();
        saveProgress();
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
        pushUndoSnapshot();
        // remove n from wherever it currently sits (if anywhere else)
        let existingKeyForN = null;
        filled.forEach((v, kk) => { if (v === n) existingKeyForN = kk; });
        if (existingKeyForN && existingKeyForN !== k && !givenSet.has(existingKeyForN)) {
          filled.delete(existingKeyForN);
        }
        filled.set(k, n);
        closeNumpad();
        renderBoard();
        saveProgress();
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
    pushUndoSnapshot();
    filled.delete(activeNumpadCell);
    closeNumpad();
    renderBoard();
    saveProgress();
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
    const totalCells = current.rows * current.cols - current.blocked.length;
    if (filled.size !== totalCells) return;
    const errors = computeErrors();
    if (errors.size !== 0) return;
    const values = new Set(filled.values());
    if (values.size !== N) return;
    solved = true;
    stopTimer();
    saveProgress();
    showSolvedBanner();
  }

  function showSolvedBanner() {
    els.banner.hidden = false;
    els.banner.className = "status-banner solved";
    els.banner.textContent = "Solved in " + fmtTime(elapsed) + " \u2014 nice work.";
  }

  // ---------- Wiring ----------

  els.home.addEventListener("click", () => {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    renderList();
  });
  els.hint.addEventListener("click", giveHint);
  els.undo.addEventListener("click", undo);
  els.clear.addEventListener("click", clearProgress);
  els.info.addEventListener("click", () => { els.infoOverlay.hidden = false; });
  els.infoClose.addEventListener("click", () => { els.infoOverlay.hidden = true; });
  els.infoOverlay.addEventListener("click", (e) => {
    if (e.target === els.infoOverlay) els.infoOverlay.hidden = true;
  });

  window.addEventListener("resize", () => {
    if (current && !els.viewPlay.hidden) {
      buildBoard();
      renderBoard();
    }
  });

  // ---------- Boot ----------

  fetch("puzzles.json")
    .then((r) => r.json())
    .then((data) => { PUZZLES = data; renderList(); })
    .catch(() => {
      els.groups.innerHTML = '<p class="subtitle">Couldn\'t load puzzles. If this is the first launch, make sure you have a connection once so the app can cache its files offline.</p>';
    });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
})();

(function (global) {
  "use strict";

  const DIFFS = {
    Easy:   { rows: 5, cols: 5, blocked: 0,  givenRatio: [0.42, 0.48] },
    Medium: { rows: 6, cols: 6, blocked: 0,  givenRatio: [0.42, 0.48] },
    Hard:   { rows: 7, cols: 7, blocked: 0,  givenRatio: [0.42, 0.48] },
    Expert: { rows: 8, cols: 8, blocked: 12, givenRatio: [0.42, 0.48] },
  };

  function key(r, c) { return r + "," + c; }
  function parseKey(k) { const [r, c] = k.split(",").map(Number); return { r, c }; }

  function randInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function inBounds(r, c, rows, cols) { return r >= 0 && r < rows && c >= 0 && c < cols; }

  function neighborKeys(r, c, rows, cols, blocked) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr, cc = c + dc;
        if (!inBounds(rr, cc, rows, cols)) continue;
        const k = key(rr, cc);
        if (blocked.has(k)) continue;
        out.push(k);
      }
    }
    return out;
  }

  function pickBlocked(rows, cols, count) {
    if (count <= 0) return new Set();
    const all = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push(key(r, c));
    shuffle(all);
    return new Set(all.slice(0, count));
  }

  // Deterministic king-move Hamiltonian path over a full rectangle (no holes).
  // Always valid, used as a guaranteed fallback and as one source of variety.
  function snakePath(rows, cols) {
    const rowMajor = Math.random() < 0.5;
    const flipR = Math.random() < 0.5;
    const flipC = Math.random() < 0.5;
    const path = [];
    if (rowMajor) {
      for (let ri = 0; ri < rows; ri++) {
        const r = flipR ? rows - 1 - ri : ri;
        let order = Array.from({ length: cols }, (_, i) => i);
        if (ri % 2 === 1) order = order.slice().reverse();
        if (flipC) order = order.map((c) => cols - 1 - c);
        order.forEach((c) => path.push(key(r, c)));
      }
    } else {
      for (let ci = 0; ci < cols; ci++) {
        const c = flipC ? cols - 1 - ci : ci;
        let order = Array.from({ length: rows }, (_, i) => i);
        if (ci % 2 === 1) order = order.slice().reverse();
        if (flipR) order = order.map((r) => rows - 1 - r);
        order.forEach((r) => path.push(key(r, c)));
      }
    }
    return path;
  }

  // Randomized Warnsdorff heuristic with backtracking, bounded by a step budget.
  function findHamiltonianPath(rows, cols, blocked, maxSteps) {
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = key(r, c);
        if (!blocked.has(k)) cells.push(k);
      }
    }
    const total = cells.length;
    if (total === 0) return null;

    const nbrCache = new Map();
    cells.forEach((k) => {
      const { r, c } = parseKey(k);
      nbrCache.set(k, neighborKeys(r, c, rows, cols, blocked));
    });

    let steps = 0;
    const starts = shuffle(cells.slice());

    function remainingDegree(k, visited) {
      let d = 0;
      nbrCache.get(k).forEach((n) => { if (!visited.has(n)) d++; });
      return d;
    }

    function dfs(current, visited, path) {
      steps++;
      if (steps > maxSteps) return false;
      if (path.length === total) return true;
      let candidates = nbrCache.get(current).filter((n) => !visited.has(n));
      if (candidates.length === 0) return false;
      candidates = shuffle(candidates);
      candidates.sort((a, b) => remainingDegree(a, visited) - remainingDegree(b, visited));
      for (const next of candidates) {
        visited.add(next);
        path.push(next);
        if (dfs(next, visited, path)) return true;
        path.pop();
        visited.delete(next);
        if (steps > maxSteps) return false;
      }
      return false;
    }

    for (const start of starts) {
      const visited = new Set([start]);
      const path = [start];
      if (dfs(start, visited, path)) return path;
      if (steps > maxSteps) break;
    }
    return null;
  }

  function generatePath(rows, cols, blockedCount) {
    for (let count = blockedCount; count >= 0; count--) {
      for (let attempt = 0; attempt < (count === 0 ? 6 : 40); attempt++) {
        const blocked = pickBlocked(rows, cols, count);
        const budget = count === 0 ? 20000 : 4000;
        const path = findHamiltonianPath(rows, cols, blocked, budget);
        if (path) return { path, blocked };
      }
    }
    // Guaranteed fallback: full rectangle, no holes.
    return { path: snakePath(rows, cols), blocked: new Set() };
  }

  // Counts solutions (capped at `limit`) consistent with the given clues.
  // Returns { count, timedOut }.
  function countSolutions(rows, cols, blocked, givenMap, N, limit, deadlineMs) {
    const deadline = Date.now() + deadlineMs;
    const nbrCache = new Map();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = key(r, c);
        if (blocked.has(k)) continue;
        nbrCache.set(k, neighborKeys(r, c, rows, cols, blocked));
      }
    }
    const valueToGivenCell = new Map();
    givenMap.forEach((v, k) => valueToGivenCell.set(v, k));

    const usedCells = new Set();
    let count = 0;
    let timedOut = false;

    function cellAllowed(k, v) {
      return !givenMap.has(k) || givenMap.get(k) === v;
    }

    function search(v, currentCell) {
      if (Date.now() > deadline) { timedOut = true; return true; }
      if (v > N) { count++; return count >= limit; }
      const forcedCell = valueToGivenCell.get(v);
      if (currentCell === null) {
        if (forcedCell) {
          if (!cellAllowed(forcedCell, 1) || usedCells.has(forcedCell)) return false;
          usedCells.add(forcedCell);
          const stop = search(2, forcedCell);
          usedCells.delete(forcedCell);
          return stop;
        }
        for (const k of nbrCache.keys()) {
          if (usedCells.has(k) || !cellAllowed(k, 1)) continue;
          usedCells.add(k);
          if (search(2, k)) return true;
          usedCells.delete(k);
          if (Date.now() > deadline) { timedOut = true; return true; }
        }
        return false;
      }
      if (forcedCell) {
        if (usedCells.has(forcedCell)) return false;
        if (!nbrCache.get(currentCell).includes(forcedCell)) return false;
        usedCells.add(forcedCell);
        const stop = search(v + 1, forcedCell);
        usedCells.delete(forcedCell);
        return stop;
      }
      for (const k of nbrCache.get(currentCell)) {
        if (usedCells.has(k) || !cellAllowed(k, v)) continue;
        usedCells.add(k);
        if (search(v + 1, k)) return true;
        usedCells.delete(k);
        if (Date.now() > deadline) { timedOut = true; return true; }
      }
      return false;
    }

    search(1, null);
    return { count, timedOut };
  }

  // Builds one candidate: a random Hamiltonian path, then greedily strips
  // clues from a fully-revealed board, keeping each removal only if the
  // puzzle stays uniquely solvable. Starting full and removing lands near
  // the target ratio far more reliably than revealing clues forward from
  // nothing, since king-move adjacency leaves an open board with many
  // alternate Hamiltonian paths until heavily constrained.
  function attemptGenerate(cfg) {
    const { path, blocked } = generatePath(cfg.rows, cfg.cols, cfg.blocked);
    const N = path.length;
    const ratio = cfg.givenRatio[0] + Math.random() * (cfg.givenRatio[1] - cfg.givenRatio[0]);
    const targetGivens = Math.max(2, Math.round(N * ratio));

    const givenMap = new Map();
    path.forEach((k, i) => givenMap.set(k, i + 1));

    const removable = shuffle(path.slice(1, -1)); // keep endpoints 1 and N as permanent clues
    const deadline = Date.now() + 1200;
    for (const k of removable) {
      if (givenMap.size <= targetGivens || Date.now() > deadline) break;
      const v = givenMap.get(k);
      givenMap.delete(k);
      const result = countSolutions(cfg.rows, cfg.cols, blocked, givenMap, N, 2, 200);
      if (result.count > 1 || result.timedOut) givenMap.set(k, v);
    }

    return { path, blocked, N, givenMap };
  }

  function generate(difficulty) {
    const cfg = DIFFS[difficulty];
    if (!cfg) throw new Error("Unknown difficulty: " + difficulty);

    // Some random paths are structurally hard to compress (most removals
    // get rejected). Retry a couple of times and keep the best if the
    // first attempt lands well above the target ratio.
    const acceptableRatio = 0.58;
    let best = attemptGenerate(cfg);
    for (let i = 0; i < 2 && best.givenMap.size / best.N > acceptableRatio; i++) {
      const candidate = attemptGenerate(cfg);
      if (candidate.givenMap.size < best.givenMap.size) best = candidate;
    }

    const { path, blocked, N, givenMap } = best;
    const blockedList = Array.from(blocked).map((k) => parseKey(k));
    const givensList = Array.from(givenMap.entries()).map(([k, v]) => {
      const { r, c } = parseKey(k);
      return { r, c, v };
    });
    const solution = path.map((k, i) => {
      const { r, c } = parseKey(k);
      return { r, c, v: i + 1 };
    });

    return {
      id: difficulty.toLowerCase() + "-" + Date.now().toString(36) + randInt(46656).toString(36),
      difficulty,
      rows: cfg.rows,
      cols: cfg.cols,
      n_cells: N,
      n_givens: givenMap.size,
      blocked: blockedList,
      givens: givensList,
      solution,
    };
  }

  global.HidatoGen = { generate, DIFFS };
})(window);

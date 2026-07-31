(function (global) {
  "use strict";

  const SQRT3 = Math.sqrt(3);
  const FORMAT = "hex-offset-v1";

  // Fixed width (columns) across every difficulty, so hex cell size stays
  // constant regardless of puzzle size -- harder puzzles get taller boards,
  // not smaller cells. Optimized for a vertical phone screen: width never
  // grows, only height (rows) does.
  const DIFFS = {
    Easy:        { cols: 6, rows: 3,  blocked: 0 },
    Normal:      { cols: 6, rows: 6,  blocked: 0 },
    Hard:        { cols: 6, rows: 10, blocked: 8 },
    "Very Hard": { cols: 6, rows: 15, blocked: 13 },
    Ultra:       { cols: 6, rows: 20, blocked: 18 },
  };
  Object.keys(DIFFS).forEach((k) => { DIFFS[k].cells = DIFFS[k].cols * DIFFS[k].rows; });

  // Public cell coordinates are a simple (col, row) offset grid -- easy to
  // reason about and size for a rectangular phone screen. Axial hex
  // coordinates (q, r) are used only internally, purely to compute
  // neighbors: axial neighbor offsets are constant regardless of position,
  // unlike offset coordinates which need a different neighbor rule for
  // even/odd rows if you work in them directly.
  const AXIAL_DIRS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [-1, 1],
  ];

  function key(col, row) { return col + "," + row; }
  function parseKey(k) { const [col, row] = k.split(",").map(Number); return { col, row }; }

  function offsetToAxial(col, row) { return { q: col - Math.floor(row / 2), r: row }; }
  function axialToOffset(q, r) { return { col: q + Math.floor(r / 2), row: r }; }

  function randInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function cellsInGrid(cols, rows) {
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) cells.push(key(col, row));
    }
    return cells;
  }

  function neighborKeys(col, row, cols, rows, blocked) {
    const { q, r } = offsetToAxial(col, row);
    const out = [];
    for (const [dq, dr] of AXIAL_DIRS) {
      const { col: ncol, row: nrow } = axialToOffset(q + dq, r + dr);
      if (ncol < 0 || ncol >= cols || nrow < 0 || nrow >= rows) continue;
      const k = key(ncol, nrow);
      if (blocked.has(k)) continue;
      out.push(k);
    }
    return out;
  }

  function pickBlocked(cells, count) {
    if (count <= 0) return new Set();
    const pool = cells.slice();
    shuffle(pool);
    return new Set(pool.slice(0, count));
  }

  // Randomized Warnsdorff heuristic with backtracking, bounded by a step budget.
  function findHamiltonianPath(cols, rows, blocked, maxSteps) {
    const cells = cellsInGrid(cols, rows).filter((k) => !blocked.has(k));
    const total = cells.length;
    if (total === 0) return null;

    const nbrCache = new Map();
    cells.forEach((k) => {
      const { col, row } = parseKey(k);
      nbrCache.set(k, neighborKeys(col, row, cols, rows, blocked));
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

  function generatePath(cols, rows, blockedCount) {
    const cells = cellsInGrid(cols, rows);
    for (let count = blockedCount; count >= 0; count--) {
      const attempts = count === 0 ? 25 : 40;
      const budget = count === 0 ? 300000 : 4000;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const blocked = pickBlocked(cells, count);
        const path = findHamiltonianPath(cols, rows, blocked, budget);
        if (path) return { path, blocked };
      }
    }
    // Should be unreachable: a hole-free hex board is well-connected enough
    // that the Warnsdorff search above always finds a path in practice.
    throw new Error("Failed to find a Hamiltonian path for a " + cols + "x" + rows + " hex board");
  }

  // Counts solutions (capped at `limit`) consistent with the given clues.
  // Returns { count, timedOut }.
  function countSolutions(cols, rows, blocked, givenMap, N, limit, deadlineMs) {
    const deadline = Date.now() + deadlineMs;
    const cells = cellsInGrid(cols, rows).filter((k) => !blocked.has(k));
    const nbrCache = new Map();
    cells.forEach((k) => {
      const { col, row } = parseKey(k);
      nbrCache.set(k, neighborKeys(col, row, cols, rows, blocked));
    });
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
  // clues from a fully-revealed board down to a locally-minimal unique set,
  // keeping each removal only if the puzzle stays uniquely solvable.
  function attemptGenerate(cfg) {
    const { path, blocked } = generatePath(cfg.cols, cfg.rows, cfg.blocked);
    const N = path.length;

    const givenMap = new Map();
    path.forEach((k, i) => givenMap.set(k, i + 1));

    const removable = shuffle(path.slice(1, -1)); // keep endpoints 1 and N as permanent clues
    const deadline = Date.now() + 1000 + N * 20;
    for (const k of removable) {
      if (Date.now() > deadline) break;
      const v = givenMap.get(k);
      givenMap.delete(k);
      const result = countSolutions(cfg.cols, cfg.rows, blocked, givenMap, N, 2, 150);
      if (result.count > 1 || result.timedOut) givenMap.set(k, v);
    }

    return { path, blocked, N, givenMap };
  }

  function generate(difficulty) {
    const cfg = DIFFS[difficulty];
    if (!cfg) throw new Error("Unknown difficulty: " + difficulty);

    const { path, blocked, N, givenMap } = attemptGenerate(cfg);
    const blockedList = Array.from(blocked).map((k) => parseKey(k));
    const givensList = Array.from(givenMap.entries()).map(([k, v]) => {
      const { col, row } = parseKey(k);
      return { col, row, v };
    });
    const solution = path.map((k, i) => {
      const { col, row } = parseKey(k);
      return { col, row, v: i + 1 };
    });

    return {
      id: difficulty.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now().toString(36) + randInt(46656).toString(36),
      format: FORMAT,
      difficulty,
      cols: cfg.cols,
      rows: cfg.rows,
      n_cells: N,
      n_givens: givenMap.size,
      blocked: blockedList,
      givens: givensList,
      solution,
    };
  }

  global.HidatoGen = { generate, DIFFS, FORMAT };
})(window);

(function (global) {
  "use strict";

  const SQRT3 = Math.sqrt(3);

  function cellCount(radius) { return 3 * radius * radius + 3 * radius + 1; }

  const DIFFS = {
    Easy:        { radius: 2, blocked: 0,  cells: cellCount(2) },
    Normal:      { radius: 3, blocked: 0,  cells: cellCount(3) },
    Hard:        { radius: 4, blocked: 10, cells: cellCount(4) },
    "Very Hard": { radius: 5, blocked: 15, cells: cellCount(5) },
    Ultra:       { radius: 6, blocked: 20, cells: cellCount(6) },
  };

  // Axial hex coordinates (q, r). Neighbor offsets are constant regardless
  // of position -- unlike offset/"odd-row" coordinates, there's no parity
  // switch to get wrong.
  const AXIAL_DIRS = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [-1, 1],
  ];

  function key(q, r) { return q + "," + r; }
  function parseKey(k) { const [q, r] = k.split(",").map(Number); return { q, r }; }

  function randInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function hexDistance(q, r) {
    return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
  }

  // Every (q, r) within `radius` of the center -- a hexagon-shaped board.
  function cellsInRadius(radius) {
    const cells = [];
    for (let r = -radius; r <= radius; r++) {
      const qMin = Math.max(-radius, -radius - r);
      const qMax = Math.min(radius, radius - r);
      for (let q = qMin; q <= qMax; q++) cells.push(key(q, r));
    }
    return cells;
  }

  function neighborKeys(q, r, radius, blocked) {
    const out = [];
    for (const [dq, dr] of AXIAL_DIRS) {
      const nq = q + dq, nr = r + dr;
      if (hexDistance(nq, nr) > radius) continue;
      const k = key(nq, nr);
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
  function findHamiltonianPath(radius, blocked, maxSteps) {
    const cells = cellsInRadius(radius).filter((k) => !blocked.has(k));
    const total = cells.length;
    if (total === 0) return null;

    const nbrCache = new Map();
    cells.forEach((k) => {
      const { q, r } = parseKey(k);
      nbrCache.set(k, neighborKeys(q, r, radius, blocked));
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

  function generatePath(radius, blockedCount) {
    const cells = cellsInRadius(radius);
    for (let count = blockedCount; count >= 0; count--) {
      const attempts = count === 0 ? 25 : 40;
      const budget = count === 0 ? 300000 : 4000;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const blocked = pickBlocked(cells, count);
        const path = findHamiltonianPath(radius, blocked, budget);
        if (path) return { path, blocked };
      }
    }
    // Should be unreachable: a hole-free hex board is well-connected enough
    // that the Warnsdorff search above always finds a path in practice.
    throw new Error("Failed to find a Hamiltonian path for hex radius " + radius);
  }

  // Counts solutions (capped at `limit`) consistent with the given clues.
  // Returns { count, timedOut }.
  function countSolutions(radius, blocked, givenMap, N, limit, deadlineMs) {
    const deadline = Date.now() + deadlineMs;
    const cells = cellsInRadius(radius).filter((k) => !blocked.has(k));
    const nbrCache = new Map();
    cells.forEach((k) => {
      const { q, r } = parseKey(k);
      nbrCache.set(k, neighborKeys(q, r, radius, blocked));
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
    const { path, blocked } = generatePath(cfg.radius, cfg.blocked);
    const N = path.length;

    const givenMap = new Map();
    path.forEach((k, i) => givenMap.set(k, i + 1));

    const removable = shuffle(path.slice(1, -1)); // keep endpoints 1 and N as permanent clues
    const deadline = Date.now() + 1000 + N * 20;
    for (const k of removable) {
      if (Date.now() > deadline) break;
      const v = givenMap.get(k);
      givenMap.delete(k);
      const result = countSolutions(cfg.radius, blocked, givenMap, N, 2, 150);
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
      const { q, r } = parseKey(k);
      return { q, r, v };
    });
    const solution = path.map((k, i) => {
      const { q, r } = parseKey(k);
      return { q, r, v: i + 1 };
    });

    return {
      id: difficulty.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now().toString(36) + randInt(46656).toString(36),
      difficulty,
      radius: cfg.radius,
      n_cells: N,
      n_givens: givenMap.size,
      blocked: blockedList,
      givens: givensList,
      solution,
    };
  }

  global.HidatoGen = { generate, DIFFS };
})(window);

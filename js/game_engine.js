/**
 * Mustang — ігровий рушій (JavaScript)
 * Порт логіки з game_engine.py: дошка, ходи, AI коня (minimax), Score, нотація.
 */
(function (global) {
  "use strict";

  const BOARD_SIZE = 8;
  const BISHOP = "B";
  const KNIGHT = "N";
  const EMPTY = "";

  const KNIGHT_DELTAS = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];

  let KNIGHT_SEARCH_DEPTH = 4;
  const KNIGHT_MAX_BISHOP_BRANCH = 28;

  const CENTER_BONUS = [
    [0, 1, 2, 3, 3, 2, 1, 0],
    [1, 3, 4, 5, 5, 4, 3, 1],
    [2, 4, 6, 7, 7, 6, 4, 2],
    [3, 5, 7, 9, 9, 7, 5, 3],
    [3, 5, 7, 9, 9, 7, 5, 3],
    [2, 4, 6, 7, 7, 6, 4, 2],
    [1, 3, 4, 5, 5, 4, 3, 1],
    [0, 1, 2, 3, 3, 2, 1, 0],
  ];

  const PARITY_IMPOSSIBLE_BISHOPS = 10;
  const PARITY_BASE_SCORE = 1000.0;
  const PARITY_MOVE_WEIGHT_SEC = 15.0;

  function posToAlg(r, c) {
    return String.fromCharCode(97 + c) + (8 - r);
  }

  function formatGameNotation(history) {
    if (!history || !history.length) return "";
    const lines = [];
    let num = 1;
    let i = 0;
    while (i < history.length) {
      const white = history[i++];
      if (i < history.length) {
        const black = history[i++];
        lines.push(`${num}. ${white} ${black}`);
      } else {
        lines.push(`${num}. ${white}`);
      }
      num++;
    }
    return lines.join("\n");
  }

  // ---- Board ----
  class Board {
    constructor(numBishops = 16) {
      this.numBishops = numBishops;
      this.reset();
    }

    reset() {
      this.grid = Array.from({ length: BOARD_SIZE }, () =>
        Array(BOARD_SIZE).fill(EMPTY)
      );
      this.bishops = [];
      this.knight = null;
      this.placePieces();
    }

    placePieces() {
      const ordered = [];
      for (let r = BOARD_SIZE - 1; r >= 0; r--) {
        for (let c = 0; c < BOARD_SIZE; c++) ordered.push([r, c]);
      }
      const n = Math.max(1, Math.min(this.numBishops, BOARD_SIZE * BOARD_SIZE - 1));
      this.bishops = ordered.slice(0, n).map(([r, c]) => [r, c]);
      const free = ordered.slice(n);
      const idx = Math.floor(Math.random() * free.length);
      this.knight = free[idx].slice();
      for (const [r, c] of this.bishops) this.grid[r][c] = BISHOP;
      this.grid[this.knight[0]][this.knight[1]] = KNIGHT;
    }

    isEmpty(r, c) {
      return this.grid[r][c] === EMPTY;
    }

    bishopMoves(r, c) {
      const moves = [];
      for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
          if (this.isEmpty(nr, nc)) moves.push([nr, nc]);
          else break;
          nr += dr;
          nc += dc;
        }
      }
      return moves;
    }

    knightMoves(r, c) {
      const moves = [];
      for (const [dr, dc] of KNIGHT_DELTAS) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && this.isEmpty(nr, nc)) {
          moves.push([nr, nc]);
        }
      }
      return moves;
    }

    move(fr, fc, tr, tc) {
      const piece = this.grid[fr][fc];
      this.grid[fr][fc] = EMPTY;
      this.grid[tr][tc] = piece;
      if (piece === BISHOP) {
        this.bishops = this.bishops.filter(([r, c]) => !(r === fr && c === fc));
        this.bishops.push([tr, tc]);
      } else {
        this.knight = [tr, tc];
      }
    }

    knightMobility() {
      if (!this.knight) return 0;
      return this.knightMoves(this.knight[0], this.knight[1]).length;
    }

    piecesList() {
      const out = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = this.grid[r][c];
          if (p) out.push({ r, c, type: p });
        }
      }
      return out;
    }
  }

  // ---- AI ----
  function knightEval(board) {
    if (!board.knight) return -100000;
    const [kr, kc] = board.knight;
    const moves = board.knightMoves(kr, kc);
    const mob = moves.length;
    if (mob === 0) return -100000;
    const center = CENTER_BONUS[kr][kc];
    let second = 0;
    for (const [tr, tc] of moves) {
      let cnt = 0;
      for (const [dr, dc] of KNIGHT_DELTAS) {
        const nr = tr + dr, nc = tc + dc;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board.isEmpty(nr, nc)) {
          if (!(nr === kr && nc === kc)) cnt++;
        }
      }
      second += cnt;
    }
    second = mob > 0 ? second / mob : 0;
    let edgePen = 0;
    if (kr === 0 || kr === 7 || kc === 0 || kc === 7) edgePen = 2;
    if ((kr === 0 || kr === 7) && (kc === 0 || kc === 7)) edgePen = 5;
    return mob * 100 + second * 12 + center * 3 - edgePen * 8;
  }

  function allBishopMoves(board) {
    const moves = [];
    for (const [r, c] of board.bishops) {
      for (const [tr, tc] of board.bishopMoves(r, c)) {
        moves.push([r, c, tr, tc]);
      }
    }
    return moves;
  }

  function orderBishopMoves(board, moves) {
    if (!board.knight) return moves;
    const [kr, kc] = board.knight;
    const scored = moves.map(([fr, fc, tr, tc]) => {
      const distBefore = Math.abs(fr - kr) + Math.abs(fc - kc);
      const distAfter = Math.abs(tr - kr) + Math.abs(tc - kc);
      const approach = distBefore - distAfter;
      const near = distAfter <= 3 ? 1 : 0;
      return [approach * 10 + near * 5 - distAfter, fr, fc, tr, tc];
    });
    scored.sort((a, b) => b[0] - a[0]);
    return scored.map((x) => [x[1], x[2], x[3], x[4]]);
  }

  function knightMinimax(board, depth, alpha, beta, maximizing) {
    const mob = board.knightMobility();
    if (mob === 0) return -100000 + depth;
    if (depth === 0) return knightEval(board);

    if (maximizing) {
      let best = -1e9;
      const cur = board.knight;
      if (!cur) return -100000 + depth;
      const candidates = board.knightMoves(cur[0], cur[1]);
      if (!candidates.length) return -100000 + depth;

      const ordered = [];
      for (const [tr, tc] of candidates) {
        board.move(cur[0], cur[1], tr, tc);
        const m = board.knightMobility();
        const cen = CENTER_BONUS[tr][tc];
        ordered.push([m * 10 + cen, tr, tc]);
        board.move(tr, tc, cur[0], cur[1]);
      }
      ordered.sort((a, b) => b[0] - a[0]);

      for (const [, tr, tc] of ordered) {
        board.move(cur[0], cur[1], tr, tc);
        const val = knightMinimax(board, depth - 1, alpha, beta, false);
        board.move(tr, tc, cur[0], cur[1]);
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let moves = allBishopMoves(board);
      if (!moves.length) return knightEval(board) + 50;
      moves = orderBishopMoves(board, moves).slice(0, KNIGHT_MAX_BISHOP_BRANCH);
      let best = 1e9;
      for (const [fr, fc, tr, tc] of moves) {
        board.move(fr, fc, tr, tc);
        let val;
        if (board.knightMobility() === 0) val = -100000 + depth;
        else val = knightMinimax(board, depth - 1, alpha, beta, true);
        board.move(tr, tc, fr, fc);
        if (val < best) best = val;
        if (best < beta) beta = best;
        if (beta <= alpha) break;
      }
      return best;
    }
  }

  function bestKnightMove(board) {
    if (!board.knight) return null;
    const cur = board.knight;
    const candidates = board.knightMoves(cur[0], cur[1]);
    if (!candidates.length) return null;

    let depth = KNIGHT_SEARCH_DEPTH;
    const nB = board.bishops.length;
    if (nB >= 24 && depth > 3) depth = 3;
    else if (nB >= 16 && depth > 4) depth = 4;

    let bestScore = -1e9;
    let bestMoves = [];

    const ordered = [];
    for (const [tr, tc] of candidates) {
      board.move(cur[0], cur[1], tr, tc);
      const m = board.knightMobility();
      const cen = CENTER_BONUS[tr][tc];
      ordered.push([m * 10 + cen, tr, tc]);
      board.move(tr, tc, cur[0], cur[1]);
    }
    ordered.sort((a, b) => b[0] - a[0]);

    for (const [, tr, tc] of ordered) {
      board.move(cur[0], cur[1], tr, tc);
      let score;
      if (board.knightMobility() === 0) score = -100000;
      else score = knightMinimax(board, depth - 1, -1e9, 1e9, false);
      board.move(tr, tc, cur[0], cur[1]);
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [[tr, tc]];
      } else if (score === bestScore) {
        bestMoves.push([tr, tc]);
      }
    }
    if (!bestMoves.length) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }

  function parityScore(bishops, moves, timeSec) {
    const b = parseInt(bishops, 10);
    const m = parseFloat(moves);
    const t = parseFloat(timeSec);
    if (!(b > PARITY_IMPOSSIBLE_BISHOPS) || !(m > 0) || t < 0) return 0;
    const d = 32 - b;
    const logDiff = 2.525 + 0.1185 * d - 0.01289 * d * d + 0.000554 * d * d * d;
    const difficulty = Math.exp(logDiff);
    const e = m + t / PARITY_MOVE_WEIGHT_SEC;
    if (e <= 0) return 0;
    return (PARITY_BASE_SCORE * difficulty) / e;
  }

  function isKnightCaught(board) {
    return board.knightMobility() === 0;
  }

  // export
  global.MustangEngine = {
    BOARD_SIZE,
    BISHOP,
    KNIGHT,
    EMPTY,
    Board,
    posToAlg,
    formatGameNotation,
    bestKnightMove,
    parityScore,
    isKnightCaught,
    setSearchDepth(d) {
      KNIGHT_SEARCH_DEPTH = d;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);

/**
 * Mustang Static — UI + гра (mobile-first)
 * AI працює локально через MustangEngine
 */
(function () {
  "use strict";

  const E = window.MustangEngine;
  if (!E) {
    alert("Не завантажено game_engine.js");
    return;
  }

  const LIGHT = "#F0D9B5";
  const DARK = "#B58863";
  const HIGHLIGHT = "rgba(120, 180, 230, 0.75)";
  const SELECT = "#77DD77";
  const BOARD_BG = "#312E2B";

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const msgEl = document.getElementById("message");

  let board = null;
  let state = "idle"; // idle | playing | paused | finished
  let selected = null; // [r,c]
  let legalMoves = [];
  let moveCount = 0;
  let moveHistory = [];
  let selectedLevel = 16;
  let elapsed = 0;
  let startedAt = null;
  let timerId = null;
  let sq = 40;
  let margin = 16;
  let dpr = 1;
  let aiBusy = false;

  // ---- DOM helpers ----
  function setMsg(text, cls) {
    msgEl.textContent = text || "";
    msgEl.className = cls || "";
  }

  function updateStats() {
    document.getElementById("st-b").textContent =
      board ? board.numBishops : "—";
    document.getElementById("st-m").textContent = String(moveCount);
    const t = currentElapsed();
    document.getElementById("st-t").textContent = t.toFixed(1);
    const pauseBtn = document.getElementById("btn-pause");
    pauseBtn.disabled = state === "idle" || state === "finished";
    pauseBtn.textContent = state === "paused" ? "Далі" : "Пауза";
  }

  function currentElapsed() {
    if (state === "playing" && startedAt != null) {
      return elapsed + (performance.now() / 1000 - startedAt);
    }
    return elapsed;
  }

  function showWin(score) {
    const panel = document.getElementById("win-panel");
    const text = document.getElementById("win-text");
    const t = currentElapsed();
    text.textContent =
      `Слонів: ${board.numBishops}\n` +
      `Ходів: ${moveCount}\n` +
      `Час: ${t.toFixed(1)} с\n` +
      (score != null ? `Score: ${score.toFixed(0)}` : "");
    panel.classList.remove("hidden");
  }

  function hideWin() {
    document.getElementById("win-panel").classList.add("hidden");
  }

  // ---- Timer ----
  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      if (state === "playing") updateStats();
    }, 200);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  // ---- Canvas ----
  function resizeCanvas() {
    const wrap = document.getElementById("board-wrap");
    const cssSize = Math.min(wrap.clientWidth, wrap.clientHeight || wrap.clientWidth, 440);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cssSize + "px";
    canvas.style.height = cssSize + "px";
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    margin = Math.max(12, Math.round(cssSize * 0.045));
    sq = (cssSize - 2 * margin) / 8;
    draw();
  }

  function draw() {
    const size = canvas.width / dpr;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, size, size);

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
        ctx.fillRect(margin + c * sq, margin + r * sq, sq + 0.5, sq + 0.5);
      }
    }

    if (state === "playing" && legalMoves.length) {
      for (const [tr, tc] of legalMoves) {
        const cx = margin + tc * sq + sq / 2;
        const cy = margin + tr * sq + sq / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, sq * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = HIGHLIGHT;
        ctx.fill();
      }
    }

    if (selected && state === "playing") {
      const [r, c] = selected;
      ctx.strokeStyle = SELECT;
      ctx.lineWidth = Math.max(3, sq * 0.07);
      ctx.strokeRect(
        margin + c * sq + 2,
        margin + r * sq + 2,
        sq - 4,
        sq - 4
      );
    }

    if (board && state !== "paused") {
      for (const p of board.piecesList()) {
        drawPiece(p.r, p.c, p.type);
      }
    } else if (state === "paused") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(margin, margin, sq * 8, sq * 8);
      ctx.fillStyle = "#f0d9b5";
      ctx.font = `bold ${Math.round(sq * 0.55)}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ПАУЗА", margin + sq * 4, margin + sq * 4);
    }

    // labels
    ctx.fillStyle = "#9ca3af";
    ctx.font = `${Math.max(9, Math.round(sq * 0.2))}px system-ui,sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 8; i++) {
      ctx.fillText(
        String.fromCharCode(97 + i),
        margin + i * sq + sq / 2,
        margin + 8 * sq + margin * 0.55
      );
      ctx.fillText(
        String(8 - i),
        margin * 0.38,
        margin + i * sq + sq / 2
      );
    }
  }

  function drawPiece(r, c, type) {
    const cx = margin + c * sq + sq / 2;
    const cy = margin + r * sq + sq / 2;
    const radius = sq * 0.34;

    if (type === E.BISHOP) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#f5f0e6";
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#1c1917";
      ctx.font = `bold ${Math.round(sq * 0.4)}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("B", cx, cy + 1);
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#1c1917";
      ctx.fill();
      ctx.strokeStyle = "#e7e5e4";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#f0d9b5";
      ctx.font = `bold ${Math.round(sq * 0.4)}px system-ui,sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("N", cx, cy + 1);
    }
  }

  // ---- Input ----
  function canvasCell(evt) {
    const rect = canvas.getBoundingClientRect();
    let x, y;
    if (evt.changedTouches && evt.changedTouches.length) {
      x = evt.changedTouches[0].clientX - rect.left;
      y = evt.changedTouches[0].clientY - rect.top;
    } else {
      x = evt.clientX - rect.left;
      y = evt.clientY - rect.top;
    }
    const scaleX = (canvas.width / dpr) / rect.width;
    const scaleY = (canvas.height / dpr) / rect.height;
    x *= scaleX;
    y *= scaleY;
    const c = Math.floor((x - margin) / sq);
    const r = Math.floor((y - margin) / sq);
    return { r, c };
  }

  function onBoardPointer(evt) {
    evt.preventDefault();
    if (state !== "playing" || aiBusy || !board) return;
    const { r, c } = canvasCell(evt);
    if (r < 0 || r > 7 || c < 0 || c > 7) return;

    // move if legal
    if (selected) {
      const isLegal = legalMoves.some(([tr, tc]) => tr === r && tc === c);
      if (isLegal) {
        doBishopMove(selected[0], selected[1], r, c);
        return;
      }
    }

    // select bishop
    selected = null;
    legalMoves = [];
    if (board.grid[r][c] === E.BISHOP) {
      const moves = board.bishopMoves(r, c);
      selected = [r, c];
      legalMoves = moves;
      setMsg(moves.length ? `Ходів: ${moves.length}` : "Немає ходів");
    } else {
      setMsg("Оберіть слона");
    }
    draw();
  }

  function doBishopMove(fr, fc, tr, tc) {
    board.move(fr, fc, tr, tc);
    moveHistory.push(`B${E.posToAlg(fr, fc)}-${E.posToAlg(tr, tc)}`);
    moveCount += 1;
    selected = null;
    legalMoves = [];
    updateStats();
    draw();

    if (E.isKnightCaught(board)) {
      finishWin();
      return;
    }

    // AI turn
    aiBusy = true;
    setMsg("Кінь думає…");
    // невелика затримка, щоб UI встиг намалюватись
    setTimeout(() => {
      const mv = E.bestKnightMove(board);
      if (!mv) {
        aiBusy = false;
        finishWin();
        return;
      }
      const [kr, kc] = board.knight;
      const [ntr, ntc] = mv;
      board.move(kr, kc, ntr, ntc);
      moveHistory.push(`N${E.posToAlg(kr, kc)}-${E.posToAlg(ntr, ntc)}`);
      aiBusy = false;
      setMsg(`${E.posToAlg(kr, kc)} → ${E.posToAlg(ntr, ntc)}`);
      updateStats();
      draw();
      if (E.isKnightCaught(board)) finishWin();
    }, 80);
  }

  function finishWin() {
    state = "finished";
    if (startedAt != null) {
      elapsed += performance.now() / 1000 - startedAt;
      startedAt = null;
    }
    stopTimer();
    const score = E.parityScore(board.numBishops, moveCount, elapsed);
    setMsg("Кінь спійманий!", "win");
    updateStats();
    draw();
    showWin(score);
  }

  // ---- Actions ----
  function newGame() {
    hideWin();
    stopTimer();
    board = new E.Board(selectedLevel);
    state = "playing";
    selected = null;
    legalMoves = [];
    moveCount = 0;
    moveHistory = [];
    elapsed = 0;
    startedAt = performance.now() / 1000;
    aiBusy = false;
    setMsg("Натисніть на слона");
    updateStats();
    draw();
    startTimer();
  }

  function togglePause() {
    if (state === "playing") {
      elapsed = currentElapsed();
      startedAt = null;
      state = "paused";
      selected = null;
      legalMoves = [];
      setMsg("Пауза — натисніть «Далі»", "pause");
      stopTimer();
      updateStats();
      draw();
    } else if (state === "paused") {
      startedAt = performance.now() / 1000;
      state = "playing";
      setMsg("Гру продовжено");
      startTimer();
      updateStats();
      draw();
    }
  }

  // ---- Events ----
  canvas.addEventListener("click", onBoardPointer);
  canvas.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      onBoardPointer(e);
    },
    { passive: false }
  );

  document.getElementById("btn-new").addEventListener("click", newGame);
  document.getElementById("btn-pause").addEventListener("click", togglePause);
  document.getElementById("btn-again").addEventListener("click", newGame);
  document.getElementById("btn-close").addEventListener("click", hideWin);

  document.querySelectorAll(".lvl").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".lvl").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedLevel = parseInt(btn.dataset.n, 10);
    });
  });

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 150));

  // init
  resizeCanvas();
  setMsg("Оберіть рівень і натисніть «Нова гра»");
})();

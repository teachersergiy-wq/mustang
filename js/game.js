/**
 * Mustang Static — UI + гра (mobile-first) + рекорди
 */
(function () {
  "use strict";

  const E = window.MustangEngine;
  const R = window.MustangRecords;
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
  let state = "idle";
  let selected = null;
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
  let lastScore = null;
  let lastRecordPayload = null;
  let recordSaved = false;

  let recSrc = "local";
  let recSort = "time";
  let recLevel = 16;
  let worldCache = [];

  function setMsg(text, cls) {
    msgEl.textContent = text || "";
    msgEl.className = cls || "";
  }

  function updateStats() {
    document.getElementById("st-b").textContent = board ? board.numBishops : "—";
    document.getElementById("st-m").textContent = String(moveCount);
    document.getElementById("st-t").textContent = currentElapsed().toFixed(1);
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
    lastScore = score;
    recordSaved = false;
    const t = currentElapsed();
    const notation = E.formatGameNotation(moveHistory);
    lastRecordPayload = {
      bishops: board.numBishops,
      moves: moveCount,
      time_sec: Math.round(t * 10) / 10,
      notation: notation,
      date: new Date().toISOString().slice(0, 19).replace("T", " "),
      timestamp: Date.now() / 1000,
      score: score,
    };
    document.getElementById("win-text").textContent =
      "Слонів: " + board.numBishops + "\n" +
      "Ходів: " + moveCount + "\n" +
      "Час: " + t.toFixed(1) + " с\n" +
      (score != null ? "Score: " + score.toFixed(0) : "");
    const nameInput = document.getElementById("win-name");
    if (R) nameInput.value = R.getPlayerName() || nameInput.value || "";
    document.getElementById("win-save-status").textContent = "";
    document.getElementById("win-panel").classList.remove("hidden");
  }

  function hideWin() {
    document.getElementById("win-panel").classList.add("hidden");
  }

  async function saveRecord() {
    if (!lastRecordPayload || !R) return;
    if (recordSaved) {
      document.getElementById("win-save-status").textContent = "Уже збережено";
      return;
    }
    let name = (document.getElementById("win-name").value || "").trim();
    if (!name) name = "Гравець";
    if (name.toLowerCase() === "гість" || name.toLowerCase() === "guest") {
      document.getElementById("win-save-status").textContent =
        "Ім'я «Гість» не для світу. Введіть інше.";
      return;
    }
    R.setPlayerName(name);
    const rec = Object.assign({}, lastRecordPayload, { name: name });
    R.addLocal(rec);
    document.getElementById("win-save-status").textContent = "Збережено на пристрої…";
    const world = await R.submitWorld(rec);
    if (world && world.ok) {
      document.getElementById("win-save-status").textContent = world.duplicate
        ? "У світі вже є такий результат"
        : "Збережено на пристрої та у світі";
    } else if (!(window.MUSTANG_CONFIG && window.MUSTANG_CONFIG.APPS_SCRIPT_URL)) {
      document.getElementById("win-save-status").textContent =
        "Збережено на пристрої (світ ще не підключено)";
    } else {
      document.getElementById("win-save-status").textContent =
        "На пристрої · світ: " + (world && world.reason ? world.reason : "помилка");
    }
    recordSaved = true;
  }

  function openRecords() {
    recLevel = selectedLevel;
    buildLevelButtons();
    document.getElementById("records-panel").classList.remove("hidden");
    renderRecords();
  }

  function closeRecords() {
    document.getElementById("records-panel").classList.add("hidden");
  }

  function buildLevelButtons() {
    const wrap = document.getElementById("rec-levels");
    wrap.innerHTML = "";
    [32, 24, 16, 14, 12].forEach(function (n) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(n);
      if (n === recLevel) b.classList.add("active");
      b.addEventListener("click", function () {
        recLevel = n;
        buildLevelButtons();
        renderRecords();
      });
      wrap.appendChild(b);
    });
  }

  async function renderRecords() {
    const listEl = document.getElementById("records-list");
    const hint = document.getElementById("records-hint");
    listEl.innerHTML = '<div class="rec-empty">Завантаження…</div>';

    var source = [];
    if (recSrc === "world" && R) {
      if (!window.MUSTANG_CONFIG || !window.MUSTANG_CONFIG.APPS_SCRIPT_URL) {
        listEl.innerHTML =
          '<div class="rec-empty">Світ не підключено.<br>Додайте APPS_SCRIPT_URL у js/config.js</div>';
        hint.textContent = "";
        return;
      }
      var world = await R.fetchWorld();
      // сумісність: масив або {ok, records, error}
      if (Array.isArray(world)) {
        source = world;
        worldCache = world;
        hint.textContent = source.length
          ? ("Світ: " + source.length + " усього, для " + recLevel + " сл.: " + R.countForLevel(source, recLevel))
          : "Поки немає світових рекордів";
      } else {
        source = (world && world.records) || [];
        worldCache = source;
        if (!world || !world.ok) {
          listEl.innerHTML =
            '<div class="rec-empty">Не вдалося завантажити світ.<br>' +
            escapeHtml((world && world.error) || "невідома помилка") +
            (world && world.preview ? "<br><small>" + escapeHtml(world.preview) + "</small>" : "") +
            "</div>";
          hint.textContent = "Перевірте Apps Script і config.js";
          return;
        }
        hint.textContent = source.length
          ? ("Світ: " + source.length + " усього, для " + recLevel + " сл.: " + R.countForLevel(source, recLevel))
          : "Поки немає світових рекордів";
      }
    } else if (R) {
      source = R.loadLocal();
      hint.textContent = source.length
        ? ("Пристрій: " + source.length + " усього, для " + recLevel + " сл.: " + R.countForLevel(source, recLevel))
        : "Ще немає збережених результатів";
    }

    var sorted = R ? R.filterSort(source, recLevel, recSort, 25) : [];
    if (!sorted.length) {
      var total = source.length || 0;
      listEl.innerHTML =
        '<div class="rec-empty">Немає записів для рівня ' + recLevel +
        (total ? "<br>(усього в базі: " + total + ", оберіть інший рівень)" : "") +
        "</div>";
      return;
    }

    var myName = (R && R.getPlayerName()) || "";
    listEl.innerHTML = "";
    sorted.forEach(function (r, i) {
      var row = document.createElement("div");
      row.className = "rec-row";
      if (myName && String(r.name).toLowerCase() === myName.toLowerCase()) {
        row.classList.add("me");
      }
      row.innerHTML =
        '<span class="place">' + (i + 1) + "</span>" +
        '<span class="name">' + escapeHtml(r.name) + "</span>" +
        '<span class="val">' + R.formatValue(r, recSort) + "</span>";
      listEl.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      if (state === "playing") updateStats();
    }, 200);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function resizeCanvas() {
    var wrap = document.getElementById("board-wrap");
    var cssSize = Math.min(wrap.clientWidth, wrap.clientHeight || wrap.clientWidth, 440);
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
    var size = canvas.width / dpr;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, size, size);

    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? LIGHT : DARK;
        ctx.fillRect(margin + c * sq, margin + r * sq, sq + 0.5, sq + 0.5);
      }
    }

    if (state === "playing" && legalMoves.length) {
      for (var i = 0; i < legalMoves.length; i++) {
        var tr = legalMoves[i][0], tc = legalMoves[i][1];
        var cx = margin + tc * sq + sq / 2;
        var cy = margin + tr * sq + sq / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, sq * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = HIGHLIGHT;
        ctx.fill();
      }
    }

    if (selected && state === "playing") {
      var sr = selected[0], sc = selected[1];
      ctx.strokeStyle = SELECT;
      ctx.lineWidth = Math.max(3, sq * 0.07);
      ctx.strokeRect(margin + sc * sq + 2, margin + sr * sq + 2, sq - 4, sq - 4);
    }

    if (board && state !== "paused") {
      var pieces = board.piecesList();
      for (var j = 0; j < pieces.length; j++) {
        drawPiece(pieces[j].r, pieces[j].c, pieces[j].type);
      }
    } else if (state === "paused") {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(margin, margin, sq * 8, sq * 8);
      ctx.fillStyle = "#f0d9b5";
      ctx.font = "bold " + Math.round(sq * 0.55) + "px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ПАУЗА", margin + sq * 4, margin + sq * 4);
    }

    ctx.fillStyle = "#9ca3af";
    ctx.font = Math.max(9, Math.round(sq * 0.2)) + "px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var k = 0; k < 8; k++) {
      ctx.fillText(String.fromCharCode(97 + k), margin + k * sq + sq / 2, margin + 8 * sq + margin * 0.55);
      ctx.fillText(String(8 - k), margin * 0.38, margin + k * sq + sq / 2);
    }
  }

  function drawPiece(r, c, type) {
    var cx = margin + c * sq + sq / 2;
    var cy = margin + r * sq + sq / 2;
    var radius = sq * 0.34;
    if (type === E.BISHOP) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#f5f0e6";
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#1c1917";
      ctx.font = "bold " + Math.round(sq * 0.4) + "px system-ui,sans-serif";
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
      ctx.font = "bold " + Math.round(sq * 0.4) + "px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("N", cx, cy + 1);
    }
  }

  function canvasCell(evt) {
    var rect = canvas.getBoundingClientRect();
    var x, y;
    if (evt.changedTouches && evt.changedTouches.length) {
      x = evt.changedTouches[0].clientX - rect.left;
      y = evt.changedTouches[0].clientY - rect.top;
    } else {
      x = evt.clientX - rect.left;
      y = evt.clientY - rect.top;
    }
    var scaleX = canvas.width / dpr / rect.width;
    var scaleY = canvas.height / dpr / rect.height;
    x *= scaleX;
    y *= scaleY;
    return {
      c: Math.floor((x - margin) / sq),
      r: Math.floor((y - margin) / sq),
    };
  }

  function onBoardPointer(evt) {
    evt.preventDefault();
    if (state !== "playing" || aiBusy || !board) return;
    var cell = canvasCell(evt);
    var r = cell.r, c = cell.c;
    if (r < 0 || r > 7 || c < 0 || c > 7) return;

    if (selected) {
      var isLegal = legalMoves.some(function (m) { return m[0] === r && m[1] === c; });
      if (isLegal) {
        doBishopMove(selected[0], selected[1], r, c);
        return;
      }
    }

    selected = null;
    legalMoves = [];
    if (board.grid[r][c] === E.BISHOP) {
      var moves = board.bishopMoves(r, c);
      selected = [r, c];
      legalMoves = moves;
      setMsg(moves.length ? "Ходів: " + moves.length : "Немає ходів");
    } else {
      setMsg("Оберіть слона");
    }
    draw();
  }

  function doBishopMove(fr, fc, tr, tc) {
    board.move(fr, fc, tr, tc);
    moveHistory.push("B" + E.posToAlg(fr, fc) + "-" + E.posToAlg(tr, tc));
    moveCount += 1;
    selected = null;
    legalMoves = [];
    updateStats();
    draw();

    if (E.isKnightCaught(board)) {
      finishWin();
      return;
    }

    aiBusy = true;
    setMsg("Кінь думає…");
    setTimeout(function () {
      var mv = E.bestKnightMove(board);
      if (!mv) {
        aiBusy = false;
        finishWin();
        return;
      }
      var kr = board.knight[0], kc = board.knight[1];
      var ntr = mv[0], ntc = mv[1];
      board.move(kr, kc, ntr, ntc);
      moveHistory.push("N" + E.posToAlg(kr, kc) + "-" + E.posToAlg(ntr, ntc));
      aiBusy = false;
      setMsg(E.posToAlg(kr, kc) + " → " + E.posToAlg(ntr, ntc));
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
    var score = E.parityScore(board.numBishops, moveCount, elapsed);
    setMsg("Кінь спійманий!", "win");
    updateStats();
    draw();
    showWin(score);
  }

  function newGame() {
    hideWin();
    closeRecords();
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
    lastRecordPayload = null;
    recordSaved = false;
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

  canvas.addEventListener("click", onBoardPointer);
  canvas.addEventListener("touchend", function (e) {
    e.preventDefault();
    onBoardPointer(e);
  }, { passive: false });

  document.getElementById("btn-new").addEventListener("click", newGame);
  document.getElementById("btn-pause").addEventListener("click", togglePause);
  document.getElementById("btn-again").addEventListener("click", newGame);
  document.getElementById("btn-close").addEventListener("click", hideWin);
  document.getElementById("btn-save-record").addEventListener("click", saveRecord);
  document.getElementById("btn-records").addEventListener("click", openRecords);
  document.getElementById("btn-records-close").addEventListener("click", closeRecords);

  document.querySelectorAll(".lvl").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".lvl").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      selectedLevel = parseInt(btn.dataset.n, 10);
    });
  });

  document.querySelectorAll(".tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      recSrc = btn.dataset.src;
      renderRecords();
    });
  });

  document.querySelectorAll(".sort").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".sort").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      recSort = btn.dataset.sort;
      renderRecords();
    });
  });

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", function () { setTimeout(resizeCanvas, 150); });

  resizeCanvas();
  setMsg("Оберіть рівень і натисніть «Нова гра»");
})();

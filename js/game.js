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

  const SAVE_KEY = "mustang_web_quicksave_v1";
  let undoStack = [];
  let undoUsed = false;
  let initialKnight = null; // [r,c] at game start
  let initialNumBishops = 16;
  let replayMoves = [];
  let replayIndex = 0;
  let replayTimer = null;
  let replayActive = false;
  let replayMeta = null;
  let gameBoardBackup = null;

  function boardToData(b) {
    if (!b) return null;
    return {
      numBishops: b.numBishops,
      grid: b.grid.map(function (row) { return row.slice(); }),
      bishops: b.bishops.map(function (x) { return [x[0], x[1]]; }),
      knight: b.knight ? [b.knight[0], b.knight[1]] : null,
    };
  }

  function boardFromData(data) {
    var b = new E.Board(data.numBishops || 16);
    // clear random placement
    b.grid = data.grid.map(function (row) { return row.slice(); });
    b.bishops = (data.bishops || []).map(function (x) { return [x[0], x[1]]; });
    b.knight = data.knight ? [data.knight[0], data.knight[1]] : null;
    b.numBishops = data.numBishops || b.bishops.length;
    return b;
  }

  function snapshotState() {
    return {
      board: boardToData(board),
      moveCount: moveCount,
      moveHistory: moveHistory.slice(),
      elapsed: currentElapsed(),
      selectedLevel: selectedLevel,
    };
  }

  function restoreState(snap) {
    if (!snap || !snap.board) return;
    board = boardFromData(snap.board);
    moveCount = parseInt(snap.moveCount, 10) || 0;
    moveHistory = Array.isArray(snap.moveHistory) ? snap.moveHistory.slice() : [];
    elapsed = Number(snap.elapsed) || 0;
    if (snap.selectedLevel) selectedLevel = parseInt(snap.selectedLevel, 10);
    selected = null;
    legalMoves = [];
    aiBusy = false;
  }

  function pushUndo() {
    if (!board) return;
    undoStack.push(snapshotState());
    if (undoStack.length > 60) undoStack.shift();
  }

  function undoMove() {
    if (aiBusy) {
      setMsg("Зачекайте ходу коня");
      return;
    }
    if (!undoStack.length) {
      setMsg("Немає ходів для відміни");
      return;
    }
    if (state === "finished") {
      hideWin();
    }
    if (state !== "playing" && state !== "paused" && state !== "finished") {
      setMsg("Немає активної гри");
      return;
    }
    var snap = undoStack.pop();
    undoUsed = true;
    restoreState(snap);
    // після undo — можна грати далі
    if (state === "finished") {
      state = "playing";
      startedAt = performance.now() / 1000;
      startTimer();
    } else if (state === "playing") {
      // час продовжується; elapsed вже з snapshot
      startedAt = performance.now() / 1000;
    }
    setMsg("Хід відмінено");
    updateStats();
    updateSaveButtons();
    draw();
    saveGame(true);
  }

  function hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch (_) {
      return false;
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (_) {}
    updateSaveButtons();
  }

  function saveGame(silent) {
    if (!board || (state !== "playing" && state !== "paused")) {
      if (!silent) setMsg("Немає активної гри для збереження");
      return false;
    }
    var payload = {
      version: 1,
      savedAt: Date.now(),
      selectedLevel: selectedLevel,
      numBishops: board.numBishops,
      board: boardToData(board),
      moveCount: moveCount,
      moveHistory: moveHistory.slice(),
      elapsed: currentElapsed(),
      state: state === "paused" ? "paused" : "playing",
      undoStack: undoStack.slice(-30),
      undoUsed: !!undoUsed,
      initialKnight: initialKnight,
      initialNumBishops: initialNumBishops,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      if (!silent) setMsg("Партію збережено");
      updateSaveButtons();
      return true;
    } catch (e) {
      if (!silent) setMsg("Не вдалося зберегти");
      return false;
    }
  }

  function loadGame() {
    var raw;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch (_) {
      raw = null;
    }
    if (!raw) {
      setMsg("Немає збереженої партії");
      return;
    }
    var data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      setMsg("Збереження пошкоджене");
      clearSave();
      return;
    }
    if (!data || !data.board) {
      setMsg("Збереження порожнє");
      clearSave();
      return;
    }

    hideWin();
    closeRecords();
    stopTimer();

    selectedLevel = parseInt(data.selectedLevel || data.numBishops || 16, 10);
    document.querySelectorAll(".lvl").forEach(function (btn) {
      btn.classList.toggle("active", parseInt(btn.dataset.n, 10) === selectedLevel);
    });

    board = boardFromData(data.board);
    moveCount = parseInt(data.moveCount, 10) || 0;
    moveHistory = Array.isArray(data.moveHistory) ? data.moveHistory.slice() : [];
    elapsed = Number(data.elapsed) || 0;
    selected = null;
    legalMoves = [];
    aiBusy = false;
    lastRecordPayload = null;
    recordSaved = false;
    undoStack = Array.isArray(data.undoStack) ? data.undoStack : [];
    undoUsed = !!data.undoUsed || undoStack.length > 0;
    initialKnight = data.initialKnight || (board.knight ? [board.knight[0], board.knight[1]] : null);
    initialNumBishops = data.initialNumBishops || board.numBishops;

    // після завантаження — на паузі, щоб час не тікав одразу
    state = "paused";
    startedAt = null;
    setMsg("Збережену партію завантажено — натисніть «Далі»", "pause");
    updateStats();
    updateSaveButtons();
    draw();
  }

  function updateSaveButtons() {
    var btnSave = document.getElementById("btn-save");
    var btnCont = document.getElementById("btn-continue");
    var btnUndo = document.getElementById("btn-undo");
    if (btnSave) {
      btnSave.disabled = !(board && (state === "playing" || state === "paused"));
    }
    if (btnCont) {
      btnCont.disabled = !hasSave();
    }
    if (btnUndo) {
      btnUndo.disabled = !(
        undoStack.length > 0 &&
        !aiBusy &&
        board &&
        (state === "playing" || state === "paused" || state === "finished")
      );
    }
    var btnNot = document.getElementById("btn-notation");
    if (btnNot) {
      btnNot.disabled = !(moveHistory && moveHistory.length > 0);
    }
  }


  function orderedBishopSquares(n) {
    var ordered = [];
    for (var r = 7; r >= 0; r--) {
      for (var c = 0; c < 8; c++) ordered.push([r, c]);
    }
    n = Math.max(1, Math.min(n, 63));
    return ordered.slice(0, n);
  }

  function algToPos(alg) {
    if (!alg || alg.length < 2) return null;
    var c = alg.charCodeAt(0) - 97;
    var r = 8 - parseInt(alg.charAt(1), 10);
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    return [r, c];
  }

  function parseHistoryToken(tok) {
    // "Be2-b5" or "Ne4-d6"
    tok = String(tok || "").trim();
    var m = tok.match(/^([BN])([a-h][1-8])-([a-h][1-8])$/i);
    if (!m) return null;
    return { piece: m[1].toUpperCase(), from: algToPos(m[2]), to: algToPos(m[3]) };
  }

  function flattenNotationToTokens(notationOrHistory) {
    if (Array.isArray(notationOrHistory)) {
      return notationOrHistory.slice();
    }
    var text = String(notationOrHistory || "");
    var tokens = [];
    // tokens like B..-.. or N..-..
    var re = /[BN][a-h][1-8]-[a-h][1-8]/gi;
    var m;
    while ((m = re.exec(text))) tokens.push(m[0]);
    return tokens;
  }

  function buildBoardAtStart(numBishops, knightRC) {
    var b = new E.Board(numBishops);
    // overwrite placement
    b.grid = Array.from({ length: 8 }, function () { return Array(8).fill(E.EMPTY); });
    b.bishops = orderedBishopSquares(numBishops);
    for (var i = 0; i < b.bishops.length; i++) {
      var sq = b.bishops[i];
      b.grid[sq[0]][sq[1]] = E.BISHOP;
    }
    var kr = knightRC[0], kc = knightRC[1];
    // if occupied, find free
    if (b.grid[kr][kc] !== E.EMPTY) {
      outer: for (var r = 0; r < 8; r++) {
        for (var c = 0; c < 8; c++) {
          if (b.grid[r][c] === E.EMPTY) {
            kr = r; kc = c; break outer;
          }
        }
      }
    }
    b.knight = [kr, kc];
    b.grid[kr][kc] = E.KNIGHT;
    b.numBishops = numBishops;
    return b;
  }

  function applyToken(b, token) {
    var mv = parseHistoryToken(token);
    if (!mv || !mv.from || !mv.to) return false;
    var fr = mv.from[0], fc = mv.from[1], tr = mv.to[0], tc = mv.to[1];
    if (b.grid[fr][fc] === E.EMPTY) return false;
    b.move(fr, fc, tr, tc);
    return true;
  }

  function openNotationPanel(opts) {
    opts = opts || {};
    var tokens = flattenNotationToTokens(opts.history || opts.notation || moveHistory);
    var nb = parseInt(opts.bishops != null ? opts.bishops : (board ? board.numBishops : selectedLevel), 10);
    var k0 = opts.knightStart || initialKnight;
    if (!k0 && board && board.knight && tokens.length === 0) {
      k0 = [board.knight[0], board.knight[1]];
    }
    // якщо стартового коня немає — спробувати з першого N-ходу (наближено неточно),
    // краще вимагати knightStart; для поточної гри він завжди є
    if (!k0) {
      for (var i = 0; i < tokens.length; i++) {
        var t = parseHistoryToken(tokens[i]);
        if (t && t.piece === "N") {
          // не стартова позиція; для старих рекордів покажемо лише текст
          break;
        }
      }
    }

    replayMoves = tokens;
    replayIndex = tokens.length; // show final by default
    replayMeta = {
      bishops: nb,
      knightStart: k0,
      name: opts.name || "",
      canReplay: !!(k0 && tokens.length),
    };

    var text = opts.notation || (E.formatGameNotation(tokens) || "(порожньо)");
    document.getElementById("notation-text").textContent = text;
    var meta = [];
    if (opts.name) meta.push(opts.name);
    meta.push(nb + " сл.");
    meta.push(tokens.length + " півходів");
    if (!replayMeta.canReplay) meta.push("replay недоступний (немає стартової позиції)");
    document.getElementById("notation-meta").textContent = meta.join(" · ");

    stopReplayTimer();
    replayActive = true;
    // pause live game drawing interference
    if (state === "playing") {
      elapsed = currentElapsed();
      startedAt = null;
      state = "paused";
      stopTimer();
    }

    gameBoardBackup = null;
    if (replayMeta.canReplay) {
      showReplayPosition(tokens.length);
    } else {
      document.getElementById("notation-step").textContent = "Лише текст нотації";
    }

    hideWin();
    closeRecords();
    document.getElementById("notation-panel").classList.remove("hidden");
  }

  function closeNotationPanel() {
    stopReplayTimer();
    document.getElementById("notation-panel").classList.add("hidden");
    replayActive = false;
    document.getElementById("btn-rep-play").textContent = "▶";
    if (gameBoardBackup) {
      board = gameBoardBackup;
      gameBoardBackup = null;
    }
    selected = null;
    legalMoves = [];
    if (board && (state === "paused" || state === "finished" || state === "playing")) {
      updateStats();
      draw();
    }
  }

  function stopReplayTimer() {
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
    }
  }

  function showReplayPosition(idx) {
    if (!replayMeta || !replayMeta.canReplay) return;
    idx = Math.max(0, Math.min(idx, replayMoves.length));
    replayIndex = idx;
    if (gameBoardBackup == null && board) {
      gameBoardBackup = board;
    }
    var b = buildBoardAtStart(replayMeta.bishops, replayMeta.knightStart);
    for (var i = 0; i < idx; i++) {
      applyToken(b, replayMoves[i]);
    }
    board = b;
    selected = null;
    legalMoves = [];
    draw();

    document.getElementById("notation-step").textContent =
      "Хід " + idx + " / " + replayMoves.length +
      (idx > 0 ? " · " + replayMoves[idx - 1] : " · старт");
  }

  function repStart() { stopReplayTimer(); showReplayPosition(0); }
  function repEnd() { stopReplayTimer(); showReplayPosition(replayMoves.length); }
  function repPrev() { stopReplayTimer(); showReplayPosition(replayIndex - 1); }
  function repNext() { stopReplayTimer(); showReplayPosition(replayIndex + 1); }
  function repPlay() {
    if (!replayMeta || !replayMeta.canReplay) return;
    if (replayTimer) {
      stopReplayTimer();
      document.getElementById("btn-rep-play").textContent = "▶";
      return;
    }
    if (replayIndex >= replayMoves.length) showReplayPosition(0);
    document.getElementById("btn-rep-play").textContent = "❚❚";
    replayTimer = setInterval(function () {
      if (replayIndex >= replayMoves.length) {
        stopReplayTimer();
        document.getElementById("btn-rep-play").textContent = "▶";
        return;
      }
      showReplayPosition(replayIndex + 1);
    }, 700);
  }

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
    updateSaveButtons();
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
      knight_start: initialKnight ? E.posToAlg(initialKnight[0], initialKnight[1]) : "",
    };
    document.getElementById("win-text").textContent =
      "Слонів: " + board.numBishops + "\n" +
      "Ходів: " + moveCount + "\n" +
      "Час: " + t.toFixed(1) + " с\n" +
      (score != null ? "Score: " + score.toFixed(0) : "");
    const nameInput = document.getElementById("win-name");
    if (R) {
      var pn = (R.getPlayerName() || nameInput.value || "").replace(/\*+$/, "");
      nameInput.value = pn;
    }
    document.getElementById("win-save-status").textContent = undoUsed
      ? "Було відміни ходів — у рекорді ім'я буде з * (курсив)"
      : "";
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
    // прибираємо зірочку з поля вводу, додамо службово
    name = name.replace(/\*+$/, "").trim() || "Гравець";
    if (name.toLowerCase() === "гість" || name.toLowerCase() === "guest") {
      document.getElementById("win-save-status").textContent =
        "Ім'я «Гість» не для світу. Введіть інше.";
      return;
    }
    R.setPlayerName(name);
    if (undoUsed && !name.endsWith("*")) {
      name = name + "*";
    }
    const rec = Object.assign({}, lastRecordPayload, { name: name, undid: !!undoUsed });
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
      var rn = String(r.name || "").replace(/\*+$/, "").toLowerCase();
      var mn = String(myName || "").replace(/\*+$/, "").toLowerCase();
      if (mn && rn === mn) {
        row.classList.add("me");
      }
      var displayName = String(r.name || "");
      var undid = !!r.undid || /\*$/.test(displayName);
      var nameHtml = escapeHtml(displayName);
      if (undid) {
        nameHtml = '<em class="undid-name">' + nameHtml + "</em>";
        row.classList.add("undid");
      }
      row.innerHTML =
        '<span class="place">' + (i + 1) + "</span>" +
        '<span class="name">' + nameHtml + "</span>" +
        '<span class="val">' + R.formatValue(r, recSort) + "</span>";
      row.addEventListener("click", function () {
        var ks = null;
        if (r.knight_start) ks = algToPos(r.knight_start);
        openNotationPanel({
          notation: r.notation || "",
          history: flattenNotationToTokens(r.notation || ""),
          bishops: r.bishops,
          knightStart: ks,
          name: r.name || "",
        });
      });
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
    pushUndo();
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
    clearSave();
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
    clearSave();
    undoStack = [];
    undoUsed = false;
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
    initialKnight = board.knight ? [board.knight[0], board.knight[1]] : null;
    initialNumBishops = board.numBishops;
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
      saveGame(true);
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
  document.getElementById("btn-save").addEventListener("click", function () { saveGame(false); });
  document.getElementById("btn-continue").addEventListener("click", loadGame);
  document.getElementById("btn-undo").addEventListener("click", undoMove);
  document.getElementById("btn-notation").addEventListener("click", function () {
    openNotationPanel({
      history: moveHistory,
      notation: E.formatGameNotation(moveHistory),
      bishops: board ? board.numBishops : selectedLevel,
      knightStart: initialKnight,
    });
  });
  document.getElementById("btn-win-notation").addEventListener("click", function () {
    openNotationPanel({
      history: moveHistory,
      notation: lastRecordPayload && lastRecordPayload.notation
        ? lastRecordPayload.notation
        : E.formatGameNotation(moveHistory),
      bishops: board ? board.numBishops : selectedLevel,
      knightStart: initialKnight,
    });
  });
  document.getElementById("btn-notation-close").addEventListener("click", closeNotationPanel);
  document.getElementById("btn-rep-start").addEventListener("click", repStart);
  document.getElementById("btn-rep-prev").addEventListener("click", repPrev);
  document.getElementById("btn-rep-play").addEventListener("click", repPlay);
  document.getElementById("btn-rep-next").addEventListener("click", repNext);
  document.getElementById("btn-rep-end").addEventListener("click", repEnd);
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

  window.addEventListener("beforeunload", function () {
    if (board && (state === "playing" || state === "paused")) {
      saveGame(true);
    }
  });

  // автозбереження кожні 30 с під час гри
  setInterval(function () {
    if (board && state === "playing") saveGame(true);
  }, 30000);

  resizeCanvas();
  updateSaveButtons();
  if (hasSave()) {
    setMsg("Є збережена партія — «Продовжити»");
  } else {
    setMsg("Оберіть рівень і натисніть «Нова гра»");
  }
})();

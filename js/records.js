/**
 * Рекорди: localStorage + Google Apps Script (як у Mustang 24.6)
 */
(function (global) {
  "use strict";

  const LOCAL_KEY = "mustang_web_records_v1";
  const NAME_KEY = "mustang_web_player_name";

  function cfg() {
    return global.MUSTANG_CONFIG || {};
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      const data = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      return data
        .map(normalizeRecord)
        .filter((r) => r.bishops >= 1 && r.bishops <= 32 && r.moves > 0);
    } catch (_) {
      return [];
    }
  }

  function saveLocal(list) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-200)));
    } catch (_) {}
  }

  function getPlayerName() {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function setPlayerName(name) {
    try {
      localStorage.setItem(NAME_KEY, String(name || "").trim());
    } catch (_) {}
  }

  function recKey(r) {
    return [
      String(r.name || "").toLowerCase(),
      r.bishops,
      r.moves,
      Math.round(Number(r.time_sec) * 10) / 10,
    ].join("|");
  }

  function normalizeRecord(record) {
    return {
      name: String(record.name || "Гравець").trim(),
      bishops: parseInt(record.bishops, 10),
      moves: parseInt(record.moves, 10),
      time_sec: Math.round(Number(record.time_sec) * 10) / 10,
      notation: String(record.notation || ""),
      date: String(record.date || ""),
      timestamp: Number(record.timestamp) || Date.now() / 1000,
      score: record.score,
      knight_start: String(record.knight_start || ""),
      undid: !!record.undid || /\*$/.test(String(record.name || "")),
    };
  }

  function addLocal(record) {
    const list = loadLocal();
    const rec = normalizeRecord(record);
    const k = recKey(rec);
    if (list.some((x) => recKey(normalizeRecord(x)) === k)) return list;
    list.push(rec);
    saveLocal(list);
    return list;
  }

  async function submitWorld(record) {
    const url = (cfg().APPS_SCRIPT_URL || "").trim();
    if (!url) return { ok: false, reason: "no_url" };

    const rec = normalizeRecord(record);
    const payload = {
      secret: cfg().APPS_SCRIPT_SECRET || "mustang_secret_2026",
      name: rec.name,
      bishops: rec.bishops,
      moves: rec.moves,
      time_sec: rec.time_sec,
      notation: rec.notation || "",
      date: rec.date,
      timestamp: rec.timestamp,
      knight_start: rec.knight_start || "",
    };

    try {
      // text/plain уникає preflight CORS у багатьох випадках Apps Script
      const res = await fetch(url, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      try {
        var parsed = JSON.parse(text);
        if (parsed && parsed.ok === false) {
          return { ok: false, reason: parsed.error || "rejected" };
        }
        return parsed;
      } catch (_) {
        return { ok: true, raw: text.slice(0, 200) };
      }
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }

  async function fetchWorld() {
    const url = (cfg().APPS_SCRIPT_URL || "").trim();
    if (!url) {
      return { ok: false, records: [], error: "no_url", total: 0 };
    }

    const endpoint = url.replace(/\/+$/, "") + "?action=get_records&_ts=" + Date.now();
    try {
      const res = await fetch(endpoint, {
        method: "GET",
        mode: "cors",
        redirect: "follow",
        credentials: "omit",
        cache: "no-store",
      });
      const text = await res.text();
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return {
          ok: false,
          records: [],
          error: "Відповідь не JSON (status " + res.status + ")",
          total: 0,
          preview: String(text).slice(0, 100),
        };
      }

      var list = [];
      if (data && data.ok && Array.isArray(data.records)) list = data.records;
      else if (Array.isArray(data)) list = data;
      else if (data && Array.isArray(data.data)) list = data.data;
      else {
        return {
          ok: false,
          records: [],
          error: "Невідомий формат відповіді",
          total: 0,
          preview: JSON.stringify(data).slice(0, 100),
        };
      }

      list = list
        .map(function (r) {
          // підтримка і об'єктів, і масивів-рядків
          if (Array.isArray(r)) {
            return normalizeRecord({
              name: r[0],
              bishops: r[1],
              moves: r[2],
              time_sec: r[3],
              notation: r[4],
              date: r[5],
              timestamp: r[6],
            });
          }
          return normalizeRecord(r);
        })
        .filter(function (r) {
          return r.name && r.bishops >= 1 && r.bishops <= 32 && r.moves > 0;
        });

      return { ok: true, records: list, error: "", total: list.length };
    } catch (err) {
      return {
        ok: false,
        records: [],
        error: "Мережа/CORS: " + String(err),
        total: 0,
      };
    }
  }

  function filterSort(records, bishops, sortBy, limit) {
    const bWant = parseInt(bishops, 10);
    let list = (records || []).filter((r) => {
      var b = parseInt(r.bishops, 10);
      if (isNaN(b)) b = parseInt(String(r.bishops).replace(",", "."), 10);
      return b === bWant;
    });

    const weight = 15;
    if (sortBy === "moves") {
      list.sort((a, b) => Number(a.moves) - Number(b.moves) || Number(a.time_sec) - Number(b.time_sec));
    } else if (sortBy === "balance") {
      list.sort((a, b) => {
        const ea = Number(a.moves) + Number(a.time_sec) / weight;
        const eb = Number(b.moves) + Number(b.time_sec) / weight;
        return ea - eb;
      });
    } else {
      list.sort((a, b) => Number(a.time_sec) - Number(b.time_sec) || Number(a.moves) - Number(b.moves));
    }
    return list.slice(0, limit || cfg().TOP_LIMIT || 25);
  }

  function formatValue(r, sortBy) {
    if (sortBy === "moves") return String(r.moves);
    if (sortBy === "balance") {
      const e = Number(r.moves) + Number(r.time_sec) / 15;
      return e.toFixed(1);
    }
    return Number(r.time_sec).toFixed(1) + " с";
  }

  function countForLevel(records, bishops) {
    var bWant = parseInt(bishops, 10);
    return (records || []).filter(function (r) {
      return parseInt(r.bishops, 10) === bWant;
    }).length;
  }

  global.MustangRecords = {
    loadLocal,
    addLocal,
    getPlayerName,
    setPlayerName,
    submitWorld,
    fetchWorld,
    filterSort,
    formatValue,
    countForLevel,
    normalizeRecord,
  };
})(typeof window !== "undefined" ? window : globalThis);

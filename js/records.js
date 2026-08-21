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
      return Array.isArray(data) ? data : [];
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

  function addLocal(record) {
    const list = loadLocal();
    const k = recKey(record);
    if (list.some((x) => recKey(x) === k)) return list;
    list.push(record);
    saveLocal(list);
    return list;
  }

  async function submitWorld(record) {
    const url = (cfg().APPS_SCRIPT_URL || "").trim();
    if (!url) return { ok: false, reason: "no_url" };

    const payload = {
      secret: cfg().APPS_SCRIPT_SECRET || "mustang_secret_2026",
      name: record.name,
      bishops: record.bishops,
      moves: record.moves,
      time_sec: record.time_sec,
      notation: record.notation || "",
      date: record.date,
      timestamp: record.timestamp,
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
        return JSON.parse(text);
      } catch (_) {
        return { ok: true, raw: text.slice(0, 200) };
      }
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }

  async function fetchWorld() {
    const url = (cfg().APPS_SCRIPT_URL || "").trim();
    if (!url) return [];

    try {
      const res = await fetch(url + "?action=get_records&_ts=" + Date.now(), {
        method: "GET",
        mode: "cors",
      });
      const data = await res.json();
      if (data && data.ok && Array.isArray(data.records)) return data.records;
      if (Array.isArray(data)) return data;
      return [];
    } catch (_) {
      return [];
    }
  }

  function filterSort(records, bishops, sortBy, limit) {
    let list = (records || []).filter((r) => {
      try {
        return Number(r.bishops) === Number(bishops);
      } catch (_) {
        return false;
      }
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

  global.MustangRecords = {
    loadLocal,
    addLocal,
    getPlayerName,
    setPlayerName,
    submitWorld,
    fetchWorld,
    filterSort,
    formatValue,
  };
})(typeof window !== "undefined" ? window : globalThis);

/**
 * Mustang Web — Google Apps Script
 *
 * 1. Створіть Google Таблицю
 * 2. Розширення → Apps Script → вставте цей код
 * 3. Розгорнути → Нове розгортання → Вебзастосунок
 *    - Виконувати як: Я
 *    - Хто має доступ: Усі
 * 4. Скопіюйте URL вебзастосунку в js/config.js (APPS_SCRIPT_URL)
 *
 * Аркуш "records": name | bishops | moves | time_sec | notation | date | timestamp
 */

var SECRET = "mustang_secret_2026";
var SHEET_NAME = "records";

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "get_records";
    if (action === "get_records") {
      return jsonOut_({ ok: true, records: readRecords_() });
    }
    return jsonOut_({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    // також підтримка form-urlencoded
    if (e && e.parameter && e.parameter.name) {
      body = e.parameter;
    }

    var secret = String(body.secret || "");
    if (secret !== SECRET) {
      return jsonOut_({ ok: false, error: "forbidden" });
    }

    var name = String(body.name || "").trim();
    if (!name || name.toLowerCase() === "гість" || name.toLowerCase() === "guest") {
      return jsonOut_({ ok: false, error: "invalid name" });
    }

    var bishops = parseInt(body.bishops, 10);
    var moves = parseInt(body.moves, 10);
    var timeSec = parseFloat(body.time_sec);
    if (!(bishops >= 1 && bishops <= 32) || !(moves > 0) || !(timeSec >= 0)) {
      return jsonOut_({ ok: false, error: "invalid data" });
    }

    // простий античіт: занадто швидко для кількості ходів
    if (timeSec < moves * 0.3) {
      return jsonOut_({ ok: false, error: "suspicious timing" });
    }

    var notation = String(body.notation || "");
    var date = String(body.date || Utilities.formatDate(new Date(), "Europe/Kyiv", "yyyy-MM-dd HH:mm:ss"));
    var timestamp = parseFloat(body.timestamp) || Date.now() / 1000;

    var sheet = getSheet_();
    // дублікат?
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (
        String(row[0]).toLowerCase() === name.toLowerCase() &&
        Number(row[1]) === bishops &&
        Number(row[2]) === moves &&
        Math.abs(Number(row[3]) - timeSec) < 0.15
      ) {
        return jsonOut_({ ok: true, duplicate: true });
      }
    }

    sheet.appendRow([name, bishops, moves, timeSec, notation, date, timestamp]);
    return jsonOut_({ ok: true, duplicate: false });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["name", "bishops", "moves", "time_sec", "notation", "date", "timestamp"]);
  }
  return sheet;
}

function readRecords_() {
  var sheet = getSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var out = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;
    out.push({
      name: String(row[0]),
      bishops: Number(row[1]),
      moves: Number(row[2]),
      time_sec: Number(row[3]),
      notation: String(row[4] || ""),
      date: String(row[5] || ""),
      timestamp: Number(row[6] || 0),
    });
  }
  return out;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

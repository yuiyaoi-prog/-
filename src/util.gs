/**
 * 共通ユーティリティ
 */

/**
 * 表記揺れを吸収するための正規化。
 *   ・全角英数 → 半角
 *   ・半角/全角スペースを除去
 *   ・大文字化
 *
 * これにより「撮影_よし子先生 Podcast」と別名「よし子先生Podcast」が一致する。
 */
function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]/g, '')
    .toUpperCase();
}

/** D列のカンマ区切り文字列を別名の配列に分解する（全角カンマ・読点も区切りとして扱う） */
function parseAliases(rawKeywords) {
  return String(rawKeywords || '')
    .split(/[,，、]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** Date → 「8/5」形式 */
function formatShortDate(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'M/d');
}

/** 時刻を切り落として日付だけの Date を返す */
function toDateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * セルの既存値に新しい日付を統合する。
 *
 *   ・既存の手動入力値は消さずに残す（決定済み方針：上書きせず統合）
 *   ・同じ日付は重複させない
 *   ・「8/5, 8/20」のように日付順に並べる
 *   ・「2026/08/05」のような完全形式は「8/5」に正規化してから統合する
 *   ・日付として解釈できないメモ書きは、末尾にそのまま残す
 *
 * @param {string} existingDisplay セルの表示値（getDisplayValue の結果）
 * @param {string[]} newDates 追加したい「M/d」形式の日付
 * @return {string} 書き戻す文字列
 */
function mergeDateCell(existingDisplay, newDates) {
  const tokens = String(existingDisplay || '')
    .split(/[,，、]/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(canonicalizeDateToken);

  const seen = {};
  const ordered = [];
  tokens.concat(newDates).forEach(token => {
    if (!token) return;
    if (seen[token]) return;
    seen[token] = true;
    ordered.push(token);
  });

  const isShortDate = t => /^\d{1,2}\/\d{1,2}$/.test(t);
  const dates = ordered.filter(isShortDate);
  const others = ordered.filter(t => !isShortDate(t));

  dates.sort((a, b) => {
    const av = a.split('/').map(Number);
    const bv = b.split('/').map(Number);
    return av[0] - bv[0] || av[1] - bv[1];
  });

  return dates.concat(others).join(', ');
}

/** 「2026/08/05」「2026-08-05」を「8/5」に寄せる。それ以外はそのまま返す */
function canonicalizeDateToken(token) {
  const m = String(token).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  const s = String(token).match(/^(\d{1,2})\/(\d{1,2})$/);
  if (s) return `${Number(s[1])}/${Number(s[2])}`;
  return token;
}

/**
 * 月別シートからクライアント一覧を読み取る。
 * 記入例行（▼ / （例） 始まり）と空行はスキップする。
 *
 * @return {Array<{row:number, name:string, pm:string, director:string, aliases:string[]}>}
 */
function readClients(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.DATA_START_ROW) return [];

  const numRows = lastRow - CONFIG.DATA_START_ROW + 1;
  const values = sheet
    .getRange(CONFIG.DATA_START_ROW, 1, numRows, CONFIG.COL.KEYWORDS)
    .getDisplayValues();

  const clients = [];
  values.forEach((rowValues, i) => {
    const name = String(rowValues[CONFIG.COL.CLIENT_NAME - 1] || '').trim();
    if (!name) return;
    if (name.indexOf('▼') === 0) return;
    if (name.indexOf('（例）') === 0) return;

    clients.push({
      row: CONFIG.DATA_START_ROW + i,
      name: name,
      pm: String(rowValues[CONFIG.COL.PM - 1] || '').trim(),
      director: String(rowValues[CONFIG.COL.DIRECTOR - 1] || '').trim(),
      aliases: parseAliases(rowValues[CONFIG.COL.KEYWORDS - 1]),
    });
  });
  return clients;
}

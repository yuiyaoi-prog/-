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
 * 「8月」というシート名から、それが何年の8月かを決める。
 *
 * 今日に一番近い年を選ぶ。同じ距離なら未来側を優先する。
 * これにより、12月時点で「1月」シートを見たとき翌年の1月として扱える。
 */
function resolveYearForMonth(month, today) {
  const base = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  let best = today.getFullYear();
  let bestDiff = Infinity;
  [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].forEach(year => {
    const diff = Math.abs(new Date(year, month - 1, 1).getTime() - base);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = year;
    }
  });
  return best;
}

/** 「2026/08/05」「2026-08-05」を「8/5」に寄せる。それ以外はそのまま返す */
function canonicalizeDateToken(token) {
  const full = String(token).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (full) return `${Number(full[2])}/${Number(full[3])}`;
  const short = String(token).match(/^(\d{1,2})\/(\d{1,2})$/);
  if (short) return `${Number(short[1])}/${Number(short[2])}`;
  return token;
}

function isShortDateToken(token) {
  return /^\d{1,2}\/\d{1,2}$/.test(token);
}

/**
 * 「8/5」というトークンを、シートの年月を手がかりに Date へ変換する。
 * 例：12月シートの「1/10」は翌年の1月10日として扱う。
 */
function shortDateToDate(token, sheetYear, sheetMonth) {
  const parts = token.split('/').map(Number);
  const month = parts[0];
  const day = parts[1];
  const year = month < sheetMonth - 6 ? sheetYear + 1 : sheetYear;
  return new Date(year, month - 1, day);
}

/**
 * セルの既存値に新しい日付を統合する。
 *
 *   ・既存の手動入力値は消さずに残す
 *   ・同じ日付は重複させない
 *   ・「8/5, 8/20」のように日付順に並べる
 *   ・「2026/08/05」のような完全形式は「8/5」に正規化してから統合する
 *   ・日付として解釈できないメモ書きは、末尾にそのまま残す
 *   ・CONFIG.PRUNE_PAST_DATES が true なら、過去日になった日付は取り除く
 *     （メモ書きは取り除かない）
 *
 * @param {string} existingDisplay セルの表示値（getDisplayValue の結果）
 * @param {string[]} newDates 追加したい「M/d」形式の日付
 * @param {{year:number, month:number, today:Date}} context シートの年月と本日
 * @return {string} 書き戻す文字列
 */
function mergeDateCell(existingDisplay, newDates, context) {
  const tokens = String(existingDisplay || '')
    .split(/[,，、]/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(canonicalizeDateToken);

  const seen = {};
  const ordered = [];
  tokens.concat(newDates).forEach(token => {
    if (!token || seen[token]) return;
    seen[token] = true;
    ordered.push(token);
  });

  let dates = ordered.filter(isShortDateToken);
  const others = ordered.filter(t => !isShortDateToken(t));

  if (CONFIG.PRUNE_PAST_DATES && context) {
    dates = dates.filter(token => {
      const date = shortDateToDate(token, context.year, context.month);
      return date.getTime() >= toDateOnly(context.today).getTime();
    });
  }

  dates.sort((a, b) => {
    const av = a.split('/').map(Number);
    const bv = b.split('/').map(Number);
    return av[0] - bv[0] || av[1] - bv[1];
  });

  return dates.concat(others).join(', ');
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

/** 「8月」「12月」形式のシートを、月の数値つきで返す */
function getMonthSheets(ss) {
  const result = [];
  ss.getSheets().forEach(sheet => {
    const matched = sheet.getName().trim().match(CONFIG.MONTH_SHEET_PATTERN);
    if (!matched) return;
    const month = Number(matched[1]);
    if (month < 1 || month > 12) return;
    result.push({ sheet: sheet, month: month });
  });
  result.sort((a, b) => a.month - b.month);
  return result;
}

/**
 * 全シートを走査して、クライアント名 → 別名リスト の対応表を作る。
 *
 * D列の別名リストが一部のシートにしか入っていなくても、
 * 全シートで同じ別名が使えるようにするための仕組み。
 * どのシートにも別名が無いクライアントは、クライアント名自体を別名として使う。
 */
function buildAliasMap(ss) {
  const map = {};
  ss.getSheets().forEach(sheet => {
    readClients(sheet).forEach(client => {
      if (!map[client.name]) map[client.name] = [];
      client.aliases.forEach(alias => {
        if (map[client.name].indexOf(alias) === -1) map[client.name].push(alias);
      });
    });
  });
  Object.keys(map).forEach(name => {
    if (map[name].length === 0) map[name].push(name);
  });
  return map;
}

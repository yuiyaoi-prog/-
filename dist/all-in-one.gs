/**
 * クライアント運用状況 確認オペレーション自動化（全部入り）
 *
 * このファイルは src/ の各ファイルを自動で結合したものです。
 * 直接編集せず、src/ を直してから次のコマンドで再生成してください。
 *
 *   node tools/build-all-in-one.js
 *
 * 【使い方】
 *   1. スプレッドシートを開く →「拡張機能」→「Apps Script」
 *   2. 最初からある「コード.gs」の中身を全部消す
 *   3. このファイルの中身を全部貼り付けて保存
 *   4. 関数プルダウンから checkSetup を選んで実行
 */

// ============================================================================
// config.gs
// ============================================================================
/**
 * 共通設定
 *
 * 2026/07/27 時点の実物スプレッドシートを直接確認して作成した。
 * 列レイアウトを変更した場合は必ずここを更新すること。
 *
 * 【実物のシート構成】
 *   行1 … タイトル
 *   行2 … 凡例
 *   行3 … A:クライアント名 / C:担当ディレクター / D:カレンダー検索キーワード / N:備考
 *   行4 … B:PM / E:月次報告日 / F:次回撮影日 / G:ステータス
 *   行5〜… データ
 *
 * H〜M列は使用しない（2026/07/27 決定：E〜Gの3列だけで管理する）。
 */

const CONFIG = {
  SPREADSHEET_ID: '1FAlgL9qF8fMEGV0bFNI2pxdnOyvFQUJroDCEyMsoeAc',

  /** 参照するカレンダー（撮影・MTGの実データが入っている個人カレンダー） */
  CALENDAR_ID: '256yui@gmail.com',

  /** Slack「03_pm-ディレクター管理」（プライベートチャンネル） */
  SLACK_CHANNEL_ID: 'C0BL1HELL3B',
  SLACK_BOT_TOKEN_PROPERTY_KEY: 'SLACK_BOT_TOKEN',
  /** 矢追友唯, 宮中翼 */
  MENTION_USER_IDS: ['U09PG88TBB6', 'U07B3DSEU2G'],

  DATA_START_ROW: 5,

  COL: {
    CLIENT_NAME: 1, // A列
    PM: 2,          // B列
    DIRECTOR: 3,    // C列
    KEYWORDS: 4,    // D列（カンマ区切りの別名リスト）
    STATUS: 7,      // G列（スクリプトは書き込まない。手動運用）
    REMARKS: 14,    // N列
  },

  /**
   * カレンダーの予定を書き込む先。
   * ここに無い種別（インナーMTGなど）は判定はするが、書き込み先が無いので何もしない。
   */
  TARGETS: [
    { kind: '月次報告MTG', col: 5, label: '月次報告日' }, // E列
    { kind: '撮影', col: 6, label: '次回撮影日' },        // F列
  ],

  /**
   * 未確定アラートの判定対象とする種別。
   * ここに挙げた種別の列が空欄なら、その旨をSlackに通知する。
   * 通知文では TARGETS の label 順ではなく、この配列の順に並ぶ。
   */
  ALERT_KINDS: ['撮影', '月次報告MTG'],

  /**
   * 月別シートの名前。両方の書き方に対応する。
   *   ・「2026年8月」… 年が書いてあるのでそのまま使う
   *   ・「8月」      … 今日に一番近い年として解釈する
   */
  MONTH_SHEET_PATTERNS: {
    WITH_YEAR: /^(\d{4})年(\d{1,2})月$/,
    MONTH_ONLY: /^(\d{1,2})月$/,
  },

  /**
   * 過去日になった日付をセルから取り除くか。
   *
   * true にすると、E列・F列は常に「これから先の予定」だけになる。
   * （2026/07/27 決定：過去の実施日は記録しない）
   * 日付として解釈できないメモ書きは削除されない。
   */
  PRUNE_PAST_DATES: true,

  /**
   * イベントタイトルからの種別判定ルール。上から順に評価する。
   * EXCLUDE に該当したものは、以降のルールを見ずに対象外とする。
   *
   * 例:「東大恋愛YouTube 撮影前MTG」「〜横浜村石先生撮影について」は
   *    撮影ではなく打ち合わせなので EXCLUDE で落とす。
   */
  TYPE_RULES: {
    EXCLUDE: ['撮影前', '撮影について', '撮影の件', '撮影日程'],
    MATCH: [
      { kind: 'インナーMTG', keywords: ['インナー'] },
      { kind: '月次報告MTG', keywords: ['月次'] },
      { kind: '撮影', keywords: ['撮影'] },
    ],
  },

  /** 矢追さんが「参加しない」と回答済みの予定を無視するか */
  SKIP_DECLINED_EVENTS: true,

  /** トリガー実行時刻 */
  HOUR: {
    CALENDAR_SYNC: 10, // 毎日10:00
    ALERT: 10,         // 毎月25日10:00 / 毎週の定期確認10:00
  },

  /**
   * 撮影アラート（当月分）を送る曜日。
   * 増やしたり減らしたりしたら setupTriggers() を再実行すること。
   * 指定できるのは SUNDAY / MONDAY / TUESDAY / WEDNESDAY / THURSDAY / FRIDAY / SATURDAY。
   */
  ALERT_WEEKDAYS: ['MONDAY', 'WEDNESDAY', 'FRIDAY'],
};

/** ログや通知文での曜日表記 */
const WEEKDAY_LABEL_JA = {
  SUNDAY: '日',
  MONDAY: '月',
  TUESDAY: '火',
  WEDNESDAY: '水',
  THURSDAY: '木',
  FRIDAY: '金',
  SATURDAY: '土',
};

/** 「月・水・金」のような表記を作る */
function formatAlertWeekdays() {
  return CONFIG.ALERT_WEEKDAYS.map(day => WEEKDAY_LABEL_JA[day] || day).join('・');
}

/** 指定した種別の書き込み先を返す。書き込み先が無ければ null */
function getTargetByKind(kind) {
  for (let i = 0; i < CONFIG.TARGETS.length; i++) {
    if (CONFIG.TARGETS[i].kind === kind) return CONFIG.TARGETS[i];
  }
  return null;
}


// ============================================================================
// util.gs
// ============================================================================
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

/**
 * normalizeText に加えて、括弧・アンダースコア・中黒などの記号も落とす。
 * 「ボンボンクリニック（渋谷）」と「ボンボンクリニック_渋谷」を
 * 同じものとして比べたいときに使う（診断の警告判定用）。
 */
function normalizeLoose(value) {
  return normalizeText(value).replace(/[（）()「」『』【】\[\]{}_\-–—・､、。,.\/／|]/g, '');
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

/**
 * シート名を年月に分解する。月別シートでなければ null。
 *   「2026年8月」→ { year: 2026, month: 8 }
 *   「8月」      → { year: null, month: 8 }   ← 年は呼び出し側で解決する
 */
function parseMonthSheetName(name) {
  const trimmed = String(name || '').trim();

  const withYear = trimmed.match(CONFIG.MONTH_SHEET_PATTERNS.WITH_YEAR);
  if (withYear) {
    const month = Number(withYear[2]);
    if (month < 1 || month > 12) return null;
    return { year: Number(withYear[1]), month: month };
  }

  const monthOnly = trimmed.match(CONFIG.MONTH_SHEET_PATTERNS.MONTH_ONLY);
  if (monthOnly) {
    const month = Number(monthOnly[1]);
    if (month < 1 || month > 12) return null;
    return { year: null, month: month };
  }

  return null;
}

/** 月別シートを、年月を確定させた状態で返す */
function getMonthSheets(ss, today) {
  const base = today || toDateOnly(new Date());
  const result = [];
  ss.getSheets().forEach(sheet => {
    const parsed = parseMonthSheetName(sheet.getName());
    if (!parsed) return;
    result.push({
      sheet: sheet,
      month: parsed.month,
      year: parsed.year !== null ? parsed.year : resolveYearForMonth(parsed.month, base),
    });
  });
  result.sort((a, b) => a.year - b.year || a.month - b.month);
  return result;
}

/** 指定した年月のシートを探す。「2026年8月」「8月」どちらの名前でも見つかる */
function findMonthSheet(ss, year, month, today) {
  const entries = getMonthSheets(ss, today);
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].year === year && entries[i].month === month) return entries[i].sheet;
  }
  return null;
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


// ============================================================================
// calendarSync.gs
// ============================================================================
/**
 * カレンダー同期
 *
 * 矢追友唯のカレンダー（CONFIG.CALENDAR_ID）から予定を取得し、
 * 月別シートの E列「月次報告日」・F列「次回撮影日」へ反映する。
 *
 * 反映ルール：
 *   ・「8月」シートには8月の予定、「9月」シートには9月の予定、というように
 *     シート名の月と同じ月の予定だけを書き込む
 *   ・本日以降の予定のみ対象。過去の予定は書き込まない（2026/07/27 決定）
 *   ・複数件は「8/5, 8/20」のようにカンマ区切りで1セルに統合
 *   ・既存の手動入力値は消さずに統合する
 *   ・過去日になった日付はセルから取り除く（CONFIG.PRUNE_PAST_DATES）
 *
 * 動作確認は必ず dryRunCalendarSync() から始めること（シートに書き込まない）。
 */

/** 日次トリガーから呼ばれる本体 */
function syncCalendarToSheets() {
  runCalendarSync(false);
}

/** 動作確認用：シートには書き込まず、判定結果だけをログに出す */
function dryRunCalendarSync() {
  runCalendarSync(true);
}

function runCalendarSync(isDryRun) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const today = toDateOnly(new Date());
  const aliasMap = buildAliasMap(ss);

  const monthSheets = getMonthSheets(ss, today);
  if (monthSheets.length === 0) {
    console.log('「2026年8月」「8月」のような月別シートが1枚も見つかりませんでした');
    return;
  }
  console.log(
    `対象シート: ${monthSheets.map(m => m.sheet.getName()).join(' / ')}` +
      (isDryRun ? '（ドライラン：書き込みません）' : '')
  );

  monthSheets.forEach(entry => {
    syncMonthSheet(entry.sheet, entry.year, entry.month, aliasMap, today, isDryRun);
  });
}

/**
 * 月別シート1枚を同期する。
 * @param {Sheet} sheet 対象シート
 * @param {number} year シート名から確定した年
 * @param {number} month シート名から読み取った月（1〜12）
 * @param {Object} aliasMap クライアント名 → 別名リスト
 * @param {Date} today 日付のみに丸めた本日
 * @param {boolean} isDryRun
 */
function syncMonthSheet(sheet, year, month, aliasMap, today, isDryRun) {
  const sheetName = sheet.getName();

  const clients = readClients(sheet).map(client => {
    const merged = aliasMap[client.name];
    return merged && merged.length > 0
      ? { row: client.row, name: client.name, director: client.director, aliases: merged }
      : client;
  });

  if (clients.length === 0) {
    console.log(`[${sheetName}] クライアント行がありません`);
    return;
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const events = fetchEvents(monthStart, monthEnd);

  // results[row][kind] = ['8/5', '8/20']
  const results = {};
  const unmatched = [];

  events.forEach(event => {
    const startDate = toDateOnly(event.getStartTime());
    if (startDate.getTime() < today.getTime()) return; // 過去の予定は扱わない

    const title = event.getTitle();
    const kind = detectKind(title);
    if (!kind) return;
    if (!getTargetByKind(kind)) return; // 書き込み先の列が無い種別（インナーMTGなど）

    const client = matchClient(title, clients);
    if (!client) {
      unmatched.push(`${formatShortDate(startDate)} ${title}（種別:${kind}）`);
      return;
    }

    const label = formatShortDate(startDate);
    if (!results[client.row]) results[client.row] = {};
    if (!results[client.row][kind]) results[client.row][kind] = [];
    if (results[client.row][kind].indexOf(label) === -1) results[client.row][kind].push(label);
  });

  writeResults(sheet, sheetName, clients, results, { year: year, month: month, today: today }, isDryRun);

  if (unmatched.length > 0) {
    console.log(
      `[${sheetName}] クライアントに紐付かなかった予定 ${unmatched.length}件` +
        `（D列の別名リストに追加を検討してください）:\n  ` +
        unmatched.join('\n  ')
    );
  }
}

/** 対象期間のイベントを取得する */
function fetchEvents(from, to) {
  const calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  if (!calendar) {
    throw new Error(
      `カレンダー「${CONFIG.CALENDAR_ID}」にアクセスできません。` +
        'スクリプトを実行するアカウントに、このカレンダーが共有されているか確認してください。'
    );
  }

  return calendar.getEvents(from, to).filter(event => {
    if (!CONFIG.SKIP_DECLINED_EVENTS) return true;
    try {
      return event.getMyStatus() !== CalendarApp.GuestStatus.NO;
    } catch (e) {
      // ゲスト情報を持たない予定では例外になることがあるため、その場合は対象に含める
      return true;
    }
  });
}

/**
 * イベントタイトルから種別を判定する。
 * 対象外なら null を返す。
 */
function detectKind(title) {
  const normalized = normalizeText(title);

  for (let i = 0; i < CONFIG.TYPE_RULES.EXCLUDE.length; i++) {
    if (normalized.indexOf(normalizeText(CONFIG.TYPE_RULES.EXCLUDE[i])) !== -1) {
      return null;
    }
  }

  for (let i = 0; i < CONFIG.TYPE_RULES.MATCH.length; i++) {
    const rule = CONFIG.TYPE_RULES.MATCH[i];
    for (let j = 0; j < rule.keywords.length; j++) {
      if (normalized.indexOf(normalizeText(rule.keywords[j])) !== -1) {
        return rule.kind;
      }
    }
  }
  return null;
}

/**
 * イベントタイトルに含まれる別名から、対応するクライアントを1件返す。
 *
 * 照合には normalizeLoose を使う。スペース・全角半角に加えて
 * アンダースコアや中黒などの区切り記号も無視するため、
 * 別名「ボンボンクリニック_渋谷」でカレンダーの「ボンボンクリニック渋谷」を拾える。
 *
 * 種別判定（detectKind）には使わない。区切りを詰めると
 * 「撮影 - 前田さん」が「撮影前」と誤判定されてしまうため。
 *
 * 複数のクライアントが該当した場合は、一致した別名がより長いほうを採用する。
 * （例：「NAS」と「NASプレミアム」の両方が候補になったとき、後者を優先する）
 */
function matchClient(title, clients) {
  const normalizedTitle = normalizeLoose(title);
  let best = null;
  let bestLength = 0;

  clients.forEach(client => {
    client.aliases.forEach(alias => {
      const normalizedAlias = normalizeLoose(alias);
      if (!normalizedAlias) return;
      if (normalizedTitle.indexOf(normalizedAlias) === -1) return;
      if (normalizedAlias.length > bestLength) {
        best = client;
        bestLength = normalizedAlias.length;
      }
    });
  });

  return best;
}

/** 判定結果をシートへ書き戻す（ドライラン時はログ出力のみ） */
function writeResults(sheet, sheetName, clients, results, context, isDryRun) {
  let changeCount = 0;

  clients.forEach(client => {
    const perKind = results[client.row] || {};

    CONFIG.TARGETS.forEach(target => {
      const newDates = perKind[target.kind] || [];
      const cell = sheet.getRange(client.row, target.col);
      const before = cell.getDisplayValue();

      // 新規の日付が無くても、過去日の除去のために既存値は評価する
      if (newDates.length === 0 && !CONFIG.PRUNE_PAST_DATES) return;
      if (newDates.length === 0 && !before) return;

      const after = mergeDateCell(before, newDates, context);
      if (before === after) return;

      changeCount++;
      console.log(
        `[${sheetName}] ${client.name} / ${target.label}: 「${before}」→「${after}」`
      );
      if (!isDryRun) cell.setValue(after);
    });
  });

  const mode = isDryRun ? 'ドライラン（書き込みなし）' : '書き込み完了';
  console.log(`[${sheetName}] ${mode}：更新対象 ${changeCount}件`);
}


// ============================================================================
// shootAlert.gs
// ============================================================================
/**
 * 日程未確定アラート
 *
 * 月別シートを見て、E列「月次報告日」・F列「次回撮影日」が空欄のクライアントを
 * Slack「03_pm-ディレクター管理」へ通知する。
 * どの列を見るかは CONFIG.ALERT_KINDS で決まる。
 *
 * 実行タイミング（setupTriggers() で設定）：
 *   ・毎月25日 10:00 → 翌月シートをチェック（初回確認）
 *   ・毎週 月・水・金 10:00 → 当月シートをチェック（CONFIG.ALERT_WEEKDAYS で変更可）
 *
 * カレンダー同期が過去日を取り除くため、予定が終わって次が未定になると
 * このアラートで拾われる。
 *
 * 対象クライアント：シートに行があるもの全て。
 *   （実物のシートに「契約状況」列が存在しないため、ステータスによる絞り込みは行わない。
 *     契約終了時は行を削除する運用。2026/07/27 決定）
 *
 * ※ 関数名に Shoot が残っているのは、既に設定済みのトリガーが関数名で
 *   紐づいているため。名前を変えると既存トリガーが動かなくなる。
 */

/** 毎月25日：翌月シートの日程を初回チェック */
function checkNextMonthShootSchedule() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  runCheck(nextMonth.getFullYear(), nextMonth.getMonth() + 1, '初回確認（毎月25日）');
}

/** 指定曜日：当月シートの日程を定期チェック */
function checkCurrentMonthShootScheduleWeekly() {
  const now = new Date();
  runCheck(now.getFullYear(), now.getMonth() + 1, `定期確認（毎週${formatAlertWeekdays()}曜）`);
}

function runCheck(year, month, timing) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const today = toDateOnly(new Date());
  const sheet = findMonthSheet(ss, year, month, today);
  if (!sheet) {
    console.log(`${year}年${month}月のシートが見つかりませんでした（未作成の可能性があります）`);
    return;
  }

  const sheetName = sheet.getName();
  const clients = readClients(sheet);

  // 種別ごとに、その列が空欄のクライアントを集める
  const groups = [];
  CONFIG.ALERT_KINDS.forEach(kind => {
    const target = getTargetByKind(kind);
    if (!target) {
      console.log(`CONFIG.TARGETS に種別「${kind}」の列が定義されていないため飛ばします`);
      return;
    }

    const missing = [];
    clients.forEach(client => {
      const value = sheet.getRange(client.row, target.col).getDisplayValue().trim();
      if (!value) {
        missing.push({ clientName: client.name, director: client.director });
      }
    });

    console.log(`[${sheetName}] ${target.label}：未確定 ${missing.length}件`);
    if (missing.length > 0) {
      groups.push({ label: target.label, missing: missing });
    }
  });

  if (groups.length === 0) {
    console.log(`${sheetName}：未確定の日程はありませんでした`);
    return;
  }

  postSlackAlert(`【${sheetName}】日程未確定の確認（${timing}）`, groups);
}

function postSlackAlert(headline, groups) {
  const mentions = CONFIG.MENTION_USER_IDS.map(id => `<@${id}>`).join(' ');

  const body = groups
    .map(group => {
      const lines = group.missing
        .map(m => `• *${m.clientName}*（担当：${m.director || '未設定'}）`)
        .join('\n');
      return `▼ ${group.label}\n${lines}`;
    })
    .join('\n\n');

  const message =
    `${mentions}\n` +
    `${headline}\n` +
    `以下の日程がまだ確定していません👇\n\n` +
    `${body}\n\n` +
    `確認・確定をお願いします🙏`;

  const token = PropertiesService.getScriptProperties().getProperty(
    CONFIG.SLACK_BOT_TOKEN_PROPERTY_KEY
  );
  if (!token) {
    console.log(
      `${CONFIG.SLACK_BOT_TOKEN_PROPERTY_KEY} がスクリプトプロパティに設定されていません`
    );
    return;
  }

  const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({ channel: CONFIG.SLACK_CHANNEL_ID, text: message }),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    // not_in_channel の場合は Bot をチャンネルに /invite する必要がある
    console.log(`Slack送信エラー: ${result.error}`);
  } else {
    const total = groups.reduce((sum, g) => sum + g.missing.length, 0);
    console.log(`Slackへアラート送信完了（${groups.length}種別 / 計${total}件）`);
  }
}

/**
 * 動作確認用：今すぐチェックを走らせてSlackに送る。
 *
 * 当月シートがまだ無い時期（月別シートを先の月から作り始めた直後など）でも
 * テストできるよう、当月シートが無ければ翌月シートで試す。
 */
function testRunNow() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const today = toDateOnly(new Date());
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const candidates = [
    { label: '当月', year: today.getFullYear(), month: today.getMonth() + 1 },
    { label: '翌月', year: nextMonth.getFullYear(), month: nextMonth.getMonth() + 1 },
  ];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (findMonthSheet(ss, c.year, c.month, today)) {
      console.log(`${c.label}（${c.year}年${c.month}月）のシートでテストします`);
      runCheck(c.year, c.month, 'テスト実行');
      return;
    }
    console.log(`${c.label}（${c.year}年${c.month}月）のシートがないため飛ばします`);
  }

  console.log('当月・翌月どちらのシートも見つかりませんでした');
}


// ============================================================================
// checkSetup.gs
// ============================================================================
/**
 * セットアップ診断
 *
 * 何も送信せず・何も書き換えず、設定が正しいかだけを確認する。
 * うまく動かないときは、まずこの checkSetup() を実行してログを見ること。
 */

function checkSetup() {
  const lines = [];
  lines.push('===== セットアップ診断 =====');

  checkTimeZone(lines);
  const ss = checkSpreadsheet(lines);
  checkAliases(ss, lines);
  checkCalendar(lines);
  checkSlack(lines);

  lines.push('');
  lines.push('［凡例］OK＝問題なし／NG＝要対応／!!＝念のため確認');
  console.log(lines.join('\n'));
}

/**
 * トリガーの実行時刻はスクリプトのタイムゾーンで解釈されるため、
 * ここが日本時間でないと「毎日10:00」が別の時刻になってしまう。
 */
function checkTimeZone(lines) {
  lines.push('');
  lines.push('■ タイムゾーン');
  const tz = Session.getScriptTimeZone();
  if (tz === 'Asia/Tokyo') {
    lines.push(`OK  ${tz}（日本標準時）`);
  } else {
    lines.push(`NG  ${tz} になっています`);
    lines.push('    → このままだとトリガーが10:00以外の時刻に動きます');
    lines.push('    → 「プロジェクトの設定」→「タイムゾーン」を');
    lines.push('      「(GMT+09:00) 日本標準時 - 東京」に変更してください');
  }
}

function checkSpreadsheet(lines) {
  lines.push('');
  lines.push('■ スプレッドシート');
  let ss;
  try {
    ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  } catch (e) {
    lines.push(`NG  接続できません: ${e.message}`);
    lines.push('    → CONFIG.SPREADSHEET_ID と、実行アカウントの閲覧・編集権限を確認してください');
    return null;
  }

  lines.push(`OK  「${ss.getName()}」に接続できました`);
  const names = ss.getSheets().map(s => s.getName());
  lines.push(`    シート一覧: ${names.join(' / ')}`);

  const today = toDateOnly(new Date());
  const monthSheets = getMonthSheets(ss, today);
  if (monthSheets.length === 0) {
    lines.push('NG  「2026年8月」「8月」のような月別シートが1枚もありません');
    lines.push('    → シート名を「2026年8月」または「8月」の形式に合わせてください');
    return ss;
  }
  lines.push(`OK  同期対象の月別シート ${monthSheets.length}枚:`);
  monthSheets.forEach(m => {
    lines.push(`    ${m.sheet.getName()} → ${m.year}年${m.month}月の予定を取得します`);
  });

  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  [
    { label: '当月', year: today.getFullYear(), month: today.getMonth() + 1 },
    { label: '翌月', year: nextMonth.getFullYear(), month: nextMonth.getMonth() + 1 },
  ].forEach(t => {
    if (!findMonthSheet(ss, t.year, t.month, today)) {
      lines.push(
        `!!  ${t.label}（${t.year}年${t.month}月）のシートがありません` +
          '（撮影アラートはこのシートを見ます）'
      );
    }
  });
  return ss;
}

function checkAliases(ss, lines) {
  lines.push('');
  lines.push('■ D列（カレンダー検索キーワード）');
  if (!ss) {
    lines.push('!!  スプレッドシートに接続できないため確認をスキップしました');
    return;
  }

  const aliasMap = buildAliasMap(ss);
  const names = Object.keys(aliasMap);
  if (names.length === 0) {
    lines.push('NG  どのシートからもクライアント行を読み取れませんでした');
    return;
  }

  lines.push(`OK  ${names.length}件のクライアントを読み取りました`);
  lines.push('    ※別名は全シートを合算しています。1枚に入っていれば全シートで使えます');
  names.forEach(name => {
    lines.push(`    ${name}: ${aliasMap[name].join(' / ')}（${aliasMap[name].length}件）`);
  });

  // 別名がクライアント名と全く無関係だと入れ違いの可能性がある。
  // 「（渋谷）」と「_渋谷」のような記号違いで誤検知しないよう、記号を落として比べる。
  names.forEach(name => {
    const normalizedName = normalizeLoose(name);
    const related = aliasMap[name].some(a => {
      const na = normalizeLoose(a);
      return na && (normalizedName.indexOf(na) !== -1 || na.indexOf(normalizedName) !== -1);
    });
    if (!related) {
      lines.push(`!!  ${name}: 別名がクライアント名とかけ離れています（入れ違いの可能性）`);
    }
  });
}

function checkCalendar(lines) {
  lines.push('');
  lines.push('■ Googleカレンダー');
  let calendar;
  try {
    calendar = CalendarApp.getCalendarById(CONFIG.CALENDAR_ID);
  } catch (e) {
    calendar = null;
  }

  if (!calendar) {
    lines.push(`NG  カレンダー「${CONFIG.CALENDAR_ID}」にアクセスできません`);
    lines.push('    → このスクリプトを実行しているGoogleアカウントに、');
    lines.push('      該当カレンダーの閲覧権限が共有されているか確認してください');
    lines.push(`    現在の実行アカウント: ${Session.getEffectiveUser().getEmail()}`);
    return;
  }

  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const events = calendar.getEvents(from, to);
  lines.push(`OK  「${calendar.getName()}」に接続できました`);
  lines.push(`    当月の予定: ${events.length}件`);

  const kinds = {};
  events.forEach(e => {
    const kind = detectKind(e.getTitle());
    if (kind && getTargetByKind(kind)) kinds[kind] = (kinds[kind] || 0) + 1;
  });
  const summary = Object.keys(kinds).map(k => `${k}:${kinds[k]}件`).join(' / ');
  lines.push(`    うち書き込み対象と判定: ${summary || 'なし'}`);
}

function checkSlack(lines) {
  lines.push('');
  lines.push('■ Slack');
  const token = PropertiesService.getScriptProperties().getProperty(
    CONFIG.SLACK_BOT_TOKEN_PROPERTY_KEY
  );
  if (!token) {
    lines.push(`NG  スクリプトプロパティ「${CONFIG.SLACK_BOT_TOKEN_PROPERTY_KEY}」が未設定です`);
    lines.push('    → 「プロジェクトの設定」→「スクリプト プロパティ」から追加してください');
    return;
  }
  lines.push(`OK  トークンが設定されています（${token.substring(0, 8)}...）`);

  const response = UrlFetchApp.fetch('https://slack.com/api/auth.test', {
    method: 'post',
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });
  const result = JSON.parse(response.getContentText());
  if (!result.ok) {
    lines.push(`NG  トークンが無効です: ${result.error}`);
    lines.push('    → invalid_auth の場合、トークンを貼り直してください');
    return;
  }
  lines.push(`OK  Slackに接続できました（ワークスペース: ${result.team} / Bot: ${result.user}）`);
  lines.push(`    送信先チャンネルID: ${CONFIG.SLACK_CHANNEL_ID}`);
  lines.push('    ※Botをチャンネルに /invite できているかは、実際に送信するまで判定できません');
  lines.push('      testRunNow() を実行して not_in_channel が出たら招待漏れです');
}


// ============================================================================
// triggers.gs
// ============================================================================
/**
 * トリガー設定
 *
 * setupTriggers() を1回だけ手動実行すればよい（初回は権限承認が必要）。
 * 何度実行しても、このプロジェクトが作ったトリガーは重複しない。
 */

const MANAGED_TRIGGER_FUNCTIONS = [
  'syncCalendarToSheets',
  'checkNextMonthShootSchedule',
  'checkCurrentMonthShootScheduleWeekly',
];

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (MANAGED_TRIGGER_FUNCTIONS.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // カレンダー同期：毎日10:00
  ScriptApp.newTrigger('syncCalendarToSheets')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.HOUR.CALENDAR_SYNC)
    .create();

  // 撮影日程アラート：毎月25日10:00（翌月分）
  ScriptApp.newTrigger('checkNextMonthShootSchedule')
    .timeBased()
    .onMonthDay(25)
    .atHour(CONFIG.HOUR.ALERT)
    .create();

  // 撮影日程アラート：指定した曜日の10:00（当月分）
  CONFIG.ALERT_WEEKDAYS.forEach(day => {
    const weekDay = ScriptApp.WeekDay[day];
    if (!weekDay) {
      throw new Error(
        `CONFIG.ALERT_WEEKDAYS の「${day}」は指定できません。` +
          'SUNDAY / MONDAY / TUESDAY / WEDNESDAY / THURSDAY / FRIDAY / SATURDAY のいずれかにしてください。'
      );
    }
    ScriptApp.newTrigger('checkCurrentMonthShootScheduleWeekly')
      .timeBased()
      .onWeekDay(weekDay)
      .atHour(CONFIG.HOUR.ALERT)
      .create();
  });

  console.log(
    'トリガー設定完了：\n' +
      `  ・カレンダー同期  毎日 ${CONFIG.HOUR.CALENDAR_SYNC}:00\n` +
      `  ・撮影アラート    毎月25日 ${CONFIG.HOUR.ALERT}:00（翌月分）\n` +
      `  ・撮影アラート    毎週${formatAlertWeekdays()}曜 ${CONFIG.HOUR.ALERT}:00（当月分）`
  );
}

/** 設定済みトリガーを一覧表示する（確認用） */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    console.log('トリガーは設定されていません');
    return;
  }
  triggers.forEach(t => console.log(`${t.getHandlerFunction()} (${t.getEventType()})`));
}

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

  const monthSheets = getMonthSheets(ss);
  if (monthSheets.length === 0) {
    console.log('「8月」「9月」のような月別シートが1枚も見つかりませんでした');
    return;
  }
  console.log(
    `対象シート: ${monthSheets.map(m => m.sheet.getName()).join(' / ')}` +
      (isDryRun ? '（ドライラン：書き込みません）' : '')
  );

  monthSheets.forEach(entry => {
    syncMonthSheet(entry.sheet, entry.month, aliasMap, today, isDryRun);
  });
}

/**
 * 月別シート1枚を同期する。
 * @param {Sheet} sheet 対象シート
 * @param {number} month シート名から読み取った月（1〜12）
 * @param {Object} aliasMap クライアント名 → 別名リスト
 * @param {Date} today 日付のみに丸めた本日
 * @param {boolean} isDryRun
 */
function syncMonthSheet(sheet, month, aliasMap, today, isDryRun) {
  const sheetName = sheet.getName();
  const year = resolveYearForMonth(month, today);

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
 * 複数のクライアントが該当した場合は、一致した別名がより長いほうを採用する。
 * （例：「NAS」と「NASプレミアム」の両方が候補になったとき、後者を優先する）
 */
function matchClient(title, clients) {
  const normalizedTitle = normalizeText(title);
  let best = null;
  let bestLength = 0;

  clients.forEach(client => {
    client.aliases.forEach(alias => {
      const normalizedAlias = normalizeText(alias);
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

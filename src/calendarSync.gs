/**
 * カレンダー同期
 *
 * 矢追友唯のカレンダー（CONFIG.CALENDAR_ID）から予定を取得し、
 * 月別シートの「前回実施日 / 次回予定日」セルへ反映する。
 *
 * 反映ルール：
 *   ・イベント開始日が属する月のシートに書き込む（＝月跨ぎはこれで解決）
 *   ・本日より前   → 「前回実施日」
 *   ・本日以降     → 「次回予定日」
 *   ・複数件は「8/5, 8/20」のようにカンマ区切りで1セルに統合
 *   ・既存の手動入力値は消さずに統合する
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

  for (let offset = 0; offset < CONFIG.SYNC_MONTH_COUNT; offset++) {
    const target = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    syncMonth(ss, target, today, isDryRun);
  }
}

/**
 * 1ヶ月分を同期する。
 * @param {Spreadsheet} ss
 * @param {Date} monthStart 対象月の1日
 * @param {Date} today 日付のみに丸めた本日
 * @param {boolean} isDryRun
 */
function syncMonth(ss, monthStart, today, isDryRun) {
  const sheetName = `${monthStart.getMonth() + 1}月`;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    console.log(`[${sheetName}] シートが見つかりません（未作成の可能性があります）`);
    return;
  }

  const clients = readClients(sheet);
  if (clients.length === 0) {
    console.log(`[${sheetName}] クライアント行がありません`);
    return;
  }

  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const events = fetchEvents(monthStart, monthEnd);

  // results[row][kind] = { past: [], future: [] }
  const results = {};
  const unmatched = [];

  events.forEach(event => {
    const title = event.getTitle();
    const kind = detectKind(title);
    if (!kind) return;

    const client = matchClient(title, clients);
    if (!client) {
      unmatched.push(`${formatShortDate(event.getStartTime())} ${title}（種別:${kind}）`);
      return;
    }

    const startDate = toDateOnly(event.getStartTime());
    const bucket = startDate.getTime() < today.getTime() ? 'past' : 'future';
    const label = formatShortDate(startDate);

    if (!results[client.row]) results[client.row] = {};
    if (!results[client.row][kind]) results[client.row][kind] = { past: [], future: [] };
    const list = results[client.row][kind][bucket];
    if (list.indexOf(label) === -1) list.push(label);
  });

  writeResults(sheet, sheetName, clients, results, isDryRun);

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
function writeResults(sheet, sheetName, clients, results, isDryRun) {
  let changeCount = 0;

  clients.forEach(client => {
    const perKind = results[client.row];
    if (!perKind) return;

    CONFIG.BLOCKS.forEach(block => {
      const found = perKind[block.kind];
      if (!found) return;

      [
        { col: block.lastCol, dates: found.past, label: '前回実施日' },
        { col: block.nextCol, dates: found.future, label: '次回予定日' },
      ].forEach(target => {
        if (target.dates.length === 0) return;

        const cell = sheet.getRange(client.row, target.col);
        const before = cell.getDisplayValue();
        const after = mergeDateCell(before, target.dates);
        if (before === after) return;

        changeCount++;
        console.log(
          `[${sheetName}] ${client.name} / ${block.kind} / ${target.label}: ` +
            `「${before}」→「${after}」`
        );
        if (!isDryRun) cell.setValue(after);
      });
    });
  });

  const mode = isDryRun ? 'ドライラン（書き込みなし）' : '書き込み完了';
  console.log(`[${sheetName}] ${mode}：更新対象 ${changeCount}件`);
}

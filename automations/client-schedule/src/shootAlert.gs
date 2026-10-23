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

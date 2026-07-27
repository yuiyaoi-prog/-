/**
 * 撮影日程 未確定アラート
 *
 * 月別シートを見て、F列「次回撮影日」が空欄のクライアントを
 * Slack「03_pm-ディレクター管理」へ通知する。
 *
 * カレンダー同期が過去日を取り除くため、撮影が終わって次の予定が未定になると
 * このアラートで拾われる。
 *
 * 実行タイミング（setupTriggers() で設定）：
 *   ・毎月25日 10:00 → 翌月シートをチェック（初回確認）
 *   ・毎週水曜 10:00 → 当月シートをチェック（以降の週次確認）
 *
 * 対象クライアント：シートに行があるもの全て。
 *   （実物のシートに「契約状況」列が存在しないため、ステータスによる絞り込みは行わない。
 *     契約終了時は行を削除する運用。2026/07/27 決定）
 */

/** 毎月25日：翌月シートの撮影予定を初回チェック */
function checkNextMonthShootSchedule() {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const sheetName = `${nextMonth.getMonth() + 1}月`;
  runCheck(sheetName, `【${sheetName}】撮影日程 初回確認（毎月25日）`);
}

/** 毎週水曜：当月シートの撮影予定を週次チェック */
function checkCurrentMonthShootScheduleWeekly() {
  const now = new Date();
  const sheetName = `${now.getMonth() + 1}月`;
  runCheck(sheetName, `【${sheetName}】撮影日程 週次確認（毎週水曜）`);
}

function runCheck(sheetName, headline) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    console.log(`シート「${sheetName}」が見つかりませんでした（未作成の可能性があります）`);
    return;
  }

  const target = getTargetByKind(CONFIG.ALERT_KIND);
  if (!target) {
    console.log(`CONFIG.TARGETS に種別「${CONFIG.ALERT_KIND}」の書き込み先がありません`);
    return;
  }

  const clients = readClients(sheet);
  const missing = [];

  clients.forEach(client => {
    const nextDate = sheet.getRange(client.row, target.col).getDisplayValue().trim();
    if (!nextDate) {
      missing.push({ clientName: client.name, director: client.director });
    }
  });

  if (missing.length === 0) {
    console.log(`${sheetName}：未確定の撮影日程はありませんでした`);
    return;
  }

  postSlackAlert(headline, missing);
}

function postSlackAlert(headline, missing) {
  const mentions = CONFIG.MENTION_USER_IDS.map(id => `<@${id}>`).join(' ');
  const lines = missing
    .map(m => `• *${m.clientName}*（担当：${m.director || '未設定'}）`)
    .join('\n');

  const message =
    `${mentions}\n` +
    `${headline}\n` +
    `以下のクライアントの撮影日がまだ確定していません👇\n` +
    `${lines}\n` +
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
    console.log(`Slackへアラート送信完了（${missing.length}件）`);
  }
}

/** 動作確認用：今すぐ当月シートに対してチェックを走らせる */
function testRunNow() {
  checkCurrentMonthShootScheduleWeekly();
}

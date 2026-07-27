/**
 * セットアップ診断
 *
 * 何も送信せず・何も書き換えず、設定が正しいかだけを確認する。
 * うまく動かないときは、まずこの checkSetup() を実行してログを見ること。
 */

function checkSetup() {
  const lines = [];
  lines.push('===== セットアップ診断 =====');

  const ss = checkSpreadsheet(lines);
  checkAliases(ss, lines);
  checkCalendar(lines);
  checkSlack(lines);

  lines.push('');
  lines.push('［凡例］OK＝問題なし／NG＝要対応／!!＝念のため確認');
  console.log(lines.join('\n'));
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
  const monthSheets = getMonthSheets(ss);
  if (monthSheets.length === 0) {
    lines.push('NG  「8月」「9月」のような月別シートが1枚もありません');
    lines.push('    → シート名を「8月」の形式に合わせてください');
    return ss;
  }
  lines.push(`OK  同期対象の月別シート ${monthSheets.length}枚:`);
  monthSheets.forEach(m => {
    const year = resolveYearForMonth(m.month, today);
    lines.push(`    ${m.sheet.getName()} → ${year}年${m.month}月の予定を取得します`);
  });

  [
    { label: '当月', name: `${today.getMonth() + 1}月` },
    { label: '翌月', name: `${new Date(today.getFullYear(), today.getMonth() + 1, 1).getMonth() + 1}月` },
  ].forEach(t => {
    if (names.indexOf(t.name) === -1) {
      lines.push(`!!  ${t.label}シート「${t.name}」がありません（撮影アラートはこのシートを見ます）`);
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

  // 別名がクライアント名と全く無関係だと入れ違いの可能性がある
  names.forEach(name => {
    const normalizedName = normalizeText(name);
    const related = aliasMap[name].some(a => {
      const na = normalizeText(a);
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

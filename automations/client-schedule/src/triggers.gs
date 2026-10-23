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

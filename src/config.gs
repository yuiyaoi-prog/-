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

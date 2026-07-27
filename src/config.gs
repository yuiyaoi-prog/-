/**
 * 共通設定
 *
 * 2026/07/27 時点の実物スプレッドシートを直接確認して作成した。
 * 列レイアウトを変更した場合は必ずここを更新すること。
 *
 * 【実物のシート構成（CSVエクスポートで確認済み）】
 *   行1 … タイトル
 *   行2 … 凡例
 *   行3 … A:クライアント名 / C:担当ディレクター / D:カレンダー検索キーワード / N:備考
 *          ※ E〜M のグループ見出し（月次報告MTG / 撮影 / インナーMTG）は空欄
 *   行4 … B:PM / E〜M:「次回予定日・前回実施日・ステータス」×3ブロック
 *   行5〜… データ
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
    REMARKS: 14,    // N列
  },

  /**
   * 3ブロックの並び。シートの左から順に E-G / H-J / K-M。
   *
   * ★シート行3のグループ見出しが空欄のため、シートのタイトル
   *   「月次報告MTG / 撮影 / インナーMTG」の順であると判断して設定している。
   *   実際の並びが違っていた場合は、この配列の kind の順序だけを入れ替えれば直る。
   */
  BLOCKS: [
    { kind: '月次報告MTG', nextCol: 5, lastCol: 6, statusCol: 7 },   // E, F, G
    { kind: '撮影', nextCol: 8, lastCol: 9, statusCol: 10 },         // H, I, J
    { kind: 'インナーMTG', nextCol: 11, lastCol: 12, statusCol: 13 }, // K, L, M
  ],

  /** 未確定アラートの判定対象とする種別 */
  ALERT_KIND: '撮影',

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

  /** カレンダー同期で対象にする月数（当月を含む。2 なら当月＋翌月） */
  SYNC_MONTH_COUNT: 2,

  /** トリガー実行時刻 */
  HOUR: {
    CALENDAR_SYNC: 10, // 毎日10:00
    ALERT: 10,         // 毎月25日10:00 / 毎週水曜10:00
  },
};

/** 指定した種別のブロック定義を返す */
function getBlockByKind(kind) {
  for (let i = 0; i < CONFIG.BLOCKS.length; i++) {
    if (CONFIG.BLOCKS[i].kind === kind) return CONFIG.BLOCKS[i];
  }
  throw new Error(`CONFIG.BLOCKS に種別「${kind}」が定義されていません`);
}

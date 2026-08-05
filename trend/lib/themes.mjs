/**
 * Mai さんのブランディングに沿ったテーマ定義。
 *
 * 参照元：
 *   - トークテーマ資料（Threads バズ投稿30件の分類）
 *   - Instagram ブラッシュアップ提案書（仮想敵・フック変換の3原則）
 *
 * ここを書き換えれば拾ってくるテーマが変わる。コードは触らなくていい。
 */

/** 収集対象のテーマ。keywords は検索クエリにも分類にも使う。 */
export const THEMES = [
  {
    id: 'childcare',
    label: '育児のリアル・孤独',
    keywords: [
      '育児', '子育て', 'ワンオペ', '育児と仕事', '産後', '保育園', '寝不足',
      '離乳食', '名もなき家事', '育休', 'ワンオペ育児', '母親だけ',
    ],
  },
  {
    id: 'marriage',
    label: '夫婦のあり方・夫婦の価値観',
    keywords: [
      '夫婦', '旦那', '夫', '妻', '家事分担', '夫婦仲', '離婚', '熟年離婚',
      '夫に期待', '産後クライシス', 'ステップファミリー', '再婚', '夫婦喧嘩',
    ],
  },
  {
    id: 'fertility',
    label: '妊活・出産',
    keywords: [
      '妊活', '不妊治療', '体外受精', '採卵', '高齢出産', '妊娠', '出産',
      '流産', 'second opinion', '不育症', '無痛分娩',
    ],
  },
  {
    id: 'women-work',
    label: '女性の働き方・女性の自立',
    keywords: [
      '女性の自立', '経済的自立', '専業主婦', 'ワーママ', '時短勤務',
      '女性活躍', 'キャリア', '共働き', '正社員', '女性 収入', '起業',
      'マミートラック', '扶養',
    ],
  },
  {
    id: 'gender',
    label: '男女平等・ジェンダー',
    keywords: [
      '男女平等', 'ジェンダー', 'ジェンダーギャップ', '女性差別',
      'マザーフッドペナルティ', '生理', '性別役割',
    ],
  },
];

/**
 * Mai さんの発信軸に「刺さる」度合いの加点キーワード。
 * 提案書の仮想敵（夫に依存して生きてきた女性／環境のせいで止まっている女性）と、
 * 強み（借金・離婚・ステップファミリー・5児・経営・ドバイ）に対応させている。
 */
export const BRAND_SIGNALS = [
  { pattern: /自立|自分で稼|経済力|収入を|お金がない|扶養|専業主婦/, weight: 3, note: '経済的自立に接続できる' },
  { pattern: /期待し(ない|なく)|他人のせい|他責|環境のせい|誰かがやってくれ/, weight: 3, note: '「期待しない」哲学に接続できる' },
  { pattern: /離婚|再婚|ステップファミリー|連れ子|バツイチ/, weight: 3, note: 'Mai さん自身の修羅場と重なる' },
  { pattern: /頼る|預ける|ベビーシッター|ナニー|家政婦|人の手/, weight: 3, note: '「頼るのが当たり前」という海外比較に接続できる' },
  { pattern: /海外|ドバイ|日本だけ|日本の常識|移住/, weight: 2, note: '日本×ドバイの対比が使える' },
  { pattern: /高齢出産|40代|40歳|アラフォー|何人目|多子|兄弟が多/, weight: 2, note: '40歳・5児という属性が効く' },
  { pattern: /起業|経営|社長|フリーランス|独立/, weight: 2, note: '経営者としての立場が効く' },
  { pattern: /かわいそう|べき|普通は|母親なんだから|我慢/, weight: 2, note: '常識破壊フックを作りやすい' },
];

/** 逆に、Mai さんの発信から遠いので落としたい話題。 */
export const EXCLUDE = [
  /スレッズ(運用|攻略)|フォロワーの?増やし方|インプ(稼ぎ)?|アフィリエイト/,
  /副業で月\d+万|稼げる方法を|プレゼント企画|無料配布/,
  /^(おはよう|おやすみ|こんにちは)[\s！!。]*$/,
];

/** 本文からテーマIDの配列を返す。 */
export function classify(text) {
  const t = String(text || '');
  return THEMES.filter((theme) => theme.keywords.some((k) => t.includes(k))).map((x) => x.id);
}

/** 本文が除外対象かどうか。 */
export function isExcluded(text) {
  const t = String(text || '');
  return EXCLUDE.some((re) => re.test(t));
}

/** ブランド適合の加点と、その理由。 */
export function brandFit(text) {
  const t = String(text || '');
  const hits = BRAND_SIGNALS.filter((s) => s.pattern.test(t));
  return {
    score: hits.reduce((a, b) => a + b.weight, 0),
    notes: hits.map((h) => h.note),
  };
}

/** テーマ横断で検索クエリの一覧を作る。 */
export function allKeywords() {
  return [...new Set(THEMES.flatMap((t) => t.keywords))];
}

export function themeLabel(id) {
  const t = THEMES.find((x) => x.id === id);
  return t ? t.label : id;
}

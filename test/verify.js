/**
 * 判定ロジックの回帰テスト
 *
 *   node test/verify.js
 *
 * Apps Script の実行環境を使わず、純粋関数（種別判定・クライアント名寄せ・
 * セル統合・年の解決）だけを Node.js 上で検証する。テストケースの
 * イベントタイトルは 2026/06〜08 の実カレンダーから採取した実物。
 */
const fs = require('fs');
const path = require('path');
const SRC_DIR = path.join(__dirname, '..', 'src');
const src = ['config.gs', 'util.gs', 'calendarSync.gs']
  .map(f => fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).join('\n');

const stub = `
const Utilities = { formatDate: (d) => (d.getMonth() + 1) + '/' + d.getDate() };
const SpreadsheetApp = {}, CalendarApp = { GuestStatus: { NO: 'NO' } };
const PropertiesService = {}, UrlFetchApp = {}, ScriptApp = {}, Session = {};
`;
eval(stub + src.replace(/^const CONFIG =/m, 'var CONFIG ='));

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// ---------------------------------------------------------------------------
console.log('=== 種別判定（実カレンダーのタイトル） ===');
[
  ['撮影 シースタンド せりなさん', '撮影'],
  ['NAS撮影', '撮影'],
  ['NAS様 撮影', '撮影'],
  ['撮影 RAT', '撮影'],
  ['撮影 KINS（宮中さん対応）', '撮影'],
  ['撮影_よし子先生 Podcast（あいりちゃん対応）', '撮影'],
  ['撮影_花森先生 Podcast', '撮影'],
  ['月次報告MTG シースタンド', '月次報告MTG'],
  ['インナーMTG', 'インナーMTG'],
  // 撮影に関する打ち合わせ＝撮影ではない
  ['東大恋愛YouTube 撮影前MTG', null],
  ['里凪さん シースタ撮影前MTG', null],
  ['あやべさん YT撮影前MTG', null],
  ['社外_ボンボンクリニック様 横浜村石先生撮影について', null],
  ['ランチ', null],
].forEach(([title, want]) => eq(title, detectKind(title), want));

// ---------------------------------------------------------------------------
console.log('\n=== 書き込み先の解決（E列=月次報告日 / F列=次回撮影日） ===');
eq('月次報告MTG → E列(5)', getTargetByKind('月次報告MTG').col, 5);
eq('撮影 → F列(6)', getTargetByKind('撮影').col, 6);
eq('インナーMTG → 書き込み先なし', getTargetByKind('インナーMTG'), null);

// ---------------------------------------------------------------------------
console.log('\n=== クライアント名寄せ ===');
const clients = [
  { row: 5,  name: 'よし子先生Podcast',        aliases: ['よし子先生Podcast', 'よし子先生', 'よし子'] },
  { row: 6,  name: 'ちきゅうのうたげ',          aliases: ['ちきゅうのうたげ', '地球のうたげ'] },
  { row: 7,  name: 'ボンボンクリニック（渋谷）', aliases: ['ボンボンクリニック_渋谷', 'ボンボン渋谷', '角野'] },
  { row: 8,  name: 'ボンボンクリニック（横浜）', aliases: ['ボンボンクリニック_横浜', 'ボンボン横浜', '村石'] },
  { row: 9,  name: 'パーソナルジムRAT',         aliases: ['パーソナルジムRAT', 'RAT'] },
  { row: 10, name: 'KINSプライム（下川さん）',  aliases: ['KINSプライム', 'KINS'] },
  { row: 11, name: 'シースタンド',              aliases: ['シースタンド', 'シースタ'] },
  { row: 12, name: 'NAS（スポーツクラブ）',     aliases: ['NAS'] },
];
const cname = t => { const c = matchClient(t, clients); return c ? c.name : null; };
[
  ['撮影 シースタンド せりなさん', 'シースタンド'],
  ['NAS撮影', 'NAS（スポーツクラブ）'],
  ['NAS様 撮影', 'NAS（スポーツクラブ）'],
  ['撮影 RAT', 'パーソナルジムRAT'],
  ['撮影 KINS（宮中さん対応）', 'KINSプライム（下川さん）'],
  ['撮影_よし子先生 Podcast（あいりちゃん対応）', 'よし子先生Podcast'],
  ['社外_ボンボンクリニック様 横浜村石先生撮影について', 'ボンボンクリニック（横浜）'],
  // 区切り記号のゆれ（別名は「_渋谷」、カレンダーは区切りなし）
  ['【撮影 - 宮中対応】ボンボンクリニック渋谷 14:00~', 'ボンボンクリニック（渋谷）'],
  ['【撮影 - 宮中対応】ボンボンクリニック横浜 14:00~', 'ボンボンクリニック（横浜）'],
  ['撮影_ボンボンクリニック・渋谷', 'ボンボンクリニック（渋谷）'],
  // シートに無いクライアントは拾わない
  ['撮影_花森先生 Podcast', null],
  ['東大恋愛 YouTube撮影', null],
  ['千幸さん撮影', null],
].forEach(([title, want]) => eq(title, cname(title), want));

console.log('\n--- 種別判定は区切りを詰めない（誤判定の防止） ---');
eq('「撮影 - 前田さん」は撮影のまま', detectKind('撮影 - 前田さん'), '撮影');
eq('「【撮影 - 宮中対応】…」は撮影', detectKind('【撮影 - 宮中対応】ボンボンクリニック渋谷 14:00~'), '撮影');

// ---------------------------------------------------------------------------
console.log('\n=== シート名から年を解決 ===');
const jul2026 = new Date(2026, 6, 27);
eq('7月時点の「8月」→2026', resolveYearForMonth(8, jul2026), 2026);
eq('7月時点の「12月」→2026', resolveYearForMonth(12, jul2026), 2026);
const dec2026 = new Date(2026, 11, 15);
eq('12月時点の「1月」→2027', resolveYearForMonth(1, dec2026), 2027);
eq('12月時点の「12月」→2026', resolveYearForMonth(12, dec2026), 2026);
const jan2027 = new Date(2027, 0, 10);
eq('1月時点の「12月」→2026', resolveYearForMonth(12, jan2027), 2026);

// ---------------------------------------------------------------------------
console.log('\n=== シート名の解釈 ===');
eq('2026年8月',  parseMonthSheetName('2026年8月'),  { year: 2026, month: 8 });
eq('2026年12月', parseMonthSheetName('2026年12月'), { year: 2026, month: 12 });
eq('8月（年なし）', parseMonthSheetName('8月'),      { year: null, month: 8 });
eq('前後に空白',  parseMonthSheetName(' 2026年9月 '), { year: 2026, month: 9 });
eq('日程管理',    parseMonthSheetName('日程管理'),   null);
eq('13月は不正',  parseMonthSheetName('2026年13月'), null);
eq('2026年',      parseMonthSheetName('2026年'),     null);

console.log('\n=== 別名の記号ゆれ（診断の誤検知防止） ===');
const looseRelated = (name, alias) => {
  const a = normalizeLoose(name);
  const b = normalizeLoose(alias);
  return a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
};
eq('（渋谷）と_渋谷は同一視', looseRelated('ボンボンクリニック（渋谷）', 'ボンボンクリニック_渋谷'), true);
eq('（横浜）と_横浜は同一視', looseRelated('ボンボンクリニック（横浜）', 'ボンボンクリニック_横浜'), true);
eq('NAS（スポーツクラブ）とNAS', looseRelated('NAS（スポーツクラブ）', 'NAS'), true);
eq('KINSプライム（下川さん）', looseRelated('KINSプライム（下川さん）', 'KINSプライム'), true);
eq('無関係なものは検知する', looseRelated('シースタンド', 'ボンボン横浜'), false);

console.log('\n=== セル統合（8月シート / 本日=2026-08-10） ===');
const ctx = { year: 2026, month: 8, today: new Date(2026, 7, 10) };
eq('空セルに1件',          mergeDateCell('', ['8/20'], ctx),           '8/20');
eq('複数件を日付順に',      mergeDateCell('', ['8/25', '8/20'], ctx),   '8/20, 8/25');
eq('手動入力を保持',        mergeDateCell('8/20', ['8/25'], ctx),       '8/20, 8/25');
eq('重複を排除',            mergeDateCell('8/20, 8/25', ['8/20'], ctx), '8/20, 8/25');
eq('yyyy/MM/dd を正規化',   mergeDateCell('2026/08/20', ['8/25'], ctx), '8/20, 8/25');
eq('メモ書きは末尾に残す',   mergeDateCell('未定（調整中）', ['8/20'], ctx), '8/20, 未定（調整中）');
eq('全角カンマ区切り',      mergeDateCell('8/20，8/25', [], ctx),       '8/20, 8/25');
eq('当日は残す',            mergeDateCell('8/10', [], ctx),             '8/10');

console.log('\n--- 過去日の除去（PRUNE_PAST_DATES） ---');
eq('過ぎた日付は消える',     mergeDateCell('8/5', [], ctx),              '');
eq('過去日だけ消して未来は残す', mergeDateCell('8/5, 8/20', [], ctx),    '8/20');
eq('過去日が消えてもメモは残る', mergeDateCell('8/5, 要調整', [], ctx),   '要調整');

console.log('\n--- 年跨ぎ（12月シートの「1/10」は翌年扱い） ---');
const decCtx = { year: 2026, month: 12, today: new Date(2026, 11, 20) };
eq('12月シートの1/10は未来',  mergeDateCell('1/10', [], decCtx),          '1/10');
eq('12月シートの12/1は過去',  mergeDateCell('12/1, 1/10', [], decCtx),    '1/10');

console.log(fail === 0 ? '\n✅ 全ケース成功' : `\n❌ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);

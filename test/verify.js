/**
 * 判定ロジックの回帰テスト
 *
 *   node test/verify.js
 *
 * Apps Script の実行環境を使わず、純粋関数（種別判定・クライアント名寄せ・
 * セル統合）だけを Node.js 上で検証する。テストケースのイベントタイトルは
 * 2026/06〜08 の実カレンダーから採取した実物。
 */
const fs = require('fs');
const path = require('path');
const SRC_DIR = path.join(__dirname, '..', 'src');
const src = ['config.gs', 'util.gs', 'calendarSync.gs']
  .map(f => fs.readFileSync(path.join(SRC_DIR, f), 'utf8')).join('\n');
// Apps Script 固有APIを使う部分は評価しない（純粋関数だけ取り出す）
const stub = `
const Utilities = { formatDate: (d,tz,fmt) => (d.getMonth()+1)+'/'+d.getDate() };
const SpreadsheetApp={}, CalendarApp={GuestStatus:{NO:'NO'}}, PropertiesService={}, UrlFetchApp={}, ScriptApp={};
`;
eval(stub + src.replace(/^const CONFIG =/m,'var CONFIG ='));

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n        got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// --- 実カレンダーから採取したタイトルで種別判定を検証 ---
console.log('=== 種別判定 ===');
[
  ['撮影 シースタンド せりなさん', '撮影'],
  ['NAS撮影', '撮影'],
  ['NAS様 撮影', '撮影'],
  ['撮影 RAT', '撮影'],
  ['撮影 KINS（宮中さん対応）', '撮影'],
  ['撮影_よし子先生 Podcast（あいりちゃん対応）', '撮影'],
  ['撮影_花森先生 Podcast', '撮影'],
  // 撮影ではない（除外されるべき）
  ['東大恋愛YouTube 撮影前MTG', null],
  ['里凪さん シースタ撮影前MTG', null],
  ['あやべさん YT撮影前MTG', null],
  ['社外_ボンボンクリニック様 横浜村石先生撮影について', null],
  // 撮影と無関係
  ['ゆい画伯 撮影 あいりちゃん', '撮影'],
  ['月次報告MTG シースタンド', '月次報告MTG'],
  ['インナーMTG', 'インナーMTG'],
  ['ランチ', null],
].forEach(([title, want]) => eq(title, detectKind(title), want));

// --- 別名リストによるクライアント判定 ---
console.log('\n=== クライアント名寄せ（README記載の別名リスト） ===');
const clients = [
  {row:5,  name:'よし子先生Podcast',        aliases:['よし子先生Podcast','よし子先生','よし子']},
  {row:6,  name:'ちきゅうのうたげ',          aliases:['ちきゅうのうたげ','地球のうたげ']},
  {row:7,  name:'ボンボンクリニック（渋谷）', aliases:['ボンボンクリニック_渋谷','ボンボン渋谷','角野']},
  {row:8,  name:'ボンボンクリニック（横浜）', aliases:['ボンボンクリニック_横浜','ボンボン横浜','村石']},
  {row:9,  name:'パーソナルジムRAT',         aliases:['パーソナルジムRAT','RAT']},
  {row:10, name:'KINSプライム（下川さん）',  aliases:['KINSプライム','KINS']},
  {row:11, name:'シースタンド',              aliases:['シースタンド','シースタ']},
  {row:12, name:'NAS（スポーツクラブ）',     aliases:['NAS']},
];
const cname = t => { const c = matchClient(t, clients); return c ? c.name : null; };
[
  ['撮影 シースタンド せりなさん', 'シースタンド'],
  ['NAS撮影', 'NAS（スポーツクラブ）'],
  ['NAS様 撮影', 'NAS（スポーツクラブ）'],
  ['撮影 RAT', 'パーソナルジムRAT'],
  ['撮影 KINS（宮中さん対応）', 'KINSプライム（下川さん）'],
  ['撮影_よし子先生 Podcast（あいりちゃん対応）', 'よし子先生Podcast'],
  ['里凪さん シースタ撮影前MTG', 'シースタンド'],
  ['撮影_花森先生 Podcast', null],
  ['東大恋愛 YouTube撮影', null],
].forEach(([title, want]) => eq(title, cname(title), want));

// --- セル統合 ---
console.log('\n=== 既存値との統合 ===');
eq('空セルに1件',        mergeDateCell('',            ['8/5']),        '8/5');
eq('複数件を日付順に',    mergeDateCell('',            ['8/20','8/5']), '8/5, 8/20');
eq('手動入力を保持',      mergeDateCell('8/5',         ['8/20']),       '8/5, 8/20');
eq('重複を排除',          mergeDateCell('8/5, 8/20',   ['8/5']),        '8/5, 8/20');
eq('yyyy/MM/dd を正規化', mergeDateCell('2026/08/05',  ['8/20']),       '8/5, 8/20');
eq('メモ書きは末尾に残す', mergeDateCell('未定（調整中）', ['8/5']),      '8/5, 未定（調整中）');
eq('全角カンマ区切り',    mergeDateCell('8/5，8/20',   []),             '8/5, 8/20');

console.log(fail === 0 ? '\n✅ 全ケース成功' : `\n❌ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);

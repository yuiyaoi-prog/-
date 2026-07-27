/**
 * src/ の全 .gs を1ファイルにまとめて dist/all-in-one.gs を作る。
 *
 *   node tools/build-all-in-one.js          … 生成する
 *   node tools/build-all-in-one.js --check  … 生成物が最新かだけ確認する
 *
 * Apps Script エディタに手で貼り付ける人向け。6ファイル作る代わりに
 * これ1つを貼れば済むようにするためのもの。src/ を編集したら再生成すること。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
const OUT_PATH = path.join(ROOT, 'dist', 'all-in-one.gs');

// 読みやすさのための並び。Apps Script は全ファイルを同じスコープに読み込むため
// 実行順には影響しない。
const ORDER = [
  'config.gs',
  'util.gs',
  'calendarSync.gs',
  'shootAlert.gs',
  'checkSetup.gs',
  'triggers.gs',
];

function build() {
  const header = [
    '/**',
    ' * クライアント運用状況 確認オペレーション自動化（全部入り）',
    ' *',
    ' * このファイルは src/ の各ファイルを自動で結合したものです。',
    ' * 直接編集せず、src/ を直してから次のコマンドで再生成してください。',
    ' *',
    ' *   node tools/build-all-in-one.js',
    ' *',
    ' * 【使い方】',
    ' *   1. スプレッドシートを開く →「拡張機能」→「Apps Script」',
    ' *   2. 最初からある「コード.gs」の中身を全部消す',
    ' *   3. このファイルの中身を全部貼り付けて保存',
    ' *   4. 関数プルダウンから checkSetup を選んで実行',
    ' */',
    '',
  ].join('\n');

  const body = ORDER.map(name => {
    const filePath = path.join(SRC_DIR, name);
    const content = fs.readFileSync(filePath, 'utf8').trimEnd();
    const banner = [
      '',
      '// ' + '='.repeat(76),
      `// ${name}`,
      '// ' + '='.repeat(76),
      '',
    ].join('\n');
    return banner + content + '\n';
  }).join('\n');

  return header + body;
}

const generated = build();

if (process.argv.indexOf('--check') !== -1) {
  const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : '';
  if (current !== generated) {
    console.error('dist/all-in-one.gs が src/ と一致していません。');
    console.error('  node tools/build-all-in-one.js を実行して再生成してください。');
    process.exit(1);
  }
  console.log('dist/all-in-one.gs は最新です');
} else {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, generated);
  const lines = generated.split('\n').length;
  console.log(`dist/all-in-one.gs を生成しました（${ORDER.length}ファイル / ${lines}行）`);
}

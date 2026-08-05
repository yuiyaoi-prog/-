/**
 * パーサとテーマ判定の回帰テスト。ネットワークは使わない。
 *   node trend/test/verify.mjs
 */

import assert from 'node:assert/strict';
import {
  parseCount,
  parseThreadsTimestamp,
  parseThreadsUrl,
  parseXUrl,
} from '../lib/fetchers.mjs';
import { classify, isExcluded, brandFit } from '../lib/themes.mjs';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

check('parseCount: 素の数字とカンマ区切り', () => {
  assert.equal(parseCount('117'), 117);
  assert.equal(parseCount('1,234'), 1234);
  assert.equal(parseCount(''), 0);
});

check('parseCount: 略記の単位', () => {
  assert.equal(parseCount('1.2K'), 1200);
  assert.equal(parseCount('3.9万'), 39000);
  assert.equal(parseCount('1.5M'), 1500000);
});

check('parseCount: 読めない入力は null', () => {
  assert.equal(parseCount('たくさん'), null);
  assert.equal(parseCount(null), null);
});

check('parseThreadsTimestamp: 埋め込みの表記を ISO に', () => {
  assert.equal(parseThreadsTimestamp('6:26 PM · Feb 26, 2025'), '2025-02-26T18:26:00.000Z');
  assert.equal(parseThreadsTimestamp('12:05 AM · Jan 1, 2026'), '2026-01-01T00:05:00.000Z');
  assert.equal(parseThreadsTimestamp('12:30 PM · Dec 9, 2025'), '2025-12-09T12:30:00.000Z');
});

check('parseThreadsTimestamp: 想定外の表記は null', () => {
  assert.equal(parseThreadsTimestamp('きのう'), null);
  assert.equal(parseThreadsTimestamp(''), null);
});

check('parseThreadsUrl: .com / .net / クエリ付き', () => {
  assert.deepEqual(parseThreadsUrl('https://www.threads.com/@abc_1/post/DGjzew6y5A1'), {
    author: 'abc_1',
    code: 'DGjzew6y5A1',
  });
  assert.deepEqual(parseThreadsUrl('https://www.threads.net/@abc/post/XYZ?hl=ja'), {
    author: 'abc',
    code: 'XYZ',
  });
  assert.equal(parseThreadsUrl('https://example.com/'), null);
});

check('parseXUrl: x.com / twitter.com', () => {
  assert.equal(parseXUrl('https://x.com/jack/status/20'), '20');
  assert.equal(parseXUrl('https://twitter.com/jack/status/20?s=46'), '20');
  assert.equal(parseXUrl('https://x.com/jack'), null);
});

check('classify: テーマを拾う', () => {
  assert.deepEqual(classify('ワンオペ育児がしんどい'), ['childcare']);
  assert.ok(classify('夫に期待するのをやめて経済的自立をめざす').includes('marriage'));
  assert.ok(classify('夫に期待するのをやめて経済的自立をめざす').includes('women-work'));
  assert.deepEqual(classify('今日はいい天気'), []);
});

check('isExcluded: 運用ノウハウ系を落とす', () => {
  assert.equal(isExcluded('スレッズ運用のコツを教えます'), true);
  assert.equal(isExcluded('フォロワーの増やし方まとめ'), true);
  assert.equal(isExcluded('ワンオペ育児がしんどい'), false);
});

check('brandFit: 自立・期待しない・頼るに加点', () => {
  assert.ok(brandFit('自分で稼ぐ力をつけたい').score > 0);
  assert.ok(brandFit('ベビーシッターに頼るのは当たり前').score > 0);
  assert.equal(brandFit('今日の献立').score, 0);
});

check('brandFit: 該当理由を返す', () => {
  const fit = brandFit('夫に期待しないと決めてから離婚も怖くなくなった');
  assert.ok(fit.notes.length >= 2);
});

if (process.exitCode) console.error(`\n${passed} 件成功、失敗あり`);
else console.log(`${passed} 件すべて成功`);

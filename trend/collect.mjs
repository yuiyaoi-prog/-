#!/usr/bin/env node
/**
 * 候補URLのリストを受け取り、実数（いいね数・投稿日時・本文）を付けて
 * 「直近N日以内 かつ いいねM件以上 かつ テーマに合致」で絞り込む。
 *
 *   node trend/collect.mjs --urls candidates.txt --out data/2026-08-05.json
 *   cat urls.txt | node trend/collect.mjs
 *
 * オプション：
 *   --urls <file>    候補URLのファイル（1行1URL、# 始まりはコメント）。省略時は標準入力
 *   --out <file>     結果の書き出し先。省略時は標準出力
 *   --days <n>       何日前までを対象にするか（既定 30）
 *   --min-likes <n>  いいね数の下限（既定 1000）
 *   --keep-all       絞り込まず、判定結果だけ付けて全件出す（調査用）
 *   --concurrency    同時取得数（既定 4）
 */

import fs from 'node:fs';
import { fetchPost } from './lib/fetchers.mjs';
import { classify, isExcluded, brandFit, themeLabel } from './lib/themes.mjs';

function parseArgs(argv) {
  const out = { days: 30, minLikes: 1000, concurrency: 4, keepAll: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--urls') out.urls = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a === '--min-likes') out.minLikes = Number(argv[++i]);
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--keep-all') out.keepAll = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`不明なオプション: ${a}`);
  }
  return out;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function extractUrls(raw) {
  const seen = new Set();
  const urls = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    // 行のどこかにURLがあれば拾う（検索結果を貼り付けただけでも動くように）
    const m = t.match(/https?:\/\/\S+/);
    const url = (m ? m[0] : t).replace(/[)\],.]+$/, '');
    if (!/^https?:\/\//.test(url)) continue;
    const key = url.split('?')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

/** 同時実行数を制限しつつ全件処理する。 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * いいね数を主軸に、ブランド適合とテーマ数で味付けしたスコア。
 * 桁の違うテーマ同士を並べたいので、いいね数は対数で効かせる。
 */
function score(post) {
  const likes = post.likes || 0;
  const base = likes > 0 ? Math.log10(likes) * 10 : 0;
  return Math.round((base + post.brandFit.score * 2 + post.themes.length) * 10) / 10;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
    return;
  }

  const raw = opts.urls ? fs.readFileSync(opts.urls, 'utf8') : readStdin();
  const urls = extractUrls(raw);
  if (urls.length === 0) {
    console.error('候補URLが1件もない。--urls でファイルを渡すか、標準入力から流し込む。');
    process.exit(1);
  }
  console.error(`候補 ${urls.length} 件を取得中…`);

  const cutoff = Date.now() - opts.days * 24 * 60 * 60 * 1000;
  const errors = [];

  const fetched = await mapLimit(urls, opts.concurrency, async (url) => {
    try {
      return await fetchPost(url);
    } catch (e) {
      errors.push({ url, error: e.message });
      return null;
    }
  });

  const judged = fetched.filter(Boolean).map((post) => {
    const themes = classify(post.text);
    const fit = brandFit(post.text);
    const reasons = [];
    const at = post.postedAt ? Date.parse(post.postedAt) : NaN;

    if (!Number.isFinite(at)) reasons.push('投稿日時を取得できなかった');
    else if (at < cutoff) reasons.push(`${opts.days}日より前の投稿`);
    if (post.likes == null) reasons.push('いいね数を取得できなかった');
    else if (post.likes < opts.minLikes) reasons.push(`いいね ${post.likes} 件（下限 ${opts.minLikes}）`);
    if (themes.length === 0) reasons.push('対象テーマに合致しない');
    if (isExcluded(post.text)) reasons.push('除外キーワードに該当');

    const enriched = { ...post, themes, themeLabels: themes.map(themeLabel), brandFit: fit };
    return { ...enriched, passed: reasons.length === 0, rejectedFor: reasons, score: score(enriched) };
  });

  const kept = (opts.keepAll ? judged : judged.filter((p) => p.passed)).sort(
    (a, b) => b.score - a.score,
  );

  const result = {
    generatedAt: new Date().toISOString(),
    criteria: { days: opts.days, minLikes: opts.minLikes },
    counts: {
      candidates: urls.length,
      fetched: judged.length,
      failed: errors.length,
      passed: judged.filter((p) => p.passed).length,
    },
    errors,
    posts: kept,
  };

  const json = JSON.stringify(result, null, 2);
  if (opts.out) {
    fs.mkdirSync(opts.out.replace(/\/[^/]+$/, ''), { recursive: true });
    fs.writeFileSync(opts.out, json);
    console.error(`書き出し: ${opts.out}`);
  } else {
    process.stdout.write(json + '\n');
  }
  console.error(
    `取得 ${result.counts.fetched} / 失敗 ${result.counts.failed} / 条件通過 ${result.counts.passed}`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

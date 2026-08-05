#!/usr/bin/env node
/**
 * 候補となる投稿URLを集めてくる層（discovery）。collect.mjs の手前で走らせる。
 *
 *   node trend/discover.mjs --provider apify       --days 30 > candidates.txt
 *   node trend/discover.mjs --provider threads-api --days 30 > candidates.txt
 *
 * ■ なぜ層が分かれているか
 *   「投稿を見つける」と「いいね数を知る」は、使える手段がまったく違う。
 *     - 見つける：検索が要る。公式APIか、有料スクレイパか、人力／Claude の検索。
 *     - いいね数：埋め込みの公開エンドポイントで無料で取れる（lib/fetchers.mjs）。
 *   なので discovery は差し替え可能にして、数値の取得は常に無料経路に寄せている。
 *
 * ■ provider
 *   apify        Apify の Threads / X スクレイパを叩く。要 APIFY_TOKEN。
 *                実運用の推奨。RECENT 検索ができるので「直近1ヶ月」を素直に満たせる。
 *   threads-api  Meta 公式の Threads API /keyword_search を叩く。要 THREADS_ACCESS_TOKEN。
 *                無料だが threads_keyword_search の審査通過が要る。
 *                公式APIはいいね数を返さないので、URLだけ取って collect.mjs に渡す。
 */

import { allKeywords } from './lib/themes.mjs';

function parseArgs(argv) {
  const out = { provider: 'apify', days: 30, limit: 100 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') out.provider = argv[++i];
    else if (a === '--days') out.days = Number(argv[++i]);
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--keywords') out.keywords = argv[++i].split(',');
    else throw new Error(`不明なオプション: ${a}`);
  }
  return out;
}

/**
 * Apify のアクターを同期実行し、データセットの中身を受け取る。
 * アクターIDは環境変数で差し替えられるようにしてある（提供元が消えても乗り換えられる）。
 */
async function viaApify(keywords, opts) {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error('APIFY_TOKEN が未設定。Apify のアカウント設定から発行して渡す。');
  const actor = process.env.APIFY_THREADS_ACTOR || 'parsebird~threads-search-scraper';

  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: keywords,
        searchType: 'recent',
        resultsLimit: opts.limit,
      }),
    },
  );
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}: ${await res.text()}`);
  const items = await res.json();
  return items.map((it) => it.url || it.postUrl || it.permalink).filter(Boolean);
}

/**
 * Meta 公式 Threads API のキーワード検索。
 * 返ってくるのは permalink・本文・投稿日時まで。いいね数は返らない。
 */
async function viaThreadsApi(keywords, opts) {
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error('THREADS_ACCESS_TOKEN が未設定。');
  const since = Math.floor((Date.now() - opts.days * 864e5) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const urls = [];

  for (const q of keywords) {
    const params = new URLSearchParams({
      q,
      search_type: 'TOP',
      search_mode: 'KEYWORD',
      fields: 'id,text,permalink,timestamp,username',
      since: String(since),
      until: String(until),
      limit: '100',
      access_token: token,
    });
    const res = await fetch(`https://graph.threads.net/v1.0/keyword_search?${params}`);
    if (!res.ok) {
      console.error(`  ! "${q}" 失敗 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const body = await res.json();
    for (const item of body.data || []) {
      if (item.permalink) urls.push(item.permalink);
    }
    console.error(`  "${q}" → ${(body.data || []).length} 件`);
  }
  return urls;
}

async function main() {
  const opts = parseArgs(process.argv);
  const keywords = opts.keywords || allKeywords();
  console.error(`provider=${opts.provider} キーワード ${keywords.length} 件 / 直近 ${opts.days} 日`);

  let urls;
  if (opts.provider === 'apify') urls = await viaApify(keywords, opts);
  else if (opts.provider === 'threads-api') urls = await viaThreadsApi(keywords, opts);
  else throw new Error(`未対応の provider: ${opts.provider}`);

  const unique = [...new Set(urls.map((u) => u.split('?')[0]))];
  console.error(`候補 ${unique.length} 件`);
  process.stdout.write(unique.join('\n') + '\n');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

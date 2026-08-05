/**
 * 投稿1件ぶんの実数（いいね数・投稿日時・本文）を取ってくる層。
 *
 * X も Threads も「埋め込み用」の公開エンドポイントだけを使う。
 * ログインも API キーも要らず、料金もかからない。
 *   - Threads: https://www.threads.com/@user/post/<code>/embed （サーバー描画のHTML）
 *   - X:       https://cdn.syndication.twimg.com/tweet-result?id=<id> （JSON）
 *
 * どちらも「公式に埋め込みを提供している」経路なので、
 * ログイン壁を突破するタイプのスクレイピングは行っていない。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 1.2K / 12.3万 / 1,234 / 1.5M を数値へ。読めなければ null。 */
export function parseCount(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (s === '') return 0;
  const m = s.match(/^([\d.]+)\s*([KMBkmb万億]?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { '': 1, K: 1e3, k: 1e3, M: 1e6, m: 1e6, B: 1e9, b: 1e9, 万: 1e4, 億: 1e8 };
  return Math.round(n * mult[m[2]]);
}

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/**
 * Threads 埋め込みの日時表記 "10:20 PM · Mar 9, 2026" を ISO 文字列へ。
 * 埋め込みHTMLはタイムゾーンを持たないので UTC として扱う。
 * 「直近1ヶ月」の判定では最大でも数時間ぶんの誤差にしかならない。
 */
export function parseThreadsTimestamp(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*·\s*(\w{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const [, hh, mm, ap, mon, day, year] = m;
  if (!(mon in MONTHS)) return null;
  let hour = Number(hh) % 12;
  if (ap === 'PM') hour += 12;
  return new Date(
    Date.UTC(Number(year), MONTHS[mon], Number(day), hour, Number(mm)),
  ).toISOString();
}

function decodeEntities(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#0?64;/g, '@')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Threads の投稿URLから shortcode と著者を取り出す。 */
export function parseThreadsUrl(url) {
  const m = String(url).match(/threads\.(?:net|com)\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return { author: m[1], code: m[2] };
}

/** X の投稿URLから数値IDを取り出す。 */
export function parseXUrl(url) {
  const m = String(url).match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}

/**
 * Meta は「ブラウザのページ遷移」に見えるリクエストにしかサーバー描画のHTMLを返さない。
 * Sec-Fetch-* を付けないと、中身が空のJavaScriptシェルが返ってきて何も読めない。
 */
const NAVIGATION_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Site': 'none',
};

async function get(url, headers = {}) {
  const res = await fetch(url, {
    headers: { ...NAVIGATION_HEADERS, ...headers },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/**
 * Threads の1投稿を取得する。
 * 埋め込みHTMLはスレッド全体（元投稿＋リプライ）を描画するので、
 * ActionBarCount は「先頭4つ＝元投稿ぶん」だけを使う。
 * 順番は いいね / 返信 / リポスト / 引用。
 */
export async function fetchThreadsPost(url) {
  const parsed = parseThreadsUrl(url);
  if (!parsed) throw new Error(`Threads の投稿URLとして解釈できない: ${url}`);
  const embedUrl = `https://www.threads.com/@${parsed.author}/post/${parsed.code}/embed`;
  const html = await (await get(embedUrl)).text();

  const counts = [...html.matchAll(/class="ActionBarCount">([^<]*)</g)].map((m) =>
    parseCount(m[1]),
  );
  const stamp = html.match(/class="Timestamp">([^<]*)</);
  const author = html.match(/class="AuthorIdentity"><a[^>]*><span>([^<]*)<\/span>/);
  const body = html.match(
    /class="BodyTextContainer">([\s\S]*?)<\/span><\/span><div class="PostDateContainer"/,
  );

  if (!stamp && counts.length === 0) {
    throw new Error(`埋め込みを解析できない（削除／非公開の可能性）: ${url}`);
  }

  // 返信のURLを渡すと、埋め込みはスレッドの先頭（元投稿）から描画する。
  // その場合ここで読めるのは元投稿の数値なので、取り違えないよう印を付けておく。
  const parsedAuthor = author ? author[1] : parsed.author;
  const isReplyUrl = parsedAuthor.toLowerCase() !== parsed.author.toLowerCase();

  return {
    platform: 'threads',
    id: parsed.code,
    url: `https://www.threads.com/@${parsed.author}/post/${parsed.code}`,
    author: parsedAuthor,
    text: body ? decodeEntities(body[1]).trim() : '',
    postedAt: parseThreadsTimestamp(stamp && stamp[1]),
    likes: counts[0] ?? null,
    replies: counts[1] ?? null,
    reposts: counts[2] ?? null,
    quotes: counts[3] ?? null,
    // true のとき、渡したURLは返信で、上の数値はスレッド元投稿のもの
    metricsFromThreadRoot: isReplyUrl,
  };
}

/** X の syndication エンドポイントが要求するトークンを組み立てる。 */
function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(36)
    .replace(/(0+|\.)/g, '');
}

/** X の1投稿を取得する。 */
export async function fetchXPost(url) {
  const id = parseXUrl(url) ?? (/^\d+$/.test(String(url)) ? String(url) : null);
  if (!id) throw new Error(`X の投稿URLとして解釈できない: ${url}`);
  const api =
    `https://cdn.syndication.twimg.com/tweet-result?id=${id}` +
    `&lang=ja&token=${syndicationToken(id)}`;
  const data = await (await get(api)).json();
  if (!data || data.__typename === 'TweetTombstone') {
    throw new Error(`投稿を取得できない（削除／非公開の可能性）: ${url}`);
  }
  const user = data.user || {};
  return {
    platform: 'x',
    id,
    url: `https://x.com/${user.screen_name || 'i'}/status/${id}`,
    author: user.screen_name || '',
    text: (data.text || '').trim(),
    postedAt: data.created_at ? new Date(data.created_at).toISOString() : null,
    likes: data.favorite_count ?? null,
    // syndication は返信数を返さない。リポスト・引用も同様に欠測。
    replies: data.conversation_count ?? null,
    reposts: null,
    quotes: null,
  };
}

/** URL を見てプラットフォームを判定し、適切な取得関数へ振り分ける。 */
export async function fetchPost(url) {
  if (/threads\.(net|com)/.test(url)) return fetchThreadsPost(url);
  if (/(twitter|x)\.com/.test(url)) return fetchXPost(url);
  throw new Error(`対応していないURL: ${url}`);
}

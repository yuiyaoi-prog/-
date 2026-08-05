#!/usr/bin/env node
/**
 * collect.mjs が出した JSON を、人が読めるMarkdownの収集レポートにする。
 *
 *   node trend/report.mjs data/2026-08-05.json > data/2026-08-05.md
 *
 * ここで作るのは「素材の一覧」まで。
 * トークテーマ10本への絞り込みとフック文言づくりは
 * .claude/skills/trend-pickup/SKILL.md の手順で Claude が担当する。
 */

import fs from 'node:fs';
import { THEMES, themeLabel } from './lib/themes.mjs';

const path = process.argv[2];
if (!path) {
  console.error('使い方: node trend/report.mjs <collect.mjs が出力したJSON>');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

const fmt = (n) => (n == null ? '—' : n.toLocaleString('ja-JP'));
const day = (iso) => (iso ? iso.slice(0, 10) : '日付不明');
const PLATFORM = { threads: 'Threads', x: 'X' };

const lines = [];
lines.push(`# トレンド収集レポート ${day(data.generatedAt)}`);
lines.push('');
lines.push(
  `対象条件：直近 ${data.criteria.days} 日以内 / いいね ${fmt(data.criteria.minLikes)} 件以上`,
);
lines.push(
  `候補 ${data.counts.candidates} 件 → 取得成功 ${data.counts.fetched} 件 → 条件通過 ${data.counts.passed} 件`,
);
lines.push('');

if (data.counts.passed === 0) {
  lines.push('> 条件を満たす投稿が0件だった。discovery の経路か期間の設定を見直すこと。');
  lines.push('');
}

// テーマごとに、いいね数の多い順で並べる。複数テーマに該当する投稿は両方に出す。
for (const theme of THEMES) {
  const posts = data.posts
    .filter((p) => p.themes.includes(theme.id))
    .sort((a, b) => (b.likes || 0) - (a.likes || 0));
  if (posts.length === 0) continue;

  lines.push(`## ${theme.label}（${posts.length}件）`);
  lines.push('');
  for (const p of posts) {
    const head = `**@${p.author}**（${PLATFORM[p.platform] || p.platform}／${day(p.postedAt)}）`;
    const metrics = [
      `いいね ${fmt(p.likes)}`,
      p.replies != null ? `返信 ${fmt(p.replies)}` : null,
      p.reposts != null ? `リポスト ${fmt(p.reposts)}` : null,
    ]
      .filter(Boolean)
      .join(' ／ ');
    lines.push(`### ${head}`);
    lines.push(`${metrics}`);
    lines.push('');
    const text = (p.text || '（本文なし：画像・動画のみの投稿）').replace(/\n+/g, '\n> ');
    lines.push(`> ${text}`);
    lines.push('');
    if (p.brandFit.notes.length > 0) {
      lines.push(`Mai さんに寄せられる点：${[...new Set(p.brandFit.notes)].join(' / ')}`);
    }
    if (p.metricsFromThreadRoot) {
      lines.push('※ 渡したURLは返信。上の数値はスレッド元投稿のもの。');
    }
    lines.push(`${p.url}`);
    lines.push('');
  }
}

const untagged = data.posts.filter((p) => p.themes.length === 0);
if (untagged.length > 0) {
  lines.push(`## テーマ未分類（${untagged.length}件）`);
  lines.push('');
  lines.push('本文が取れなかった動画投稿などはここに落ちる。手で見て拾えるものは拾う。');
  lines.push('');
  for (const p of untagged.sort((a, b) => (b.likes || 0) - (a.likes || 0))) {
    lines.push(
      `- @${p.author}（${day(p.postedAt)}／いいね ${fmt(p.likes)}）${p.url}`,
    );
  }
  lines.push('');
}

if (data.errors.length > 0) {
  lines.push(`## 取得できなかったURL（${data.errors.length}件）`);
  lines.push('');
  for (const e of data.errors) lines.push(`- ${e.url} — ${e.error}`);
  lines.push('');
}

process.stdout.write(lines.join('\n'));

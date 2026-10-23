# MAGI-C 業務（矢追友唯 担当分）

MAGI-C で矢追友唯が担当している案件と、それを支える自動化をまとめたリポジトリ。

## フォルダ構成

```
CLAUDE.md                  Claude Code が毎回読む共通ルール
clients/                   担当クライアントごとのフォルダ（中の CLAUDE.md に案件メモ）
automations/
  client-schedule/         クライアント別日程管理の自動化（Google Apps Script）
```

## 担当クライアント

| クライアント | フォルダ |
|---|---|
| NAS_美温 | [`clients/nas-mion/`](clients/nas-mion/) |
| 東京大学恋愛学部 | [`clients/todai-renai/`](clients/todai-renai/) |
| シースタンド | [`clients/seastand/`](clients/seastand/) |
| ボンボンクリニック清水さん | [`clients/bonbon-clinic-shimizu/`](clients/bonbon-clinic-shimizu/) |
| テルマエ（新規） | [`clients/thermae/`](clients/thermae/) |
| ペイメントテクノロジー（新規） | [`clients/payment-technology/`](clients/payment-technology/) |

## 自動で動いているもの

### このリポジトリにあるもの

| タスク | タイミング | 場所 |
|---|---|---|
| カレンダー → 日程管理シートへの同期 | 毎日 10:00 | [`automations/client-schedule/src/calendarSync.gs`](automations/client-schedule/src/calendarSync.gs) |
| 日程未確定アラート（翌月分） | 毎月25日 10:00 | [`automations/client-schedule/src/shootAlert.gs`](automations/client-schedule/src/shootAlert.gs) |
| 日程未確定アラート（当月分） | 毎週 月・水・金 10:00 | [`automations/client-schedule/src/shootAlert.gs`](automations/client-schedule/src/shootAlert.gs) |

実際に動いているのは Google Apps Script 上のコード。ここにあるのはその元ファイル。
詳しくは [`automations/client-schedule/README.md`](automations/client-schedule/README.md)。

### このリポジトリの外にあるもの

| タスク | 置き場所 | タイミング |
|---|---|---|
| 「おはよう」→ カレンダーから Todoist にタスク作成 | Claude のスキル `calendar-tasks-todoist` | 「おはよう」と発言したとき |
| Slack メンション・NAS 佐藤部長のメール → Todoist | Claude のスキル `slack-mentions-to-todoist` | 毎晩 21時 |
| まいさん向け Threads トークテーマのリサーチ | Claude の定期実行タスク | 毎月1日 9:00 |

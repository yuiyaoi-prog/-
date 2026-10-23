# MAGI-C 業務リポジトリ

MAGI-C で矢追友唯（ゆい）が担当している案件の作業場所。

## 前提

- 会社：MAGI-C
- 担当：矢追友唯（PM）
- 案件ごとの情報は `clients/<案件>/CLAUDE.md` にある。案件の作業をするときはまずそれを読む
- 担当クライアントの一覧は `README.md`

## 関係者

- 宮中翼：ディレクター
- あいり：ディレクター

## よく使う場所

- クライアント別日程管理スプレッドシート：https://docs.google.com/spreadsheets/d/1FAlgL9qF8fMEGV0bFNI2pxdnOyvFQUJroDCEyMsoeAc
- Slack「03_pm-ディレクター管理」：日程未確定アラートの通知先

## ルール

- 返答・ドキュメントは日本語で書く
- 新しい案件が増えたら `clients/` にフォルダを作り、`README.md` の一覧に追加する
- `automations/client-schedule/src/` を直したら、そのフォルダで `node tools/build-all-in-one.js` を実行して `dist/` を作り直す

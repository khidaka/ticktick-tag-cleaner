# TickTick Tag Cleaner

TickTickの繰り返しタスクを「毎朝リセット」するiOS自動化スクリプト。

毎日深夜〜早朝に自動実行し、前日の作業状態をきれいにしてから新しい1日を始めることを目的としています。

## できること

| 処理 | 対象 | 動作 |
|---|---|---|
| **ピン解除** | ピン留めされた全タスク | `isPin: false` に更新 |
| **タグ削除** | 期限内の繰り返しタスク（`postponed_*` タグ付き） | タグを削除してリセット |
| **新規遅延タグ付与** | 新たに期限切れになった繰り返しタスク | `postponed_1d` を追加、期日を今日に変更 |
| **遅延インクリメント** | 期限切れ + 既存 `postponed_Nd` タグ付き繰り返しタスク | `postponed_1d → postponed_2d → ...` と更新、期日を今日に変更 |

### `postponed_Nd` タグとは

タスクを何日間先送りしてきたかを記録するタグ。`N` が日数を示す。

- `postponed_1d`: 1日先送り済み
- `postponed_5d`: 5日先送り済み

これにより「このタスクはずっと後回しにしている」ことを一目で把握できる。

## 必要なもの

- iPhone（iOS 16以降推奨）
- [Scriptable](https://apps.apple.com/app/scriptable/id1405459188)（無料）
- TickTick Premium アカウント
- TickTick Developer アカウント（無料）

## セットアップ

詳細は [SETUP.md](./SETUP.md) を参照。

### 概要

1. [developer.ticktick.com](https://developer.ticktick.com/manage) でアプリ登録 → Client ID / Secret を取得
2. Scriptable に `TickTickOAuthSetup.js` を追加し、Client ID / Secret を設定して実行（1回のみ）
3. Scriptable に `TickTickTagCleaner.js` を追加
4. iOSショートカット + オートメーションで毎日自動実行を設定

## ファイル構成

```
ticktick-tag-cleaner/
├── TickTickOAuthSetup.js   # 1回限りのOAuth2認証スクリプト（v1.2.0）
├── TickTickTagCleaner.js   # メインのタグ管理スクリプト（v1.8.0）
├── SETUP.md                # 詳細セットアップ手順
└── README.md               # このファイル
```

## 動作ロジック詳細

```
毎朝0:00（iOSオートメーション）
│
├─ 1. 全プロジェクトのタスクを取得
│
├─ 2. ピン解除
│     └─ isPin === true のタスク全件 → isPin: false
│
├─ 3. 繰り返しタスクを走査
│     ├─ 期限内 + postponed_* タグあり
│     │     └─ タグを削除
│     ├─ 期限切れ + postponed_Nd タグあり
│     │     └─ N+1 に更新 + 期日を今日に変更
│     └─ 期限切れ + postponed_* タグなし
│           └─ postponed_1d を追加 + 期日を今日に変更
│
└─ 4. 結果をアラートで表示（またはショートカット出力）
```

## カスタマイズ

`TickTickTagCleaner.js` の先頭付近の定数を変更することで挙動を調整できます。

```javascript
const TAG_PREFIX = "postponed_";  // 管理するタグのプレフィックス
const PIN_FIELD = "isPin";        // TickTick APIのピンフィールド名
```

### ピン解除が動作しない場合

TickTick Open APIにピンフィールドの公式ドキュメントがないため、フィールド名が異なる可能性があります。
`PIN_FIELD` の値を `"pinned"` や `"isPinned"` に変更してお試しください。

## OAuth2 トークンの管理

- アクセストークンとリフレッシュトークンは iOS **Keychain** に `ticktick_tokens` というキーで保存されます
- アクセストークンの期限が切れると自動でリフレッシュします
- リフレッシュトークン自体が失効した場合（長期未使用時）は `TickTickOAuthSetup` を再実行してください

## トラブルシューティング

| 症状 | 対処法 |
|---|---|
| `トークンが見つかりません` | `TickTickOAuthSetup` を再実行 |
| `トークンのリフレッシュに失敗` | `TickTickOAuthSetup` を再実行して再認証 |
| 期日が翌日になる | タイムゾーン設定を確認（v1.7.0以降で修正済み） |
| 期間表示（〇〇 - △△）になる | `startDate` の扱いを確認（v1.6.0以降で修正済み） |
| ピン解除が動かない | `PIN_FIELD` の値を変更して試す（上記参照） |
| 一部タスクが処理されない | プロジェクトの取得漏れの可能性あり。Scriptableのログを確認 |
| 自動実行されない | ショートカットのオートメーションで「実行前に尋ねる」がオフか確認 |

## バージョン履歴

| バージョン | 日付 | 変更内容 |
|---|---|---|
| v1.8.0 | 2026-04-17 | ピン解除機能を追加 |
| v1.7.0 | 2026-04-13 | タイムゾーンバグ修正（JST環境で翌日になる問題） |
| v1.6.0 | 2026-04-13 | `startDate = dueDate` で期間表示を修正 |
| v1.5.0 | 2026-04-12 | 空文字での `startDate` クリア試行 |
| v1.4.0 | 2026-04-12 | 新たに期限切れのタスクに `postponed_1d` を自動付与 |
| v1.3.0 | 2026-04-12 | 期限切れタスクの期日を今日に変更する処理を追加 |
| v1.2.0 | 2026-04-12 | OAuth複数方式試行・エラー診断強化 |
| v1.1.0 | 2026-04-12 | 期限切れ判定と遅延タグインクリメント追加 |
| v1.0.0 | 2026-04-12 | 初回リリース |

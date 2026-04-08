# TickTick Tag Cleaner セットアップ手順

繰り返しタスク完了時に、次回タスクから `postponed_*` タグを自動削除する仕組み。

## 必要なもの

- iPhone（iOS 16以降推奨）
- [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) アプリ（無料）
- TickTick Premium アカウント
- TickTick Developer アカウント（無料で作成可能）

---

## Step 1: TickTick APIアプリを登録

1. **https://developer.ticktick.com/manage** にアクセス
2. TickTickアカウントでログイン
3. 「+App Name」をクリックしてアプリを作成
4. 以下を設定:
   - **App Name**: `TagCleaner`（任意）
   - **Redirect URI**: `https://open.scriptable.app/run/TickTickOAuthSetup`
5. 表示される **Client ID** と **Client Secret** を控える

## Step 2: Scriptableにスクリプトを追加

### 2a. TickTickOAuthSetup

1. iPhoneでScriptableアプリを開く
2. 右上の「+」で新規スクリプトを作成
3. スクリプト名を **`TickTickOAuthSetup`** に変更（名前が正確に一致する必要あり）
4. `TickTickOAuthSetup.js` の内容を貼り付け
5. **以下の2行を自分の値に書き換える:**
   ```javascript
   const CLIENT_ID = "YOUR_CLIENT_ID";       // Step 1で取得した値
   const CLIENT_SECRET = "YOUR_CLIENT_SECRET"; // Step 1で取得した値
   ```
6. 保存

### 2b. TickTickTagCleaner

1. 同様に新規スクリプトを作成
2. スクリプト名を **`TickTickTagCleaner`** に変更
3. `TickTickTagCleaner.js` の内容を貼り付け
4. 保存（このスクリプトは設定変更不要。トークン情報はKeychainから自動取得される）

## Step 3: OAuth認証を実行（1回のみ）

1. Scriptableで **TickTickOAuthSetup** を実行（▶ボタン）
2. 「ブラウザで認証（推奨）」を選択
3. TickTickのログイン画面が開くのでログイン・認可する
4. リダイレクト後、Scriptableに戻って「認証成功」と表示されれば完了

**リダイレクトがうまくいかない場合:**
- スクリプトを再実行し「認証コードを手動入力」を選択
- ブラウザのリダイレクト先URLから `code=XXXXX` の値をコピーして貼り付け

## Step 4: 動作テスト

1. TickTickで繰り返しタスクを作成し、`postponed_1d` タグを付ける
2. Scriptableで **TickTickTagCleaner** を手動実行
3. 「1件のタスクからpostponedタグを削除しました」と表示されることを確認
4. TickTickアプリでタグが消えていることを確認

## Step 5: iOSショートカットで自動化

### ショートカットの作成

1. **ショートカット** アプリを開く
2. 右上の「+」→ 「アクションを追加」
3. 「Scriptable」を検索 → **「Run Script」** を選択
4. Scriptの欄で **TickTickTagCleaner** を選択
5. ショートカット名を「TickTickタグクリア」に変更して保存

### 毎朝の自動実行を設定

1. ショートカットアプリの **「オートメーション」** タブを開く
2. 右上の「+」→ **「個人用オートメーション」**
3. **「時刻」** を選択
4. **毎日 07:00** に設定
5. **「すぐに実行」** を選択（確認なしで自動実行）
6. アクションに「ショートカットを実行」→「TickTickタグクリア」を選択
7. 完了

---

## カスタマイズ

### 削除するタグのパターンを変更

`TickTickTagCleaner.js` の以下の行を変更:

```javascript
const TAG_PREFIX = "postponed_";  // この接頭辞に一致するタグを削除
```

例: `urgent_` で始まるタグも削除したい場合は、フィルタ条件を拡張:

```javascript
const TAG_PREFIXES = ["postponed_", "urgent_"];
// ...
let filteredTags = task.tags.filter(
  tag => !TAG_PREFIXES.some(prefix => tag.startsWith(prefix))
);
```

### 実行時刻を変更

ショートカットのオートメーション設定で時刻を変更するだけ。

---

## トラブルシューティング

| 症状 | 対処法 |
|---|---|
| 「トークンが見つかりません」 | TickTickOAuthSetup を再実行 |
| 「トークンのリフレッシュに失敗」 | TickTickOAuthSetup を再実行して再認証 |
| タグが削除されない | TickTickで対象タスクに `repeatFlag` が設定されているか確認。タグ名が `postponed_` で始まっているか確認 |
| 自動実行されない | ショートカットのオートメーション設定で「実行前に尋ねる」がオフになっているか確認 |

// TickTickOAuthSetup.js
// 1回限りのOAuth2認証スクリプト（Scriptable用）
// 使い方: Scriptableアプリでこのスクリプトを実行してTickTickアカウントを認証する

// ============================================
// 設定 - developer.ticktick.com で取得した値を入力
// ============================================
const CLIENT_ID = "YOUR_CLIENT_ID";
const CLIENT_SECRET = "YOUR_CLIENT_SECRET";
const REDIRECT_URI = "https://open.scriptable.app/run/TickTickOAuthSetup";
const SCOPES = "tasks:read tasks:write";
const KEYCHAIN_KEY = "ticktick_tokens";

// ============================================
// メイン処理
// ============================================
async function main() {
  // コールバックからの起動かチェック（認証コード付き）
  const params = args.queryParameters;

  if (params && params.code) {
    await exchangeCodeForTokens(params.code);
  } else if (params && params.error) {
    await showAlert("認証エラー", `エラー: ${params.error}\n${params.error_description || ""}`);
  } else {
    // 初回起動: 認証方法を選択
    let alert = new Alert();
    alert.title = "TickTick OAuth認証";
    alert.message = "認証方法を選んでください";
    alert.addAction("ブラウザで認証（推奨）");
    alert.addAction("認証コードを手動入力");
    alert.addCancelAction("キャンセル");

    let choice = await alert.presentSheet();

    if (choice === 0) {
      openAuthPage();
    } else if (choice === 1) {
      await manualCodeEntry();
    }
  }
}

// ============================================
// ブラウザで認証ページを開く
// ============================================
function openAuthPage() {
  const authURL = "https://ticktick.com/oauth/authorize"
    + `?client_id=${encodeURIComponent(CLIENT_ID)}`
    + `&scope=${encodeURIComponent(SCOPES)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + "&response_type=code"
    + "&state=scriptable_setup";

  Safari.open(authURL);
}

// ============================================
// 手動で認証コードを入力（リダイレクトが機能しない場合のフォールバック）
// ============================================
async function manualCodeEntry() {
  // まず認証ページを開く
  let infoAlert = new Alert();
  infoAlert.title = "手動認証の手順";
  infoAlert.message = "1. 次の画面でブラウザが開きます\n"
    + "2. TickTickにログインして認可してください\n"
    + "3. リダイレクト先URLの「code=」以降の値をコピーしてください\n"
    + "4. このスクリプトに戻ってコードを貼り付けてください";
  infoAlert.addAction("ブラウザを開く");
  await infoAlert.presentAlert();

  // リダイレクトURIを一時的にlocalhostにして認証ページを開く
  const authURL = "https://ticktick.com/oauth/authorize"
    + `?client_id=${encodeURIComponent(CLIENT_ID)}`
    + `&scope=${encodeURIComponent(SCOPES)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + "&response_type=code"
    + "&state=manual_setup";

  Safari.open(authURL);

  // コード入力を待つ
  let codeAlert = new Alert();
  codeAlert.title = "認証コードを入力";
  codeAlert.message = "ブラウザのリダイレクト先URLから「code=」の値を貼り付けてください";
  codeAlert.addTextField("認証コード");
  codeAlert.addAction("送信");
  codeAlert.addCancelAction("キャンセル");

  let result = await codeAlert.presentAlert();
  if (result === -1) return;

  let code = codeAlert.textFieldValue(0).trim();
  if (!code) {
    await showAlert("エラー", "認証コードが空です");
    return;
  }

  await exchangeCodeForTokens(code);
}

// ============================================
// 認証コードをアクセストークンに交換
// ============================================
async function exchangeCodeForTokens(code) {
  try {
    let req = new Request("https://ticktick.com/oauth/token");
    req.method = "POST";
    req.headers = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // Basic認証ヘッダーを追加（TickTick APIが要求する場合）
    const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    req.headers["Authorization"] = `Basic ${basicAuth}`;

    req.body = "grant_type=authorization_code"
      + `&code=${encodeURIComponent(code)}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

    let tokenData = await req.loadJSON();

    if (!tokenData.access_token) {
      await showAlert("トークン取得失敗", JSON.stringify(tokenData, null, 2));
      return;
    }

    // Keychainに保存
    let tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      expires_at: Date.now() + ((tokenData.expires_in || 3600) * 1000),
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    };

    Keychain.set(KEYCHAIN_KEY, JSON.stringify(tokens));

    await showAlert(
      "認証成功",
      "TickTickトークンをKeychainに保存しました。\n\n"
        + `アクセストークン: ${tokenData.access_token.substring(0, 10)}...\n`
        + `リフレッシュトークン: ${tokenData.refresh_token ? "あり" : "なし"}\n`
        + `有効期限: ${tokenData.expires_in || 3600}秒`
    );
  } catch (error) {
    await showAlert("エラー", `トークン交換に失敗しました:\n${error.message}`);
  }
}

// ============================================
// ユーティリティ
// ============================================
async function showAlert(title, message) {
  let alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("OK");
  await alert.presentAlert();
}

// ============================================
// 実行
// ============================================
await main();
Script.complete();

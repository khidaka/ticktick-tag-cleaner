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
  let infoAlert = new Alert();
  infoAlert.title = "手動認証の手順";
  infoAlert.message = "1. 次の画面でブラウザが開きます\n"
    + "2. TickTickにログインして認可してください\n"
    + "3. リダイレクト先URLの「code=」以降の値をコピーしてください\n"
    + "4. このスクリプトに戻ってコードを貼り付けてください";
  infoAlert.addAction("ブラウザを開く");
  await infoAlert.presentAlert();

  const authURL = "https://ticktick.com/oauth/authorize"
    + `?client_id=${encodeURIComponent(CLIENT_ID)}`
    + `&scope=${encodeURIComponent(SCOPES)}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + "&response_type=code"
    + "&state=manual_setup";

  Safari.open(authURL);

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
// 複数の認証方式を試行（TickTick APIの仕様が環境により異なるため）
// ============================================
async function exchangeCodeForTokens(code) {
  const strategies = [
    {
      name: "Body params only",
      useBasicAuth: false,
      includeClientInBody: true,
      includeScope: false,
    },
    {
      name: "Body params + scope",
      useBasicAuth: false,
      includeClientInBody: true,
      includeScope: true,
    },
    {
      name: "Basic auth + body params",
      useBasicAuth: true,
      includeClientInBody: true,
      includeScope: true,
    },
    {
      name: "Basic auth only",
      useBasicAuth: true,
      includeClientInBody: false,
      includeScope: true,
    },
  ];

  let lastResponse = null;

  for (let strategy of strategies) {
    try {
      console.log(`Trying: ${strategy.name}`);
      let tokenData = await tryTokenExchange(code, strategy);

      if (tokenData && tokenData.access_token) {
        console.log(`Success with: ${strategy.name}`);
        await saveTokens(tokenData, strategy.name);
        return;
      }

      lastResponse = tokenData;
      console.log(`No access_token with ${strategy.name}: ${JSON.stringify(tokenData)}`);
    } catch (e) {
      lastResponse = e.message;
      console.log(`Error with ${strategy.name}: ${e.message}`);
    }
  }

  await showAlert(
    "トークン取得失敗",
    "全ての認証方式が失敗しました。\n\n"
      + `最後のレスポンス:\n${JSON.stringify(lastResponse, null, 2)}\n\n`
      + "確認事項:\n"
      + "1. Client IDとClient Secretが正しいか\n"
      + "2. developer.ticktick.comのRedirect URIが\n   " + REDIRECT_URI + "\n   と一致しているか\n"
      + "3. 認証コードが期限切れでないか（取得後すぐに使用してください）"
  );
}

async function tryTokenExchange(code, strategy) {
  let req = new Request("https://ticktick.com/oauth/token");
  req.method = "POST";
  req.headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (strategy.useBasicAuth) {
    const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    req.headers["Authorization"] = `Basic ${basicAuth}`;
  }

  let bodyParts = [
    "grant_type=authorization_code",
    `code=${encodeURIComponent(code)}`,
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
  ];

  if (strategy.includeClientInBody) {
    bodyParts.push(`client_id=${encodeURIComponent(CLIENT_ID)}`);
    bodyParts.push(`client_secret=${encodeURIComponent(CLIENT_SECRET)}`);
  }

  if (strategy.includeScope) {
    bodyParts.push(`scope=${encodeURIComponent(SCOPES)}`);
  }

  req.body = bodyParts.join("&");

  console.log(`Request body: ${req.body}`);
  console.log(`Headers: ${JSON.stringify(req.headers)}`);

  return await req.loadJSON();
}

// ============================================
// トークンを保存
// ============================================
async function saveTokens(tokenData, strategyName) {
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
      + `方式: ${strategyName}\n`
      + `アクセストークン: ${tokenData.access_token.substring(0, 10)}...\n`
      + `リフレッシュトークン: ${tokenData.refresh_token ? "あり" : "なし"}\n`
      + `有効期限: ${tokenData.expires_in || 3600}秒`
  );
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

// TickTickDiagnostic.js
// version: 1.0.0 (2026-04-17)
// ピン済みタスクの生データを確認するための診断スクリプト
// TickTickTagCleaner.js のピン解除機能が動かない場合に使用

const KEYCHAIN_KEY = "ticktick_tokens";
const API_BASE = "https://api.ticktick.com/open/v1";

async function getValidToken() {
  if (!Keychain.contains(KEYCHAIN_KEY)) {
    throw new Error("トークンが見つかりません。先にTickTickOAuthSetupを実行してください。");
  }
  let tokens = JSON.parse(Keychain.get(KEYCHAIN_KEY));
  if (Date.now() >= tokens.expires_at - 300000) {
    let req = new Request("https://ticktick.com/oauth/token");
    req.method = "POST";
    req.headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${tokens.client_id}:${tokens.client_secret}`)}`,
    };
    req.body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(tokens.refresh_token)}`;
    let tokenData = await req.loadJSON();
    tokens = {
      ...tokens,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + ((tokenData.expires_in || 3600) * 1000),
    };
    Keychain.set(KEYCHAIN_KEY, JSON.stringify(tokens));
  }
  return tokens.access_token;
}

async function getAllTasks(accessToken) {
  let req = new Request(`${API_BASE}/project`);
  req.headers = { "Authorization": `Bearer ${accessToken}` };
  let projects = await req.loadJSON();
  let allTasks = [];
  for (let project of projects) {
    try {
      let req2 = new Request(`${API_BASE}/project/${project.id}/data`);
      req2.headers = { "Authorization": `Bearer ${accessToken}` };
      let data = await req2.loadJSON();
      if (data && data.tasks) allTasks = allTasks.concat(data.tasks);
    } catch (e) {}
  }
  return allTasks;
}

async function main() {
  let accessToken = await getValidToken();
  let allTasks = await getAllTasks(accessToken);

  // ピン済みの可能性があるタスクを探す（booleanフィールドがtrueのもの）
  // 画面でピン留めしたタスク名を選んで確認
  let alert = new Alert();
  alert.title = "診断: タスク選択";
  alert.message = "ピン済みのタスク名を入力してください（部分一致）";
  alert.addTextField("タスク名の一部");
  alert.addAction("検索");
  alert.addCancelAction("キャンセル");
  let r = await alert.presentAlert();
  if (r === -1) return;

  let keyword = alert.textFieldValue(0).trim().toLowerCase();
  let matched = allTasks.filter(t => t.title && t.title.toLowerCase().includes(keyword));

  if (matched.length === 0) {
    await showAlert("見つかりません", `「${keyword}」に一致するタスクがありませんでした。`);
    return;
  }

  // 最初にマッチしたタスクのフィールドを全て表示
  let task = matched[0];
  let fields = Object.entries(task)
    .filter(([k, v]) => v !== null && v !== undefined && v !== "" && v !== 0)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");

  await showAlert(
    `「${task.title}」のフィールド`,
    fields.length > 800 ? fields.substring(0, 800) + "\n...(省略)" : fields
  );

  // booleanでtrueのフィールドだけ抽出して別途表示
  let boolTrueFields = Object.entries(task)
    .filter(([k, v]) => v === true)
    .map(([k]) => k);

  await showAlert(
    "true のbooleanフィールド（ピン候補）",
    boolTrueFields.length > 0
      ? boolTrueFields.join(", ")
      : "true のbooleanフィールドなし\n\n→ ピンは数値や別の形式かもしれません"
  );
}

async function showAlert(title, message) {
  let alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("OK");
  await alert.presentAlert();
}

await main();
Script.complete();

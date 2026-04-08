// TickTickTagCleaner.js
// 繰り返しタスクから postponed_* タグを自動削除するスクリプト（Scriptable用）
// iOSショートカットの自動化から毎日実行する

const TAG_PREFIX = "postponed_";
const KEYCHAIN_KEY = "ticktick_tokens";
const API_BASE = "https://api.ticktick.com/open/v1";

// ============================================
// トークン管理
// ============================================
async function getValidToken() {
  if (!Keychain.contains(KEYCHAIN_KEY)) {
    throw new Error("トークンが見つかりません。先にTickTickOAuthSetupを実行してください。");
  }

  let tokens = JSON.parse(Keychain.get(KEYCHAIN_KEY));

  // 有効期限の5分前にリフレッシュ
  if (Date.now() >= tokens.expires_at - 300000) {
    if (!tokens.refresh_token) {
      throw new Error("リフレッシュトークンがありません。TickTickOAuthSetupを再実行してください。");
    }
    tokens = await refreshToken(tokens);
  }

  return tokens.access_token;
}

async function refreshToken(tokens) {
  let req = new Request("https://ticktick.com/oauth/token");
  req.method = "POST";
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" };

  const basicAuth = btoa(`${tokens.client_id}:${tokens.client_secret}`);
  req.headers["Authorization"] = `Basic ${basicAuth}`;

  req.body = "grant_type=refresh_token"
    + `&refresh_token=${encodeURIComponent(tokens.refresh_token)}`;

  let tokenData = await req.loadJSON();

  if (!tokenData.access_token) {
    throw new Error("トークンのリフレッシュに失敗しました: " + JSON.stringify(tokenData));
  }

  let newTokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + ((tokenData.expires_in || 3600) * 1000),
    client_id: tokens.client_id,
    client_secret: tokens.client_secret,
  };

  Keychain.set(KEYCHAIN_KEY, JSON.stringify(newTokens));
  return newTokens;
}

// ============================================
// TickTick API呼び出し
// ============================================
async function apiGet(accessToken, path) {
  let req = new Request(`${API_BASE}${path}`);
  req.headers = { "Authorization": `Bearer ${accessToken}` };
  return await req.loadJSON();
}

async function apiPost(accessToken, path, body) {
  let req = new Request(`${API_BASE}${path}`);
  req.method = "POST";
  req.headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  req.body = JSON.stringify(body);
  return await req.loadJSON();
}

// ============================================
// 全プロジェクトの全タスクを取得
// ============================================
async function getAllTasks(accessToken) {
  let projects = await apiGet(accessToken, "/project");
  let allTasks = [];

  for (let project of projects) {
    try {
      let data = await apiGet(accessToken, `/project/${project.id}/data`);
      if (data && data.tasks) {
        allTasks = allTasks.concat(data.tasks);
      }
    } catch (e) {
      // プロジェクトにタスクがない場合などはスキップ
      console.log(`Project ${project.name}: ${e.message}`);
    }
  }

  return allTasks;
}

// ============================================
// タスクのタグを更新
// ============================================
async function updateTaskTags(accessToken, task, newTags) {
  // 必要最小限のフィールドのみ送信して安全に更新
  let updateBody = {
    id: task.id,
    projectId: task.projectId,
    tags: newTags,
  };

  return await apiPost(accessToken, `/task/${task.id}`, updateBody);
}

// ============================================
// メインロジック
// ============================================
async function main() {
  let accessToken = await getValidToken();
  let allTasks = await getAllTasks(accessToken);

  let cleaned = 0;
  let cleanedNames = [];

  for (let task of allTasks) {
    // 繰り返しタスクでないものはスキップ
    if (!task.repeatFlag) continue;

    // タグがないものはスキップ
    if (!task.tags || task.tags.length === 0) continue;

    // postponed_* タグをフィルタ
    let originalLength = task.tags.length;
    let filteredTags = task.tags.filter(
      tag => !tag.startsWith(TAG_PREFIX)
    );

    // 削除対象のタグがなければスキップ
    if (filteredTags.length === originalLength) continue;

    // タグを更新
    try {
      await updateTaskTags(accessToken, task, filteredTags);
      cleaned++;
      cleanedNames.push(task.title);
    } catch (e) {
      console.log(`タスク「${task.title}」の更新に失敗: ${e.message}`);
    }
  }

  let summary;
  if (cleaned === 0) {
    summary = "クリーンアップ対象のタスクはありませんでした。";
  } else {
    summary = `${cleaned}件のタスクからpostponedタグを削除しました:\n${cleanedNames.join("\n")}`;
  }

  return summary;
}

// ============================================
// 実行
// ============================================
try {
  let result = await main();

  if (config.runsInApp) {
    // Scriptableアプリ内で直接実行された場合
    let alert = new Alert();
    alert.title = "タグクリーンアップ完了";
    alert.message = result;
    alert.addAction("OK");
    await alert.presentAlert();
  } else {
    // ショートカットから実行された場合
    Script.setShortcutOutput(result);
  }
} catch (error) {
  let errorMsg = `エラー: ${error.message}`;

  if (config.runsInApp) {
    let alert = new Alert();
    alert.title = "エラー";
    alert.message = errorMsg;
    alert.addAction("OK");
    await alert.presentAlert();
  } else {
    Script.setShortcutOutput(errorMsg);
  }
}

Script.complete();

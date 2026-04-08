// TickTickTagCleaner.js
// 繰り返しタスクの postponed_* タグを自動管理するスクリプト（Scriptable用）
// - 期限切れでない → タグを削除
// - 期限切れ → タグの数字をインクリメントし、期日を今日に変更
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
// タスクを更新
// ============================================
async function updateTask(accessToken, task, updates) {
  let updateBody = {
    id: task.id,
    projectId: task.projectId,
    ...updates,
  };

  return await apiPost(accessToken, `/task/${task.id}`, updateBody);
}

// ============================================
// postponed_Nd タグの解析とインクリメント
// ============================================
const POSTPONED_REGEX = /^postponed_(\d+)d$/;

function parsePostponedTag(tag) {
  let match = tag.match(POSTPONED_REGEX);
  return match ? parseInt(match[1], 10) : null;
}

function incrementPostponedTag(tag) {
  let days = parsePostponedTag(tag);
  if (days === null) return tag;
  return `postponed_${days + 1}d`;
}

// ============================================
// タスクが期限切れかどうか判定
// ============================================
function isOverdue(task) {
  if (!task.dueDate) return false;
  let dueDate = new Date(task.dueDate);
  let today = new Date();
  // 日付部分のみ比較（時刻を無視）
  dueDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return dueDate < today;
}

// ============================================
// 今日の日付をISO文字列で取得（TickTick API用）
// ============================================
function todayISO() {
  let d = new Date();
  // TickTick APIのdueDate形式に合わせてISO文字列を生成
  let year = d.getFullYear();
  let month = String(d.getMonth() + 1).padStart(2, "0");
  let day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T00:00:00.000+0000`;
}

// ============================================
// メインロジック
// ============================================
async function main() {
  let accessToken = await getValidToken();
  let allTasks = await getAllTasks(accessToken);

  let cleanedTasks = [];
  let postponedTasks = [];

  for (let task of allTasks) {
    // 繰り返しタスクでないものはスキップ
    if (!task.repeatFlag) continue;

    // タグがないものはスキップ
    if (!task.tags || task.tags.length === 0) continue;

    // postponed_* タグがあるかチェック
    let hasPostponedTag = task.tags.some(tag => POSTPONED_REGEX.test(tag));
    if (!hasPostponedTag) continue;

    try {
      if (isOverdue(task)) {
        // 期限切れ: タグをインクリメントして期日を今日に変更
        let newTags = task.tags.map(tag =>
          POSTPONED_REGEX.test(tag) ? incrementPostponedTag(tag) : tag
        );
        await updateTask(accessToken, task, {
          tags: newTags,
          dueDate: todayISO(),
        });
        let oldTag = task.tags.find(tag => POSTPONED_REGEX.test(tag));
        let newTag = incrementPostponedTag(oldTag);
        postponedTasks.push(`${task.title} (${oldTag} → ${newTag})`);
      } else {
        // 期限切れでない: postponed_* タグを削除
        let filteredTags = task.tags.filter(tag => !POSTPONED_REGEX.test(tag));
        await updateTask(accessToken, task, { tags: filteredTags });
        cleanedTasks.push(task.title);
      }
    } catch (e) {
      console.log(`タスク「${task.title}」の更新に失敗: ${e.message}`);
    }
  }

  let lines = [];
  if (cleanedTasks.length > 0) {
    lines.push(`タグ削除 ${cleanedTasks.length}件:\n${cleanedTasks.join("\n")}`);
  }
  if (postponedTasks.length > 0) {
    lines.push(`遅延インクリメント ${postponedTasks.length}件:\n${postponedTasks.join("\n")}`);
  }
  if (lines.length === 0) {
    return "対象のタスクはありませんでした。";
  }
  return lines.join("\n\n");
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

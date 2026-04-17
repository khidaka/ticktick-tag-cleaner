// TickTickTagCleaner.js
// version: 1.8.0 (2026-04-17)
// 繰り返しタスクの postponed_* タグを自動管理するスクリプト（Scriptable用）
// - 期限切れでない → タグを削除
// - 期限切れ + postponedタグあり → タグの数字をインクリメントし、期日を今日に変更
// - 期限切れ + postponedタグなし → postponed_1d を付与し、期日を今日に変更
// - 全タスクのピンを解除（isPin フィールドを使用）
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
  // タスク全体をコピーし、更新内容で上書きして送信
  let updateBody = { ...task, ...updates };

  // startDateをdueDateと同じ値に揃えて期間表示を消す
  // （空文字やnullでは既存値が保持されてしまうため）
  if (updates.dueDate) {
    updateBody.startDate = updates.dueDate;
  }

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
// ローカルタイムゾーンのオフセットを使い、正しく「今日」を表現する
// ============================================
function todayISO() {
  let d = new Date();
  let year = d.getFullYear();
  let month = String(d.getMonth() + 1).padStart(2, "0");
  let day = String(d.getDate()).padStart(2, "0");

  // ローカルのタイムゾーンオフセットを算出（例: JST = +0900）
  let offsetMin = -d.getTimezoneOffset();
  let sign = offsetMin >= 0 ? "+" : "-";
  let absMin = Math.abs(offsetMin);
  let offsetH = String(Math.floor(absMin / 60)).padStart(2, "0");
  let offsetM = String(absMin % 60).padStart(2, "0");

  return `${year}-${month}-${day}T00:00:00.000${sign}${offsetH}${offsetM}`;
}

// ============================================
// ピン解除
// TickTick API のピンフィールド名: isPin
// （公式ドキュメント未記載のため、動作しない場合は下記 PIN_FIELD を変更）
// ============================================
const PIN_FIELD = "isPin";

async function unpinAllTasks(accessToken, allTasks) {
  let pinnedTasks = allTasks.filter(task => task[PIN_FIELD] === true);

  if (pinnedTasks.length === 0) return [];

  let unpinnedNames = [];
  for (let task of pinnedTasks) {
    try {
      await updateTask(accessToken, task, { [PIN_FIELD]: false });
      unpinnedNames.push(task.title);
    } catch (e) {
      console.log(`タスク「${task.title}」のピン解除に失敗: ${e.message}`);
    }
  }
  return unpinnedNames;
}

// ============================================
// メインロジック
// ============================================
async function main() {
  let accessToken = await getValidToken();
  let allTasks = await getAllTasks(accessToken);

  let cleanedTasks = [];
  let postponedTasks = [];
  let newlyPostponedTasks = [];

  for (let task of allTasks) {
    // 繰り返しタスクでないものはスキップ
    if (!task.repeatFlag) continue;

    let tags = task.tags || [];
    let hasPostponedTag = tags.some(tag => POSTPONED_REGEX.test(tag));

    try {
      if (isOverdue(task) && hasPostponedTag) {
        // 既存のpostponedタグをインクリメントして期日を今日に変更
        let newTags = tags.map(tag =>
          POSTPONED_REGEX.test(tag) ? incrementPostponedTag(tag) : tag
        );
        await updateTask(accessToken, task, {
          tags: newTags,
          dueDate: todayISO(),
          isAllDay: true,
        });
        let oldTag = tags.find(tag => POSTPONED_REGEX.test(tag));
        let newTag = incrementPostponedTag(oldTag);
        postponedTasks.push(`${task.title} (${oldTag} → ${newTag})`);
      } else if (isOverdue(task) && !hasPostponedTag) {
        // 新たに期限切れ: postponed_1d を追加して期日を今日に変更
        let newTags = [...tags, "postponed_1d"];
        await updateTask(accessToken, task, {
          tags: newTags,
          dueDate: todayISO(),
          isAllDay: true,
        });
        newlyPostponedTasks.push(task.title);
      } else if (!isOverdue(task) && hasPostponedTag) {
        // 期限切れでない: postponed_* タグを削除
        let filteredTags = tags.filter(tag => !POSTPONED_REGEX.test(tag));
        await updateTask(accessToken, task, { tags: filteredTags });
        cleanedTasks.push(task.title);
      }
    } catch (e) {
      console.log(`タスク「${task.title}」の更新に失敗: ${e.message}`);
    }
  }

  // ピン解除
  let unpinnedTasks = await unpinAllTasks(accessToken, allTasks);

  let lines = [];
  if (unpinnedTasks.length > 0) {
    lines.push(`ピン解除 ${unpinnedTasks.length}件:\n${unpinnedTasks.join("\n")}`);
  }
  if (cleanedTasks.length > 0) {
    lines.push(`タグ削除 ${cleanedTasks.length}件:\n${cleanedTasks.join("\n")}`);
  }
  if (newlyPostponedTasks.length > 0) {
    lines.push(`新規遅延 ${newlyPostponedTasks.length}件:\n${newlyPostponedTasks.join("\n")}`);
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

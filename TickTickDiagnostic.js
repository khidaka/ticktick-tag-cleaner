// TickTickDiagnostic.js
// version: 2.0.0 (2026-04-18)
// ピン済みタスクと非ピンタスクのフィールドを比較して
// 本当にピンを表すフィールドを特定するための診断スクリプト

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

async function pickTaskByKeyword(allTasks, promptText) {
  let alert = new Alert();
  alert.title = "タスク選択";
  alert.message = promptText;
  alert.addTextField("タスク名の一部");
  alert.addAction("OK");
  alert.addCancelAction("キャンセル");
  let r = await alert.presentAlert();
  if (r === -1) return null;
  let keyword = alert.textFieldValue(0).trim().toLowerCase();
  if (!keyword) return null;
  let matched = allTasks.filter(t => t.title && t.title.toLowerCase().includes(keyword));
  if (matched.length === 0) {
    await showAlert("見つかりません", `「${keyword}」に一致するタスクがありませんでした。`);
    return null;
  }
  return matched[0];
}

function formatTask(task) {
  return Object.entries(task)
    .filter(([k, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
}

async function main() {
  let accessToken = await getValidToken();
  let allTasks = await getAllTasks(accessToken);

  // sortOrder分布を把握
  let withSortOrder = allTasks.filter(t => typeof t.sortOrder === "number");
  let sorted = withSortOrder.map(t => t.sortOrder).sort((a, b) => a - b);
  let negatives = sorted.filter(v => v < 0);
  await showAlert(
    "sortOrder 分布",
    `全タスク: ${allTasks.length}\n` +
    `sortOrder あり: ${withSortOrder.length}\n` +
    `負の値: ${negatives.length}件\n` +
    `最小: ${sorted[0]}\n` +
    `最大: ${sorted[sorted.length - 1]}\n\n` +
    `負の値 上位10件（小さい順）:\n${negatives.slice(0, 10).join("\n")}`
  );

  // ピン済みタスクを指定
  let pinned = await pickTaskByKeyword(allTasks, "【ピン済み】のタスク名を入力");
  if (!pinned) return;

  // 非ピンのタスクを指定
  let normal = await pickTaskByKeyword(allTasks, "【ピンなし】のタスク名を入力");
  if (!normal) return;

  // 両方のフィールドを比較
  let pinnedStr = formatTask(pinned);
  let normalStr = formatTask(normal);

  await showAlert(
    `【ピン済み】${pinned.title}`,
    pinnedStr.length > 1200 ? pinnedStr.substring(0, 1200) + "\n..." : pinnedStr
  );
  await showAlert(
    `【ピンなし】${normal.title}`,
    normalStr.length > 1200 ? normalStr.substring(0, 1200) + "\n..." : normalStr
  );

  // 差分フィールド抽出
  let allKeys = new Set([...Object.keys(pinned), ...Object.keys(normal)]);
  let diffs = [];
  for (let k of allKeys) {
    let a = JSON.stringify(pinned[k]);
    let b = JSON.stringify(normal[k]);
    if (a !== b) diffs.push(`${k}:\n  ピン済: ${a}\n  ピンなし: ${b}`);
  }
  await showAlert(
    "差分フィールド（ピン特定の手がかり）",
    diffs.length > 0 ? (diffs.join("\n\n").substring(0, 1500)) : "差分なし"
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

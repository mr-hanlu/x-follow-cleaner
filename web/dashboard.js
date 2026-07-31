"use strict";

const DECISION_KEY = "xfc-dashboard-reviews-v1";
const state = {
  accounts: [],
  reviews: loadReviews(),
  page: 1,
  pageSize: 50,
  undo: null,
  source: "未载入",
  bridge: false
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  bridge: $("#bridge-state"), notice: $("#notice"), file: $("#csv-file"),
  sync: $("#sync-userscript"), save: $("#save-csv"), send: $("#send-queue"),
  total: $("#total-count"), filtered: $("#filtered-count"), remove: $("#remove-count"),
  errors: $("#error-count"), result: $("#result-count"), list: $("#account-list"),
  empty: $("#empty"), batch: $("#batch"), batchCount: $("#batch-count"),
  query: $("#query"), minInactive: $("#min-inactive"), maxInactive: $("#max-inactive"),
  minFollowers: $("#min-followers"), maxFollowers: $("#max-followers"),
  dataStatus: $("#data-status"), blueStatus: $("#blue-status"),
  reviewStatus: $("#review-status"), sort: $("#sort-key"), overwrite: $("#overwrite"),
  undo: $("#bulk-undo"), pagination: $(".pagination"), pageLabel: $("#page-label"),
  previous: $("#previous-page"), next: $("#next-page"), pageSize: $("#page-size")
};

function loadReviews() {
  try { return JSON.parse(localStorage.getItem(DECISION_KEY) || "{}"); }
  catch { return {}; }
}
function saveReviews() {
  localStorage.setItem(DECISION_KEY, JSON.stringify(state.reviews));
}
function number(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function boolean(value) {
  return value === true || String(value).toLowerCase() === "true";
}
function normalize(accounts) {
  return accounts
    .filter((account) => /^\d+$/.test(String(account.account_id || "")))
    .map((account) => ({
      ...account,
      account_id: String(account.account_id),
      followers_count: number(account.followers_count),
      following_count: number(account.following_count),
      inactive_days: number(account.inactive_days),
      is_blue_verified: boolean(account.is_blue_verified),
      profile_url: account.profile_url || `https://x.com/${account.screen_name}`,
      data_status: account.data_status || "",
      review_status: account.review_status || ""
    }));
}
function parseCSV(text) {
  const rows = []; let row = []; let value = ""; let quoted = false;
  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index], next = source[index + 1];
    if (character === '"') {
      if (quoted && next === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = "";
    } else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
function downloadCSV(filename, accounts) {
  const columns = [
    "account_id","screen_name","name","profile_url","is_blue_verified","verified_type",
    "followers_count","following_count","protected","last_post_at","inactive_days",
    "last_post_id","last_post_url","data_status","fetched_at","review_status",
    "unfollow_status","unfollowed_at","unfollow_http_status"
  ];
  const rows = accounts.map((account) =>
    columns.map((column) => csvCell(column === "review_status"
      ? (state.reviews[account.account_id] || account.review_status || "")
      : account[column])).join(",")
  );
  const url = URL.createObjectURL(new Blob([`\uFEFF${columns.join(",")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function reviewOf(account) {
  return state.reviews[account.account_id] || account.review_status || "";
}
function statusKind(account) {
  if (!account.fetched_at) return "pending";
  return account.data_status === "ok" ? "ok" : "error";
}
function statusLabel(account) {
  const labels = {
    ok: "已获取公开时间", protected: "帖子受保护", suspended: "账号已冻结",
    not_found: "账号不存在", empty_timeline: "尚未发帖",
    no_visible_posts: "无可见帖子", rate_limited: "请求受限",
    request_error: "请求失败", parse_error: "解析失败"
  };
  return !account.fetched_at ? "等待探测" : (labels[account.data_status] || account.data_status || "数据异常");
}
function filteredAccounts() {
  const query = elements.query.value.trim().toLowerCase();
  const minInactive = number(elements.minInactive.value), maxInactive = number(elements.maxInactive.value);
  const minFollowers = number(elements.minFollowers.value), maxFollowers = number(elements.maxFollowers.value);
  const rows = state.accounts.filter((account) => {
    const review = reviewOf(account) || "undecided";
    const haystack = `${account.name || ""} ${account.screen_name || ""} ${account.account_id}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (minInactive == null || (account.inactive_days != null && account.inactive_days >= minInactive))
      && (maxInactive == null || (account.inactive_days != null && account.inactive_days <= maxInactive))
      && (minFollowers == null || (account.followers_count != null && account.followers_count >= minFollowers))
      && (maxFollowers == null || (account.followers_count != null && account.followers_count <= maxFollowers))
      && (elements.dataStatus.value === "all" || statusKind(account) === elements.dataStatus.value)
      && (elements.blueStatus.value === "all" || (elements.blueStatus.value === "blue") === account.is_blue_verified)
      && (elements.reviewStatus.value === "all" || review === elements.reviewStatus.value);
  });
  rows.sort((left, right) => {
    switch (elements.sort.value) {
      case "inactive_asc": return (left.inactive_days ?? Infinity) - (right.inactive_days ?? Infinity);
      case "followers_desc": return (right.followers_count ?? -1) - (left.followers_count ?? -1);
      case "followers_asc": return (left.followers_count ?? Infinity) - (right.followers_count ?? Infinity);
      case "name_asc": return (left.screen_name || "").localeCompare(right.screen_name || "");
      default: return (right.inactive_days ?? -1) - (left.inactive_days ?? -1);
    }
  });
  return rows;
}
function compact(value) {
  return value == null ? "—" : new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
function dateLabel(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "无可见时间";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}
function make(tag, className, text) {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text != null) node.textContent = text; return node;
}
function accountCard(account) {
  const review = reviewOf(account) || "undecided";
  const card = make("article", `account-card review-${review}`);
  const identity = make("div", "identity");
  identity.append(make("span", "avatar", (account.name || account.screen_name || "?")[0].toUpperCase()));
  const identityText = make("div");
  const name = make("h3", "", account.name || "未知账号");
  if (account.is_blue_verified) name.append(make("i", "verified", "✓"));
  identityText.append(name, make("p", "", `@${account.screen_name || account.account_id}`), make("small", `status ${statusKind(account)}`, statusLabel(account)));
  identity.append(identityText);
  const activity = make("div", "activity");
  activity.append(make("small", "", "最后公开活动"), make("strong", "", account.inactive_days == null ? "未知" : account.inactive_days === 0 ? "今天" : `${account.inactive_days.toLocaleString("zh-CN")} 天前`), make("span", "", dateLabel(account.last_post_at)));
  const reach = make("div", "reach");
  reach.append(make("small", "", "粉丝"), make("strong", "", compact(account.followers_count)));
  const actions = make("div", "actions");
  const links = make("div", "links");
  const profile = make("a", "button primary", "打开主页"); profile.href = account.profile_url; profile.target = "_blank"; profile.rel = "noreferrer";
  links.append(profile);
  if (account.last_post_url) {
    const post = make("a", "button ghost", "最后推文"); post.href = account.last_post_url; post.target = "_blank"; post.rel = "noreferrer"; links.append(post);
  }
  const decisions = make("div", "decisions");
  [["keep","保留"],["remove","待取消"],["done","已处理"]].forEach(([value,label]) => {
    const button = make("button", `${value}${review === value ? " active" : ""}`, label);
    button.onclick = () => {
      if (state.reviews[account.account_id] === value) delete state.reviews[account.account_id];
      else state.reviews[account.account_id] = value;
      state.undo = null; saveReviews(); render();
    };
    decisions.append(button);
  });
  actions.append(links, decisions);
  card.append(identity, activity, reach, actions);
  return card;
}
function render() {
  const filtered = filteredAccounts();
  const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const rows = filtered.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  const removes = state.accounts.filter((account) => reviewOf(account) === "remove").length;
  const errors = state.accounts.filter((account) => statusKind(account) === "error").length;
  elements.total.textContent = state.accounts.length.toLocaleString("zh-CN");
  elements.filtered.textContent = filtered.length.toLocaleString("zh-CN");
  elements.remove.textContent = removes.toLocaleString("zh-CN");
  elements.errors.textContent = errors.toLocaleString("zh-CN");
  elements.result.textContent = filtered.length.toLocaleString("zh-CN");
  elements.batchCount.textContent = filtered.length.toLocaleString("zh-CN");
  elements.batch.hidden = !filtered.length;
  elements.list.replaceChildren(...rows.map(accountCard));
  elements.empty.hidden = rows.length > 0;
  elements.pagination.hidden = !filtered.length;
  elements.pageLabel.textContent = `第 ${state.page} / ${pages} 页 · 本页 ${rows.length} 个`;
  elements.previous.disabled = state.page <= 1; elements.next.disabled = state.page >= pages;
  elements.save.disabled = !state.accounts.length; elements.send.disabled = !removes;
  elements.undo.disabled = !state.undo;
  if (!rows.length) {
    elements.empty.firstElementChild.textContent = state.accounts.length ? "没有符合当前条件的账号" : "尚未载入账号数据";
    elements.empty.lastElementChild.textContent = state.accounts.length ? "请放宽或重置筛选条件。" : "从油猴同步或导入 CSV 后即可开始。";
  }
}
function loadAccounts(accounts, source) {
  state.accounts = normalize(accounts);
  for (const account of state.accounts) {
    if (["keep","remove","done"].includes(account.review_status) && !state.reviews[account.account_id]) {
      state.reviews[account.account_id] = account.review_status;
    }
  }
  saveReviews(); state.source = source; state.page = 1;
  elements.notice.textContent = `已载入 ${state.accounts.length.toLocaleString("zh-CN")} 个账号，来源：${source}。`;
  render();
}
function bulk(value) {
  const filtered = filteredAccounts();
  const targets = elements.overwrite.checked ? filtered : filtered.filter((account) => !reviewOf(account));
  if (!targets.length || !confirm(`将 ${targets.length} 个筛选结果标记为“${value === "keep" ? "保留" : "待取消"}”？`)) return;
  state.undo = targets.map((account) => [account.account_id, state.reviews[account.account_id] ?? null]);
  targets.forEach((account) => { state.reviews[account.account_id] = value; });
  saveReviews(); render();
}

window.addEventListener("xfc:bridge-ready", () => {
  state.bridge = true; elements.bridge.textContent = "油猴已连接"; elements.bridge.className = "pill good";
});
window.addEventListener("xfc:dataset", (event) => loadAccounts(event.detail?.accounts || [], "油猴本地数据"));
window.addEventListener("xfc:reviews-saved", (event) => {
  elements.notice.textContent = `已写回 ${event.detail?.saved || 0} 个标记，待取消队列 ${event.detail?.queued || 0} 人。请回到 X 页面执行。`;
});
elements.sync.onclick = () => window.dispatchEvent(new CustomEvent("xfc:request-dataset"));
elements.file.onchange = async (event) => {
  const file = event.target.files?.[0]; if (!file) return;
  loadAccounts(parseCSV(await file.text()), file.name); elements.file.value = "";
};
elements.save.onclick = () => downloadCSV(`x_following_reviewed_${new Date().toISOString().slice(0,10).replaceAll("-","")}.csv`, state.accounts);
elements.send.onclick = () => {
  if (!state.bridge) { elements.notice.textContent = "没有连接油猴脚本，请先安装对应域名版本并刷新页面。"; return; }
  const reviews = state.accounts.map((account) => ({ account_id: account.account_id, review_status: reviewOf(account) }));
  window.dispatchEvent(new CustomEvent("xfc:save-reviews", { detail: { reviews } }));
};
$("#bulk-keep").onclick = () => bulk("keep"); $("#bulk-remove").onclick = () => bulk("remove");
$("#bulk-clear").onclick = () => {
  const targets = filteredAccounts().filter((account) => reviewOf(account));
  if (!targets.length || !confirm(`清空 ${targets.length} 个筛选结果的标记？`)) return;
  state.undo = targets.map((account) => [account.account_id, state.reviews[account.account_id] ?? null]);
  targets.forEach((account) => { delete state.reviews[account.account_id]; }); saveReviews(); render();
};
elements.undo.onclick = () => {
  for (const [id, value] of state.undo || []) { if (value == null) delete state.reviews[id]; else state.reviews[id] = value; }
  state.undo = null; saveReviews(); render();
};
$("#reset-filters").onclick = () => {
  [elements.query,elements.minInactive,elements.maxInactive,elements.minFollowers,elements.maxFollowers].forEach((input) => { input.value = ""; });
  [elements.dataStatus,elements.blueStatus,elements.reviewStatus].forEach((select) => { select.value = "all"; });
  elements.sort.value = "inactive_desc"; state.page = 1; render();
};
document.querySelectorAll("[data-days]").forEach((button) => button.onclick = () => { elements.minInactive.value = button.dataset.days; state.page = 1; render(); });
$("#quick-errors").onclick = () => { elements.dataStatus.value = "error"; state.page = 1; render(); };
$("#quick-remove").onclick = () => { elements.reviewStatus.value = "remove"; state.page = 1; render(); };
[elements.query,elements.minInactive,elements.maxInactive,elements.minFollowers,elements.maxFollowers].forEach((input) => input.oninput = () => { state.page = 1; render(); });
[elements.dataStatus,elements.blueStatus,elements.reviewStatus,elements.sort].forEach((select) => select.onchange = () => { state.page = 1; render(); });
elements.pageSize.onchange = () => { state.pageSize = Number(elements.pageSize.value); state.page = 1; render(); };
elements.previous.onclick = () => { state.page -= 1; render(); $(".results").scrollIntoView({ behavior: "smooth" }); };
elements.next.onclick = () => { state.page += 1; render(); $(".results").scrollIntoView({ behavior: "smooth" }); };

render();
window.dispatchEvent(new CustomEvent("xfc:request-dataset"));

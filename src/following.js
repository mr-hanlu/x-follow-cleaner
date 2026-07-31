(function (app) {
  const FALLBACK_BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D" +
    "1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  function walk(value, callback) {
    if (!value || typeof value !== "object") return;
    callback(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      walk(child, callback);
    }
  }

  function unwrapUser(value) {
    let current = value;
    for (let index = 0; index < 7; index += 1) {
      if (
        current?.rest_id &&
        (current.core?.screen_name || current.legacy?.screen_name)
      ) return current;
      current =
        current?.user ||
        current?.result ||
        current?.user_results?.result ||
        null;
      if (!current) return null;
    }
    return null;
  }

  function usersFromPayload(payload) {
    const users = new Map();
    walk(payload, (node) => {
      if (!node.user_results?.result) return;
      const user = unwrapUser(node.user_results.result);
      if (!user) return;
      const accountId = String(user.rest_id || "");
      const screenName = user.core?.screen_name || user.legacy?.screen_name || "";
      if (!/^\d+$/.test(accountId) || !screenName) return;
      const counts = user.relationship_counts || {};
      const legacy = user.legacy || {};
      users.set(accountId, {
        account_id: accountId,
        screen_name: screenName,
        name: user.core?.name || legacy.name || "",
        profile_url: `https://x.com/${screenName}`,
        is_blue_verified: Boolean(user.is_blue_verified),
        verified_type: user.verification?.verified_type || "",
        followers_count: counts.followers ?? legacy.followers_count ?? null,
        following_count: counts.following ?? legacy.friends_count ?? null,
        protected: Boolean(user.privacy?.protected ?? legacy.protected)
      });
    });
    return Array.from(users.values());
  }

  function bottomCursor(payload) {
    let cursor = "";
    walk(payload, (node) => {
      if (node.cursorType === "Bottom" && typeof node.value === "string") {
        cursor = node.value;
      }
    });
    return cursor;
  }

  app.following = {
    running: false,
    stopRequested: false,

    async start(curlText, onProgress = () => {}) {
      if (this.running) throw new Error("关注列表导出已经在运行。");
      if (location.hostname !== "x.com") throw new Error("请在 x.com 页面执行关注列表导出。");
      const parsed = app.parseCurl(curlText);
      if (!parsed.url.pathname.includes("/Following")) {
        throw new Error("请粘贴 Network 中名称为 Following 的 cURL。");
      }
      const variablesText = parsed.url.searchParams.get("variables");
      if (!variablesText) throw new Error("Following URL 缺少 variables。");
      const originalVariables = JSON.parse(variablesText);
      const sourceUserId = String(originalVariables.userId || "");
      if (!/^\d+$/.test(sourceUserId)) throw new Error("Following 请求缺少有效 userId。");
      const csrf = app.getCookie("ct0");
      if (!csrf) throw new Error("没有读取到 ct0，请确认当前已登录 X。");

      let dataset = await app.loadDataset();
      if (dataset.source_user_id && dataset.source_user_id !== sourceUserId) {
        throw new Error("现有数据属于另一个 X 账号，请先在面板中清空数据。");
      }
      dataset.source_user_id = sourceUserId;
      let cursor = dataset.following_cursor || "";
      let page = Number(dataset.following_page || 0);
      this.running = true;
      this.stopRequested = false;

      try {
        while (!this.stopRequested && !dataset.completed_following) {
          const variables = { ...originalVariables, count: 100, includePromotedContent: false };
          if (cursor) variables.cursor = cursor;
          else delete variables.cursor;
          const url = new URL(parsed.url);
          url.searchParams.set("variables", JSON.stringify(variables));
          const headers = {
            accept: parsed.headers.accept || "*/*",
            authorization: parsed.headers.authorization || `Bearer ${FALLBACK_BEARER}`,
            "content-type": "application/json",
            "x-csrf-token": app.getCookie("ct0"),
            "x-twitter-active-user": "yes",
            "x-twitter-auth-type": "OAuth2Session",
            "x-twitter-client-language": parsed.headers["x-twitter-client-language"] || "zh-cn"
          };
          if (parsed.headers["x-client-transaction-id"]) {
            headers["x-client-transaction-id"] = parsed.headers["x-client-transaction-id"];
          }
          const response = await fetch(url, { method: "GET", credentials: "include", headers });
          if (response.status === 429) {
            throw new Error("Following 遇到 429，已保存进度并停止，请稍后继续。");
          }
          if (!response.ok) {
            throw new Error(`Following 返回 HTTP ${response.status}。`);
          }
          const payload = await response.json();
          const incoming = usersFromPayload(payload);
          const previousCursor = cursor;
          cursor = bottomCursor(payload);
          page += 1;
          app.upsertAccounts(dataset, incoming);
          dataset.following_cursor = cursor;
          dataset.following_page = page;
          dataset.completed_following =
            !cursor || cursor === previousCursor || incoming.length === 0;
          await app.saveDataset(dataset);
          onProgress({
            message: `关注列表第 ${page} 页：本页 ${incoming.length} 人，累计 ${dataset.accounts.length} 人`,
            current: dataset.accounts.length
          });
          if (!dataset.completed_following) await app.sleep(900 + Math.random() * 600);
        }
        return dataset;
      } finally {
        this.running = false;
      }
    },

    stop() {
      this.stopRequested = true;
    }
  };
})(window.XFollowCleaner);

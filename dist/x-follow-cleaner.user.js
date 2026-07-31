// ==UserScript==
// @name         X 关注清理助手
// @namespace    https://github.com/local/x-follow-cleaner
// @version      0.1.0
// @description  导出关注列表、匿名探测公开主页活跃时间，并按确认队列分批取消关注。
// @author       Local
// @match        https://x.com/*
// @match        http://localhost/*
// @icon         https://x.com/favicon.ico
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      x.com
// @noframes
// ==/UserScript==


(function () {
"use strict";
window.XFollowCleaner = window.XFollowCleaner || {};
window.XFollowCleaner.dashboardUrl = "http://localhost:8788/";

/* ---- core.js ---- */
(function (app) {
  const DATASET_KEY = "xfc:dataset:v1";
  const UNFOLLOW_TEMPLATE_KEY = "xfc:unfollow-template:v1";
  const UNFOLLOW_QUEUE_KEY = "xfc:unfollow-queue:v1";
  const SETTINGS_KEY = "xfc:settings:v1";
  const TWITTER_EPOCH_MS = 1288834974657n;

  app.constants = {
    DATASET_KEY,
    UNFOLLOW_TEMPLATE_KEY,
    UNFOLLOW_QUEUE_KEY,
    SETTINGS_KEY,
    TWITTER_EPOCH_MS,
    columns: [
      "account_id",
      "screen_name",
      "name",
      "profile_url",
      "is_blue_verified",
      "verified_type",
      "followers_count",
      "following_count",
      "protected",
      "last_post_at",
      "inactive_days",
      "last_post_id",
      "last_post_url",
      "data_status",
      "fetched_at",
      "review_status",
      "unfollow_status",
      "unfollowed_at",
      "unfollow_http_status"
    ]
  };

  app.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  app.nowIso = () => new Date().toISOString();

  app.gmGet = async function (key, fallback) {
    const value = await Promise.resolve(GM_getValue(key, fallback));
    return value == null ? fallback : value;
  };

  app.gmSet = async function (key, value) {
    await Promise.resolve(GM_setValue(key, value));
    return value;
  };

  app.gmDelete = async function (key) {
    await Promise.resolve(GM_deleteValue(key));
  };

  app.getCookie = function (name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split("; ")) {
      if (part.startsWith(prefix)) {
        return decodeURIComponent(part.slice(prefix.length));
      }
    }
    return "";
  };

  app.emptyDataset = function () {
    return {
      schema_version: "x-follow-cleaner-v1",
      source_user_id: "",
      updated_at: app.nowIso(),
      completed_following: false,
      accounts: []
    };
  };

  app.loadDataset = async function () {
    const dataset = await app.gmGet(DATASET_KEY, null);
    if (!dataset || !Array.isArray(dataset.accounts)) return app.emptyDataset();
    return dataset;
  };

  app.saveDataset = async function (dataset) {
    dataset.schema_version = "x-follow-cleaner-v1";
    dataset.updated_at = app.nowIso();
    await app.gmSet(DATASET_KEY, dataset);
    app.emit("dataset", {
      total: dataset.accounts.length,
      updated_at: dataset.updated_at
    });
    return dataset;
  };

  app.upsertAccounts = function (dataset, incoming) {
    const map = new Map(dataset.accounts.map((item) => [String(item.account_id), item]));
    for (const item of incoming) {
      const id = String(item.account_id || "");
      if (!/^\d+$/.test(id)) continue;
      map.set(id, { ...(map.get(id) || {}), ...item, account_id: id });
    }
    dataset.accounts = Array.from(map.values());
    return dataset;
  };

  app.inactiveDays = function (isoDate) {
    if (!isoDate) return null;
    const value = new Date(isoDate);
    if (Number.isNaN(value.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - value.getTime()) / 86400000));
  };

  app.snowflakeDate = function (id) {
    try {
      const timestamp = (BigInt(id) >> 22n) + TWITTER_EPOCH_MS;
      const date = new Date(Number(timestamp));
      if (date.getUTCFullYear() < 2006 || date.getTime() > Date.now() + 172800000) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  };

  app.csvCell = function (value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  };

  app.toCSV = function (accounts) {
    const columns = app.constants.columns;
    return `\uFEFF${[
      columns.join(","),
      ...accounts.map((account) => columns.map((column) => app.csvCell(account[column])).join(","))
    ].join("\n")}`;
  };

  app.parseCSV = function (text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    const source = String(text || "").replace(/^\uFEFF/, "");
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (character === '"') {
        if (quoted && next === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        row.push(value);
        value = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && next === "\n") index += 1;
        row.push(value);
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        value = "";
      } else {
        value += character;
      }
    }
    if (value || row.length) {
      row.push(value);
      rows.push(row);
    }
    if (rows.length < 2) return [];
    const headers = rows[0];
    return rows.slice(1).map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
    );
  };

  app.download = function (filename, content, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  app.events = new EventTarget();
  app.on = (name, handler) => app.events.addEventListener(name, handler);
  app.emit = (name, detail) =>
    app.events.dispatchEvent(new CustomEvent(name, { detail }));
})(window.XFollowCleaner);


/* ---- curl.js ---- */
(function (app) {
  app.tokenizeCurl = function (curlText) {
    const source = String(curlText || "").replace(/\\\r?\n/g, " ");
    const tokens = [];
    let token = "";
    let quote = "";
    const push = () => {
      if (token) tokens.push(token);
      token = "";
    };
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quote === "'") {
        if (character === "'") quote = "";
        else token += character;
      } else if (quote === '"') {
        if (character === '"') quote = "";
        else if (character === "\\" && index + 1 < source.length) token += source[++index];
        else token += character;
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === "\\" && index + 1 < source.length) {
        token += source[++index];
      } else if (/\s/.test(character)) {
        push();
      } else {
        token += character;
      }
    }
    if (quote) throw new Error("cURL 中存在未闭合的引号。");
    push();
    return tokens;
  };

  app.parseCurl = function (curlText) {
    const tokens = app.tokenizeCurl(curlText);
    let url = "";
    const headers = {};
    const dataParts = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if ((token === "--url" || token === "-X" || token === "--request") && index + 1 < tokens.length) {
        const value = tokens[++index];
        if (token === "--url") url = value;
        continue;
      }
      if (token.startsWith("--url=")) url = token.slice(6);
      if (!url && /^https?:\/\//.test(token)) url = token;
      let header = "";
      if ((token === "-H" || token === "--header") && index + 1 < tokens.length) header = tokens[++index];
      else if (token.startsWith("--header=")) header = token.slice(9);
      if (header) {
        const colon = header.indexOf(":");
        if (colon > 0) headers[header.slice(0, colon).trim().toLowerCase()] = header.slice(colon + 1).trim();
      }
      if ((token === "--data" || token === "--data-raw" || token === "--data-urlencode" || token === "-d") && index + 1 < tokens.length) {
        dataParts.push(tokens[++index]);
      } else if (token.startsWith("--data=")) {
        dataParts.push(token.slice(7));
      } else if (token.startsWith("--data-raw=")) {
        dataParts.push(token.slice(11));
      }
    }
    if (!url) throw new Error("没有从 cURL 找到请求 URL。");
    return { url: new URL(url), headers, body: dataParts.join("&") };
  };
})(window.XFollowCleaner);


/* ---- following.js ---- */
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


/* ---- profile-probe.js ---- */
(function (app) {
  function requestAnonymous(url, timeout) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: true,
        timeout,
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache"
        },
        onload: resolve,
        onerror: () => reject(new Error("匿名主页请求失败。")),
        ontimeout: () => reject(new Error("匿名主页请求超时。"))
      });
    });
  }

  function pageStatus(documentNode, candidates) {
    if (candidates.length) return "ok";
    const text = (documentNode.body?.textContent || "").toLocaleLowerCase();
    if (text.includes("these posts are protected") || text.includes("这些帖子受到保护")) return "protected";
    if (text.includes("account suspended") || text.includes("账号已被冻结")) return "suspended";
    if (text.includes("this account doesn") || text.includes("此账号不存在")) return "not_found";
    if (text.includes("hasn’t posted") || text.includes("hasn't posted") || text.includes("尚未发帖")) return "empty_timeline";
    return "no_visible_posts";
  }

  app.parsePublicProfile = function (html, account) {
    const documentNode = new DOMParser().parseFromString(html, "text/html");
    const articles = Array.from(documentNode.querySelectorAll("article")).filter(
      (article) => !article.parentElement?.closest("article")
    );
    const candidates = new Map();
    const statusPattern = /^\/([^/?#]+)\/status\/(\d+)(?:$|[/?#])/i;
    for (const article of articles) {
      const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));
      for (const link of links) {
        let pathname = "";
        try {
          pathname = new URL(link.getAttribute("href"), "https://x.com").pathname;
        } catch {
          continue;
        }
        const match = statusPattern.exec(pathname);
        if (!match) continue;
        const [, author, id] = match;
        const date = app.snowflakeDate(id);
        if (!date) continue;
        candidates.set(id, {
          id,
          author,
          at: date.toISOString(),
          url: `https://x.com/${author}/status/${id}`
        });
      }
    }
    const latest = Array.from(candidates.values()).sort((left, right) =>
      right.at.localeCompare(left.at)
    )[0] || null;
    const status = pageStatus(documentNode, Array.from(candidates.values()));
    return {
      ...account,
      last_post_at: latest?.at || "",
      inactive_days: latest ? app.inactiveDays(latest.at) : null,
      last_post_id: latest?.id || "",
      last_post_url: latest?.url || "",
      data_status: status,
      fetched_at: app.nowIso()
    };
  };

  app.profileProbe = {
    running: false,
    stopRequested: false,

    async start(options = {}, onProgress = () => {}) {
      if (this.running) throw new Error("匿名主页探测已经在运行。");
      let dataset = await app.loadDataset();
      if (!dataset.accounts.length) throw new Error("请先导出关注列表。");
      const intervalMs = Math.max(500, Number(options.intervalMs || 3000));
      const limit = Math.max(0, Number(options.limit || 0));
      const retryFailed = Boolean(options.retryFailed);
      const transient = new Set(["rate_limited", "request_error", "parse_error"]);
      let targets = dataset.accounts.filter((account) =>
        retryFailed
          ? account.data_status !== "ok"
          : !account.fetched_at ||
            transient.has(account.data_status) ||
            String(account.data_status || "").startsWith("http_")
      );
      if (limit) targets = targets.slice(0, limit);
      this.running = true;
      this.stopRequested = false;
      let completed = 0;

      try {
        for (const target of targets) {
          if (this.stopRequested) break;
          let result;
          try {
            const response = await requestAnonymous(
              `https://x.com/${encodeURIComponent(target.screen_name)}`,
              30000
            );
            if (response.status === 429) {
              result = {
                ...target,
                data_status: "rate_limited",
                fetched_at: app.nowIso()
              };
              app.upsertAccounts(dataset, [result]);
              await app.saveDataset(dataset);
              throw new Error("匿名主页请求遇到 429，已保存进度并停止。");
            }
            if (response.status !== 200) {
              result = {
                ...target,
                data_status: `http_${response.status}`,
                fetched_at: app.nowIso()
              };
            } else {
              result = app.parsePublicProfile(response.responseText, target);
            }
          } catch (error) {
            if (String(error.message || error).includes("429")) throw error;
            result = {
              ...target,
              data_status: "request_error",
              fetched_at: app.nowIso()
            };
          }
          app.upsertAccounts(dataset, [result]);
          await app.saveDataset(dataset);
          completed += 1;
          onProgress({
            message: `匿名探测 ${completed}/${targets.length}：@${target.screen_name} ${result.data_status}`,
            current: completed,
            total: targets.length
          });
          if (completed < targets.length) {
            await app.sleep(intervalMs + Math.random() * Math.min(intervalMs * 0.35, 1500));
          }
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


/* ---- unfollow.js ---- */
(function (app) {
  function sanitizedTemplate(curlText) {
    const parsed = app.parseCurl(curlText);
    if (parsed.url.pathname !== "/i/api/1.1/friendships/destroy.json") {
      throw new Error("请粘贴 friendships/destroy.json 的 cURL。");
    }
    const params = Object.fromEntries(new URLSearchParams(parsed.body));
    delete params.user_id;
    const allowedHeaders = {};
    for (const key of [
      "accept",
      "authorization",
      "content-type",
      "x-twitter-active-user",
      "x-twitter-auth-type",
      "x-twitter-client-language",
      "x-client-transaction-id"
    ]) {
      if (parsed.headers[key]) allowedHeaders[key] = parsed.headers[key];
    }
    return {
      url: `${parsed.url.origin}${parsed.url.pathname}`,
      headers: allowedHeaders,
      params,
      saved_at: app.nowIso()
    };
  }

  app.unfollow = {
    running: false,
    stopRequested: false,

    async saveTemplate(curlText) {
      const template = sanitizedTemplate(curlText);
      await app.gmSet(app.constants.UNFOLLOW_TEMPLATE_KEY, template);
      return template;
    },

    async queueAccounts(accounts) {
      const dataset = await app.loadDataset();
      const known = new Map(dataset.accounts.map((account) => [String(account.account_id), account]));
      const queue = [];
      for (const value of accounts) {
        const id = String(value.account_id || value || "");
        if (!/^\d+$/.test(id) || !known.has(id)) continue;
        const account = known.get(id);
        account.review_status = "remove";
        queue.push({
          account_id: id,
          screen_name: account.screen_name,
          status: account.unfollow_status === "success" ? "success" : "pending"
        });
      }
      await app.saveDataset(dataset);
      await app.gmSet(app.constants.UNFOLLOW_QUEUE_KEY, queue);
      return queue;
    },

    async start(options = {}, onProgress = () => {}) {
      if (this.running) throw new Error("取消关注任务已经在运行。");
      if (location.hostname !== "x.com") throw new Error("请在 x.com 页面执行取消关注。");
      const template = await app.gmGet(app.constants.UNFOLLOW_TEMPLATE_KEY, null);
      if (!template) throw new Error("请先粘贴并保存 destroy.json cURL。");
      const csrf = app.getCookie("ct0");
      if (!csrf) throw new Error("没有读取到 ct0，请确认已登录 X。");
      let queue = await app.gmGet(app.constants.UNFOLLOW_QUEUE_KEY, []);
      const batchSize = Math.min(50, Math.max(1, Number(options.batchSize || 10)));
      const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
      const targets = queue.filter((item) => item.status !== "success").slice(0, batchSize);
      if (!targets.length) throw new Error("没有待取消账号。");
      let dataset = await app.loadDataset();
      const map = new Map(dataset.accounts.map((account) => [String(account.account_id), account]));
      this.running = true;
      this.stopRequested = false;

      try {
        for (let index = 0; index < targets.length; index += 1) {
          if (this.stopRequested) break;
          const target = targets[index];
          const headers = {
            ...template.headers,
            "content-type": "application/x-www-form-urlencoded",
            "x-csrf-token": app.getCookie("ct0")
          };
          const body = new URLSearchParams({ ...template.params, user_id: target.account_id });
          let status = "failed";
          let httpStatus = 0;
          try {
            const response = await fetch(template.url, {
              method: "POST",
              credentials: "include",
              headers,
              body
            });
            httpStatus = response.status;
            if (response.status === 429) {
              throw new Error("取消关注遇到 429，已保存进度并停止。");
            }
            status = response.ok ? "success" : "failed";
          } catch (error) {
            if (String(error.message || error).includes("429")) throw error;
          }
          const queueItem = queue.find((item) => item.account_id === target.account_id);
          if (queueItem) queueItem.status = status;
          const account = map.get(target.account_id);
          if (account) {
            account.unfollow_status = status;
            account.unfollow_http_status = httpStatus || "";
            if (status === "success") {
              account.unfollowed_at = app.nowIso();
              account.review_status = "done";
            }
          }
          await app.gmSet(app.constants.UNFOLLOW_QUEUE_KEY, queue);
          await app.saveDataset(dataset);
          onProgress({
            message: `取消关注 ${index + 1}/${targets.length}：@${target.screen_name || target.account_id} ${status}`,
            current: index + 1,
            total: targets.length
          });
          if (index + 1 < targets.length) await app.sleep(intervalMs);
        }
        return queue;
      } finally {
        this.running = false;
      }
    },

    stop() {
      this.stopRequested = true;
    }
  };
})(window.XFollowCleaner);


/* ---- bridge.js ---- */
(function (app) {
  app.bridge = {
    install() {
      if (location.hostname === "x.com") return;

      window.addEventListener("xfc:request-dataset", async () => {
        const dataset = await app.loadDataset();
        window.dispatchEvent(
          new CustomEvent("xfc:dataset", {
            detail: {
              schema_version: dataset.schema_version,
              updated_at: dataset.updated_at,
              accounts: dataset.accounts
            }
          })
        );
      });

      window.addEventListener("xfc:save-reviews", async (event) => {
        const reviews = Array.isArray(event.detail?.reviews) ? event.detail.reviews : [];
        const dataset = await app.loadDataset();
        const map = new Map(dataset.accounts.map((account) => [String(account.account_id), account]));
        for (const review of reviews) {
          const id = String(review.account_id || "");
          const status = String(review.review_status || "");
          if (!map.has(id) || !["", "keep", "remove", "done"].includes(status)) continue;
          map.get(id).review_status = status;
        }
        await app.saveDataset(dataset);
        const queue = await app.unfollow.queueAccounts(
          dataset.accounts.filter((account) => account.review_status === "remove")
        );
        window.dispatchEvent(
          new CustomEvent("xfc:reviews-saved", {
            detail: { saved: reviews.length, queued: queue.filter((item) => item.status !== "success").length }
          })
        );
      });

      window.dispatchEvent(new CustomEvent("xfc:bridge-ready"));
    }
  };
})(window.XFollowCleaner);


/* ---- panel.js ---- */
(function (app) {
  const styles = `
    #xfc-launch{position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:11px 16px;background:#0f1419;color:#fff;font:700 13px system-ui;box-shadow:0 10px 35px #0004;cursor:pointer}
    #xfc-panel{position:fixed;right:18px;bottom:70px;z-index:2147483647;width:min(430px,calc(100vw - 28px));max-height:78vh;overflow:auto;border:1px solid #cfd9de;border-radius:18px;background:#fff;color:#0f1419;box-shadow:0 24px 80px #0005;font:13px/1.45 system-ui}
    #xfc-panel[hidden]{display:none}#xfc-panel header{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:15px 17px;background:#fff;border-bottom:1px solid #eff3f4}
    #xfc-panel h2,#xfc-panel p{margin:0}#xfc-panel h2{font-size:17px}#xfc-panel main{padding:14px 17px 18px}#xfc-panel section{padding:13px 0;border-bottom:1px solid #eff3f4}
    #xfc-panel section:last-child{border:0}#xfc-panel h3{margin:0 0 9px;font-size:13px}#xfc-panel textarea{width:100%;height:90px;box-sizing:border-box;padding:9px;border:1px solid #cfd9de;border-radius:9px;font:11px/1.4 ui-monospace,monospace;resize:vertical}
    #xfc-panel .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}#xfc-panel button,#xfc-panel a.xfc-btn{border:1px solid #cfd9de;border-radius:999px;padding:7px 11px;background:#fff;color:#0f1419;text-decoration:none;font:700 12px system-ui;cursor:pointer}
    #xfc-panel button.primary{background:#0f1419;color:#fff;border-color:#0f1419}#xfc-panel button.danger{background:#b42318;color:#fff;border-color:#b42318}
    #xfc-panel label{display:flex;flex-direction:column;gap:4px;color:#536471;font-size:11px}#xfc-panel input{width:92px;padding:6px 8px;border:1px solid #cfd9de;border-radius:8px}#xfc-panel input[type=checkbox]{width:auto;padding:0}
    #xfc-log{min-height:44px;margin-top:10px;padding:9px;border-radius:9px;background:#f7f9f9;color:#536471;white-space:pre-wrap}
  `;

  function el(id) {
    return document.getElementById(id);
  }

  app.panel = {
    mounted: false,
    mount() {
      if (this.mounted || location.hostname !== "x.com") return;
      this.mounted = true;
      const style = document.createElement("style");
      style.textContent = styles;
      document.head.append(style);
      document.body.insertAdjacentHTML("beforeend", `
        <button id="xfc-launch" type="button">关注清理助手</button>
        <aside id="xfc-panel" hidden>
          <header><h2>关注清理助手</h2><button id="xfc-close">关闭</button></header>
          <main>
            <section>
              <h3>1. 导出关注列表（登录态）</h3>
              <textarea id="xfc-following-curl" placeholder="粘贴 Following 的 Copy as cURL (bash)"></textarea>
              <div class="row"><button class="primary" id="xfc-following-start">开始 / 继续导出</button></div>
            </section>
            <section>
              <h3>2. 匿名探测公开主页</h3>
              <div class="row">
                <label>本次最多<input id="xfc-probe-limit" type="number" min="0" value="50"></label>
                <label>间隔（秒）<input id="xfc-probe-delay" type="number" min="1" value="3"></label>
                <label><span>范围</span><span><input id="xfc-retry-failed" type="checkbox">重试全部异常</span></label>
              </div>
              <div class="row"><button class="primary" id="xfc-probe-start">开始探测</button><button id="xfc-stop">安全停止</button></div>
            </section>
            <section>
              <h3>3. 筛选与导出</h3>
              <div class="row"><a class="xfc-btn" id="xfc-dashboard" target="_blank" rel="noreferrer">打开筛选页面</a><button id="xfc-export">导出当前 CSV</button><button id="xfc-clear-data">清空本地数据</button></div>
            </section>
            <section>
              <h3>4. 分批取消关注（登录态）</h3>
              <textarea id="xfc-destroy-curl" placeholder="粘贴 friendships/destroy.json 的 Copy as cURL (bash)"></textarea>
              <div class="row"><button id="xfc-save-destroy">保存请求模板</button></div>
              <div class="row">
                <label>本批数量<input id="xfc-batch-size" type="number" min="1" max="50" value="10"></label>
                <label>间隔（秒）<input id="xfc-unfollow-delay" type="number" min="1" value="5"></label>
              </div>
              <div class="row"><button class="danger" id="xfc-unfollow-start">确认并执行一批</button></div>
            </section>
            <div id="xfc-log">等待操作。</div>
          </main>
        </aside>
      `);
      el("xfc-dashboard").href = app.dashboardUrl;
      const log = (value) => {
        el("xfc-log").textContent = value;
        app.emit("log", { message: value });
      };
      el("xfc-launch").onclick = () => { el("xfc-panel").hidden = !el("xfc-panel").hidden; };
      el("xfc-close").onclick = () => { el("xfc-panel").hidden = true; };
      el("xfc-following-start").onclick = async () => {
        try {
          const curl = el("xfc-following-curl").value;
          el("xfc-following-curl").value = "";
          await app.following.start(curl, ({ message }) => log(message));
          log("关注列表导出完成。");
        } catch (error) { log(error.message || String(error)); }
      };
      el("xfc-probe-start").onclick = async () => {
        try {
          await app.profileProbe.start({
            limit: Number(el("xfc-probe-limit").value),
            intervalMs: Number(el("xfc-probe-delay").value) * 1000,
            retryFailed: el("xfc-retry-failed").checked
          }, ({ message }) => log(message));
          log("本轮匿名探测结束。");
        } catch (error) { log(error.message || String(error)); }
      };
      el("xfc-stop").onclick = () => {
        app.following.stop();
        app.profileProbe.stop();
        app.unfollow.stop();
        log("已请求安全停止，将在当前请求结束后暂停。");
      };
      el("xfc-export").onclick = async () => {
        const dataset = await app.loadDataset();
        app.download("x_following_cleaner.csv", app.toCSV(dataset.accounts), "text/csv;charset=utf-8");
      };
      el("xfc-clear-data").onclick = async () => {
        if (!confirm("确认清空关注列表、探测结果和取消队列？请先导出 CSV 备份。")) return;
        await app.gmDelete(app.constants.DATASET_KEY);
        await app.gmDelete(app.constants.UNFOLLOW_QUEUE_KEY);
        log("本地关注数据和取消队列已清空。");
      };
      el("xfc-save-destroy").onclick = async () => {
        try {
          await app.unfollow.saveTemplate(el("xfc-destroy-curl").value);
          el("xfc-destroy-curl").value = "";
          log("destroy.json 请求模板已保存，不保存 Cookie 和 ct0。");
        } catch (error) { log(error.message || String(error)); }
      };
      el("xfc-unfollow-start").onclick = async () => {
        const size = Number(el("xfc-batch-size").value);
        if (!confirm(`确认执行最多 ${size} 个取消关注请求？`)) return;
        try {
          await app.unfollow.start({
            batchSize: size,
            intervalMs: Number(el("xfc-unfollow-delay").value) * 1000
          }, ({ message }) => log(message));
          log("本批取消关注执行结束。");
        } catch (error) { log(error.message || String(error)); }
      };
    }
  };
})(window.XFollowCleaner);


/* ---- main.js ---- */
(function (app) {
  if (location.hostname === "x.com") {
    app.panel.mount();
    GM_registerMenuCommand("打开关注清理助手", () => {
      const panel = document.getElementById("xfc-panel");
      if (panel) panel.hidden = false;
    });
    GM_registerMenuCommand("导出当前 CSV", async () => {
      const dataset = await app.loadDataset();
      app.download("x_following_cleaner.csv", app.toCSV(dataset.accounts), "text/csv;charset=utf-8");
    });
  } else {
    app.bridge.install();
  }
})(window.XFollowCleaner);

})();

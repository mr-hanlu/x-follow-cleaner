(function (app) {
  const DATASET_KEY = "xfc:dataset:v1";
  const ACTIVE_SOURCE_KEY = "xfc:active-source:v1";
  const DATASET_PREFIX = "xfc:dataset:v2:";
  const UNFOLLOW_TEMPLATE_KEY = "xfc:unfollow-template:v1";
  const UNFOLLOW_TEMPLATE_PREFIX = "xfc:unfollow-template:v2:";
  const UNFOLLOW_QUEUE_KEY = "xfc:unfollow-queue:v1";
  const UNFOLLOW_QUEUE_PREFIX = "xfc:unfollow-queue:v2:";
  const SETTINGS_KEY = "xfc:settings:v1";
  const TWITTER_EPOCH_MS = 1288834974657n;

  app.constants = {
    DATASET_KEY,
    ACTIVE_SOURCE_KEY,
    DATASET_PREFIX,
    UNFOLLOW_TEMPLATE_KEY,
    UNFOLLOW_TEMPLATE_PREFIX,
    UNFOLLOW_QUEUE_KEY,
    UNFOLLOW_QUEUE_PREFIX,
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

  app.log = function (level, scope, message, details) {
    const normalizedLevel = ["debug", "info", "warn", "error"].includes(level)
      ? level
      : "info";
    const prefix = `[XFC][${scope}][${new Date().toLocaleTimeString()}]`;
    const method = normalizedLevel === "debug" ? "debug" : normalizedLevel;
    if (details === undefined) console[method](`${prefix} ${message}`);
    else console[method](`${prefix} ${message}`, details);
    app.emit("log", { level: normalizedLevel, scope, message, details });
  };

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

  app.getLoggedAccountId = function () {
    const twid = app.getCookie("twid");
    const match = /u=(\d+)/.exec(twid) || /u%3D(\d+)/i.exec(twid);
    return match?.[1] || "";
  };

  app.datasetKey = (sourceUserId) => `${DATASET_PREFIX}${sourceUserId}`;
  app.queueKey = (sourceUserId) => `${UNFOLLOW_QUEUE_PREFIX}${sourceUserId}`;
  app.templateKey = (sourceUserId) => `${UNFOLLOW_TEMPLATE_PREFIX}${sourceUserId}`;

  app.getActiveSourceId = async function () {
    return String(await app.gmGet(ACTIVE_SOURCE_KEY, "") || "");
  };

  app.setActiveSourceId = async function (sourceUserId) {
    const value = String(sourceUserId || "");
    if (!/^\d+$/.test(value)) throw new Error("无效的源账号 ID。");
    await app.gmSet(ACTIVE_SOURCE_KEY, value);
    return value;
  };

  app.emptyDataset = function (sourceUserId = "") {
    return {
      schema_version: "x-follow-cleaner-v1",
      source_user_id: String(sourceUserId || ""),
      updated_at: app.nowIso(),
      completed_following: false,
      accounts: []
    };
  };

  app.loadDataset = async function (sourceUserId = "") {
    let resolvedSource = String(sourceUserId || "");
    if (!resolvedSource) resolvedSource = await app.getActiveSourceId();
    if (resolvedSource) {
      const isolated = await app.gmGet(app.datasetKey(resolvedSource), null);
      if (isolated && Array.isArray(isolated.accounts)) return isolated;
    }

    const legacy = await app.gmGet(DATASET_KEY, null);
    if (legacy && Array.isArray(legacy.accounts) && legacy.source_user_id) {
      const legacySource = String(legacy.source_user_id);
      if (!resolvedSource || resolvedSource === legacySource) {
        await app.gmSet(app.datasetKey(legacySource), legacy);
        await app.setActiveSourceId(legacySource);
        const legacyQueue = await app.gmGet(UNFOLLOW_QUEUE_KEY, null);
        if (Array.isArray(legacyQueue)) {
          await app.gmSet(app.queueKey(legacySource), legacyQueue);
        }
        const legacyTemplate = await app.gmGet(UNFOLLOW_TEMPLATE_KEY, null);
        if (legacyTemplate) {
          await app.gmSet(app.templateKey(legacySource), legacyTemplate);
        }
        await app.gmDelete(DATASET_KEY);
        await app.gmDelete(UNFOLLOW_QUEUE_KEY);
        await app.gmDelete(UNFOLLOW_TEMPLATE_KEY);
        app.log("info", "Storage", "旧版数据已迁移到账号隔离存储", {
          source_user_id: legacySource,
          accounts: legacy.accounts.length
        });
        return legacy;
      }
    }
    return app.emptyDataset(resolvedSource);
  };

  app.saveDataset = async function (dataset) {
    const sourceUserId = String(dataset.source_user_id || "");
    if (!/^\d+$/.test(sourceUserId)) {
      throw new Error("数据集缺少有效 source_user_id，无法保存。");
    }
    dataset.schema_version = "x-follow-cleaner-v1";
    dataset.updated_at = app.nowIso();
    await app.setActiveSourceId(sourceUserId);
    await app.gmSet(app.datasetKey(sourceUserId), dataset);
    app.emit("dataset", {
      total: dataset.accounts.length,
      updated_at: dataset.updated_at
    });
    return dataset;
  };

  app.loadUnfollowQueue = async function (sourceUserId = "") {
    const resolvedSource = String(sourceUserId || await app.getActiveSourceId());
    if (!resolvedSource) return [];
    const queue = await app.gmGet(app.queueKey(resolvedSource), null);
    if (Array.isArray(queue)) return queue;
    return [];
  };

  app.saveUnfollowQueue = async function (queue, sourceUserId = "") {
    const resolvedSource = String(sourceUserId || await app.getActiveSourceId());
    if (!/^\d+$/.test(resolvedSource)) {
      throw new Error("没有活动账号，无法保存取消队列。");
    }
    await app.gmSet(app.queueKey(resolvedSource), queue);
    return queue;
  };

  app.loadUnfollowTemplate = async function (sourceUserId = "") {
    const resolvedSource = String(sourceUserId || await app.getActiveSourceId());
    if (!resolvedSource) return null;
    return app.gmGet(app.templateKey(resolvedSource), null);
  };

  app.saveUnfollowTemplate = async function (template, sourceUserId = "") {
    const resolvedSource = String(sourceUserId || await app.getActiveSourceId());
    if (!/^\d+$/.test(resolvedSource)) {
      throw new Error("没有活动账号，无法保存取消请求模板。");
    }
    await app.gmSet(app.templateKey(resolvedSource), template);
    return template;
  };

  app.clearActiveData = async function () {
    const sourceUserId = await app.getActiveSourceId();
    if (!sourceUserId) return "";
    await app.gmDelete(app.datasetKey(sourceUserId));
    await app.gmDelete(app.queueKey(sourceUserId));
    await app.gmDelete(app.templateKey(sourceUserId));
    await app.gmDelete(ACTIVE_SOURCE_KEY);
    return sourceUserId;
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

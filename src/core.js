(function (app) {
  const DATASET_KEY = "xfc:dataset:v1";
  const ACTIVE_SOURCE_KEY = "xfc:active-source:v1";
  const DATASET_PREFIX = "xfc:dataset:v2:";
  const BASE_DATASET_PREFIX = "xfc:accounts:v3:";
  const PROBE_RESULTS_PREFIX = "xfc:probe-results:v1:";
  const REVIEWS_PREFIX = "xfc:reviews:v1:";
  const UNFOLLOW_HISTORY_PREFIX = "xfc:unfollow-history:v1:";
  const TASK_LEASE_PREFIX = "xfc:task-lease:v1:";
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
    BASE_DATASET_PREFIX,
    PROBE_RESULTS_PREFIX,
    REVIEWS_PREFIX,
    UNFOLLOW_HISTORY_PREFIX,
    TASK_LEASE_PREFIX,
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
  app.baseDatasetKey = (sourceUserId) => `${BASE_DATASET_PREFIX}${sourceUserId}`;
  app.probeResultsKey = (sourceUserId) => `${PROBE_RESULTS_PREFIX}${sourceUserId}`;
  app.reviewsKey = (sourceUserId) => `${REVIEWS_PREFIX}${sourceUserId}`;
  app.unfollowHistoryKey = (sourceUserId) => `${UNFOLLOW_HISTORY_PREFIX}${sourceUserId}`;
  app.taskLeaseKey = (sourceUserId, taskType) => `${TASK_LEASE_PREFIX}${sourceUserId}:${taskType}`;
  app.queueKey = (sourceUserId) => `${UNFOLLOW_QUEUE_PREFIX}${sourceUserId}`;
  app.templateKey = (sourceUserId) => `${UNFOLLOW_TEMPLATE_PREFIX}${sourceUserId}`;

  const BASE_ACCOUNT_FIELDS = [
    "account_id", "screen_name", "name", "profile_url", "is_blue_verified",
    "verified_type", "followers_count", "following_count", "protected"
  ];
  const PROBE_FIELDS = [
    "last_post_at", "inactive_days", "last_post_id", "last_post_url",
    "data_status", "fetched_at"
  ];
  const UNFOLLOW_FIELDS = [
    "unfollow_status", "unfollowed_at", "unfollow_http_status",
    "unfollow_error", "unfollow_attempt_count", "unfollow_started_at"
  ];

  function pick(value, fields) {
    const output = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(value || {}, field)) output[field] = value[field];
    }
    return output;
  }

  function validSource(sourceUserId) {
    return /^\d+$/.test(String(sourceUserId || ""));
  }

  function mapEnvelope(values = {}, extra = {}) {
    return { ...extra, updated_at: app.nowIso(), values };
  }

  function emptyEnvelope() {
    return { updated_at: "", values: {} };
  }

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
      schema_version: "x-follow-cleaner-v3",
      source_user_id: String(sourceUserId || ""),
      updated_at: app.nowIso(),
      completed_following: false,
      accounts: []
    };
  };

  async function migrateLegacyDataset(sourceUserId) {
    if (!validSource(sourceUserId)) return null;
    const existingBase = await app.gmGet(app.baseDatasetKey(sourceUserId), null);
    if (existingBase && Array.isArray(existingBase.accounts)) return existingBase;

    let legacy = await app.gmGet(app.datasetKey(sourceUserId), null);
    if (!legacy || !Array.isArray(legacy.accounts)) {
      const globalLegacy = await app.gmGet(DATASET_KEY, null);
      if (globalLegacy && Array.isArray(globalLegacy.accounts) &&
          String(globalLegacy.source_user_id || "") === sourceUserId) {
        legacy = globalLegacy;
        await app.gmSet(app.datasetKey(sourceUserId), globalLegacy);
        const legacyQueue = await app.gmGet(UNFOLLOW_QUEUE_KEY, null);
        if (Array.isArray(legacyQueue)) await app.gmSet(app.queueKey(sourceUserId), legacyQueue);
        const legacyTemplate = await app.gmGet(UNFOLLOW_TEMPLATE_KEY, null);
        if (legacyTemplate) await app.gmSet(app.templateKey(sourceUserId), legacyTemplate);
        await app.gmDelete(DATASET_KEY);
        await app.gmDelete(UNFOLLOW_QUEUE_KEY);
        await app.gmDelete(UNFOLLOW_TEMPLATE_KEY);
      }
    }
    if (!legacy || !Array.isArray(legacy.accounts)) return null;

    const probeValues = {};
    const reviewValues = {};
    const historyValues = {};
    for (const account of legacy.accounts) {
      const id = String(account.account_id || "");
      if (!validSource(id)) continue;
      const probe = pick(account, PROBE_FIELDS);
      if (Object.keys(probe).length) probeValues[id] = probe;
      if (["", "keep", "remove", "done"].includes(String(account.review_status || "")) &&
          account.review_status) reviewValues[id] = String(account.review_status);
      const history = pick(account, UNFOLLOW_FIELDS);
      if (Object.values(history).some((value) => value !== "" && value != null)) historyValues[id] = history;
    }
    const existingQueue = await app.gmGet(app.queueKey(sourceUserId), []);
    for (const item of Array.isArray(existingQueue) ? existingQueue : []) {
      const id = String(item.account_id || "");
      if (validSource(id) && historyValues[id]?.unfollow_status !== "success") reviewValues[id] = "remove";
    }
    await app.gmSet(app.probeResultsKey(sourceUserId), mapEnvelope(probeValues, {
      task: legacy.profile_probe || null
    }));
    await app.gmSet(app.reviewsKey(sourceUserId), mapEnvelope(reviewValues));
    await app.gmSet(app.unfollowHistoryKey(sourceUserId), mapEnvelope(historyValues));
    const base = {
      ...legacy,
      schema_version: "x-follow-cleaner-v3",
      accounts: legacy.accounts.map((account) => pick(account, BASE_ACCOUNT_FIELDS)),
      migrated_from: legacy.schema_version || "x-follow-cleaner-v1",
      migrated_at: app.nowIso(),
      updated_at: app.nowIso()
    };
    delete base.profile_probe;
    await app.gmSet(app.baseDatasetKey(sourceUserId), base);
    app.log("info", "Storage", "账号数据已迁移到分层存储", {
      source_user_id: sourceUserId,
      accounts: base.accounts.length
    });
    return base;
  }

  app.loadDataset = async function (sourceUserId = "") {
    let resolvedSource = String(sourceUserId || "");
    if (!resolvedSource) resolvedSource = await app.getActiveSourceId();
    if (!resolvedSource) {
      const legacy = await app.gmGet(DATASET_KEY, null);
      if (legacy?.source_user_id) {
        resolvedSource = String(legacy.source_user_id);
        await app.setActiveSourceId(resolvedSource);
      }
    }
    if (!validSource(resolvedSource)) return app.emptyDataset(resolvedSource);
    const base = await migrateLegacyDataset(resolvedSource) ||
      await app.gmGet(app.baseDatasetKey(resolvedSource), null);
    if (!base || !Array.isArray(base.accounts)) return app.emptyDataset(resolvedSource);
    const [probeStore, reviewStore, historyStore] = await Promise.all([
      app.gmGet(app.probeResultsKey(resolvedSource), emptyEnvelope()),
      app.gmGet(app.reviewsKey(resolvedSource), emptyEnvelope()),
      app.gmGet(app.unfollowHistoryKey(resolvedSource), emptyEnvelope())
    ]);
    const accounts = base.accounts.map((account) => {
      const id = String(account.account_id || "");
      const probe = probeStore.values?.[id] || {};
      const history = historyStore.values?.[id] || {};
      const processed = history.unfollow_status === "success" || Boolean(history.unfollowed_at);
      return {
        ...account,
        ...probe,
        review_status: processed ? "done" : String(reviewStore.values?.[id] || ""),
        ...history
      };
    });
    const updatedAt = [base.updated_at, probeStore.updated_at, reviewStore.updated_at, historyStore.updated_at]
      .filter(Boolean).sort().at(-1) || app.nowIso();
    return {
      ...base,
      schema_version: "x-follow-cleaner-v3",
      updated_at: updatedAt,
      profile_probe: probeStore.task || null,
      accounts
    };
  };

  app.saveBaseDataset = async function (dataset) {
    const sourceUserId = String(dataset.source_user_id || "");
    if (!validSource(sourceUserId)) throw new Error("数据集缺少有效 source_user_id，无法保存。");
    const base = {
      ...dataset,
      schema_version: "x-follow-cleaner-v3",
      updated_at: app.nowIso(),
      accounts: dataset.accounts.map((account) => pick(account, BASE_ACCOUNT_FIELDS))
    };
    delete base.profile_probe;
    await app.gmSet(app.baseDatasetKey(sourceUserId), base);
    app.emit("dataset", { source_user_id: sourceUserId, kind: "base", updated_at: base.updated_at });
    return base;
  };

  app.saveDataset = async function (dataset) {
    const sourceUserId = String(dataset.source_user_id || "");
    if (!validSource(sourceUserId)) throw new Error("数据集缺少有效 source_user_id，无法保存。");
    await app.setActiveSourceId(sourceUserId);
    await app.saveBaseDataset(dataset);
    await app.saveProbeResults(sourceUserId, dataset.accounts, dataset.profile_probe || null, { replace: true });
    await app.saveReviewChanges(sourceUserId, dataset.accounts.map((account) => ({
      account_id: account.account_id,
      review_status: account.review_status || ""
    })), { replace: true });
    await app.saveUnfollowResults(sourceUserId, dataset.accounts, { replace: true });
    return app.loadDataset(sourceUserId);
  };

  app.saveProbeResults = async function (sourceUserId, results, task, options = {}) {
    if (!validSource(sourceUserId)) throw new Error("没有活动账号，无法保存探测结果。");
    const current = options.replace
      ? mapEnvelope()
      : await app.gmGet(app.probeResultsKey(sourceUserId), emptyEnvelope());
    const values = { ...(current.values || {}) };
    for (const result of results || []) {
      const id = String(result.account_id || "");
      if (!validSource(id)) continue;
      values[id] = { ...(values[id] || {}), ...pick(result, PROBE_FIELDS) };
    }
    const next = mapEnvelope(values, { task: task === undefined ? current.task || null : task });
    await app.gmSet(app.probeResultsKey(sourceUserId), next);
    app.emit("dataset", { source_user_id: sourceUserId, kind: "probe", updated_at: next.updated_at });
    return next;
  };

  app.saveProbeTask = async function (sourceUserId, task) {
    return app.saveProbeResults(sourceUserId, [], task);
  };

  app.saveReviewChanges = async function (sourceUserId, changes, options = {}) {
    if (!validSource(sourceUserId)) throw new Error("没有活动账号，无法保存审核标记。");
    const current = options.replace
      ? mapEnvelope()
      : await app.gmGet(app.reviewsKey(sourceUserId), emptyEnvelope());
    const values = { ...(current.values || {}) };
    for (const change of changes || []) {
      const id = String(change.account_id || "");
      const status = String(change.review_status || "");
      if (!validSource(id) || !["", "keep", "remove", "done"].includes(status)) continue;
      if (status) values[id] = status;
      else delete values[id];
    }
    const next = mapEnvelope(values);
    await app.gmSet(app.reviewsKey(sourceUserId), next);
    app.emit("dataset", { source_user_id: sourceUserId, kind: "reviews", updated_at: next.updated_at });
    return next;
  };

  app.loadUnfollowHistory = async function (sourceUserId = "") {
    const resolvedSource = String(sourceUserId || await app.getActiveSourceId());
    if (!validSource(resolvedSource)) return {};
    return (await app.gmGet(app.unfollowHistoryKey(resolvedSource), emptyEnvelope())).values || {};
  };

  app.saveUnfollowResults = async function (sourceUserId, results, options = {}) {
    if (!validSource(sourceUserId)) throw new Error("没有活动账号，无法保存取消历史。");
    const current = options.replace
      ? mapEnvelope()
      : await app.gmGet(app.unfollowHistoryKey(sourceUserId), emptyEnvelope());
    const values = { ...(current.values || {}) };
    for (const result of results || []) {
      const id = String(result.account_id || "");
      if (!validSource(id)) continue;
      const patch = pick(result, UNFOLLOW_FIELDS);
      if (Object.values(patch).some((value) => value !== "" && value != null)) {
        values[id] = { ...(values[id] || {}), ...patch };
      } else if (options.replace) {
        delete values[id];
      }
    }
    const next = mapEnvelope(values);
    await app.gmSet(app.unfollowHistoryKey(sourceUserId), next);
    app.emit("dataset", { source_user_id: sourceUserId, kind: "unfollow", updated_at: next.updated_at });
    return next;
  };

  app.prepareUnfollowRetries = async function (sourceUserId, reviewChanges) {
    const retryIds = new Set((reviewChanges || [])
      .filter((change) => String(change.review_status || "") === "remove")
      .map((change) => String(change.account_id || "")));
    if (!retryIds.size) return 0;
    const history = await app.loadUnfollowHistory(sourceUserId);
    const retries = Array.from(retryIds)
      .filter((id) => history[id]?.unfollow_status === "needs_review")
      .map((id) => ({
        account_id: id,
        unfollow_status: "failed",
        unfollow_error: "用户核验后选择重新执行"
      }));
    if (retries.length) await app.saveUnfollowResults(sourceUserId, retries);
    return retries.length;
  };

  app.acquireTaskLease = async function (sourceUserId, taskType, ttlMs = 45000) {
    if (!validSource(sourceUserId)) throw new Error("没有活动账号，无法启动任务。");
    const key = app.taskLeaseKey(sourceUserId, taskType);
    const now = Date.now();
    const current = await app.gmGet(key, null);
    if (current?.owner_id && Number(current.expires_at || 0) > now) {
      const labels = { unfollow: "取消关注", "profile-probe": "最近推文检查", following: "关注列表导出" };
      throw new Error(`另一个页面正在执行${labels[taskType] || taskType}任务。`);
    }
    const ownerId = `${now}-${Math.random().toString(36).slice(2)}-${location.hostname}`;
    const lease = {
      owner_id: ownerId,
      task_type: taskType,
      source_user_id: sourceUserId,
      started_at: app.nowIso(),
      heartbeat_at: app.nowIso(),
      expires_at: now + ttlMs
    };
    await app.gmSet(key, lease);
    await app.sleep(20 + Math.random() * 30);
    const verified = await app.gmGet(key, null);
    if (verified?.owner_id !== ownerId) throw new Error("任务启动冲突，请稍后重试。");
    return { key, ownerId, ttlMs, lastHeartbeat: now };
  };

  app.heartbeatTaskLease = async function (lease) {
    if (!lease) return false;
    const current = await app.gmGet(lease.key, null);
    if (current?.owner_id !== lease.ownerId) return false;
    const now = Date.now();
    if (now - Number(lease.lastHeartbeat || 0) < Math.min(20000, lease.ttlMs / 3)) return true;
    current.heartbeat_at = app.nowIso();
    current.expires_at = now + lease.ttlMs;
    await app.gmSet(lease.key, current);
    lease.lastHeartbeat = now;
    return true;
  };

  app.releaseTaskLease = async function (lease) {
    if (!lease) return;
    const current = await app.gmGet(lease.key, null);
    if (current?.owner_id === lease.ownerId) await app.gmDelete(lease.key);
  };

  app.activeTaskLeases = async function (sourceUserId) {
    if (!validSource(sourceUserId)) return [];
    const taskTypes = ["following", "profile-probe", "unfollow"];
    const leases = await Promise.all(taskTypes.map((taskType) =>
      app.gmGet(app.taskLeaseKey(sourceUserId, taskType), null)
    ));
    return leases.filter((lease) => lease?.owner_id && Number(lease.expires_at || 0) > Date.now());
  };

  app.loadUnfollowQueue = async function (sourceUserId = "") {
    const resolvedSource = String(sourceUserId || await app.getActiveSourceId());
    if (!resolvedSource) return [];
    const storedQueue = await app.gmGet(app.queueKey(resolvedSource), []);
    const statusById = new Map((Array.isArray(storedQueue) ? storedQueue : []).map((item) => [
      String(item.account_id || ""), item
    ]));
    const dataset = await app.loadDataset(resolvedSource);
    return dataset.accounts
      .filter((account) => account.review_status === "remove" &&
        account.unfollow_status !== "success" && !account.unfollowed_at)
      .map((account) => {
        const previous = statusById.get(String(account.account_id)) || {};
        const durableStatus = ["failed", "executing", "needs_review"].includes(account.unfollow_status)
          ? account.unfollow_status
          : "";
        return {
          ...previous,
          account_id: String(account.account_id),
          screen_name: account.screen_name,
          status: durableStatus || (["failed", "executing", "needs_review"].includes(previous.status)
            ? previous.status
            : "pending")
        };
      });
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
    await app.gmDelete(app.baseDatasetKey(sourceUserId));
    await app.gmDelete(app.probeResultsKey(sourceUserId));
    await app.gmDelete(app.reviewsKey(sourceUserId));
    await app.gmDelete(app.unfollowHistoryKey(sourceUserId));
    await app.gmDelete(app.taskLeaseKey(sourceUserId, "profile-probe"));
    await app.gmDelete(app.taskLeaseKey(sourceUserId, "unfollow"));
    await app.gmDelete(app.taskLeaseKey(sourceUserId, "following"));
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

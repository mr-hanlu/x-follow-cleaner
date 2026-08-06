// ==UserScript==
// @name         X/推特取关助手
// @name:zh-CN   X/推特取关助手｜最近推文筛选与安全批量取关
// @name:en      X Following Cleaner – Latest Post Review & Safe Batch Unfollow
// @namespace    https://github.com/mr-hanlu/x-follow-cleaner
// @version      0.8.2
// @description  本地导出并筛选 X/推特关注列表，检查最近可见推文时间，再将确认过的账号安全分批取关。
// @description:zh-CN X/推特批量取关工具：本地筛选关注列表，匿名检查最近可见推文时间，按确认队列安全取消关注。
// @description:en Export and review your X/Twitter following list locally, check the latest publicly visible post time, and unfollow confirmed accounts in controlled batches.
// @author       hanlu
// @license      MIT
// @match        https://x.com/*
// @match        https://x-follow-cleaner.mrhanlu224.workers.dev/*
// @icon         https://x-follow-cleaner.mrhanlu224.workers.dev/favicon.svg
// @homepageURL  https://x-follow-cleaner.mrhanlu224.workers.dev/
// @contributionURL https://x-follow-cleaner.mrhanlu224.workers.dev/sponsor/
// @contributionAmount 5 USD
// @updateURL    https://x-follow-cleaner.mrhanlu224.workers.dev/download/x-follow-cleaner.user.js
// @downloadURL  https://x-follow-cleaner.mrhanlu224.workers.dev/download/x-follow-cleaner.user.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      x.com
// @noframes
// ==/UserScript==


(function () {
"use strict";
window.XFollowCleaner = window.XFollowCleaner || {};
window.XFollowCleaner.dashboardUrl = "https://x-follow-cleaner.mrhanlu224.workers.dev/";
window.XFollowCleaner.sponsorUrl = "https://x-follow-cleaner.mrhanlu224.workers.dev/sponsor/";

/* ---- core.js ---- */
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

      await app.setActiveSourceId(sourceUserId);
      let dataset = await app.loadDataset(sourceUserId);
      dataset.source_user_id = sourceUserId;
      let cursor = dataset.following_cursor || "";
      let page = Number(dataset.following_page || 0);
      const lease = await app.acquireTaskLease(sourceUserId, "following", 90000);
      this.running = true;
      this.stopRequested = false;
      onProgress({
        phase: "start",
        message: `正在准备关注列表导出；已有 ${dataset.accounts.length} 人，第 ${page + 1} 页即将请求`,
        current: dataset.accounts.length,
        page
      });
      app.log("info", "Following", "任务开始", {
        existing_accounts: dataset.accounts.length,
        next_page: page + 1
      });

      try {
        while (!this.stopRequested && !dataset.completed_following) {
          if (!await app.heartbeatTaskLease(lease)) {
            throw new Error("关注列表导出任务租约已失效，任务停止。");
          }
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
          onProgress({
            phase: "request",
            message: `正在请求关注列表第 ${page + 1} 页…`,
            current: dataset.accounts.length,
            page
          });
          app.log("info", "Following", `请求第 ${page + 1} 页`, {
            saved_accounts: dataset.accounts.length,
            has_cursor: Boolean(cursor)
          });
          const response = await fetch(url, { method: "GET", credentials: "include", headers });
          app.log(
            response.ok ? "info" : "warn",
            "Following",
            `第 ${page + 1} 页返回 HTTP ${response.status}`
          );
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
          dataset = await app.saveBaseDataset(dataset);
          await app.heartbeatTaskLease(lease);
          onProgress({
            phase: dataset.completed_following ? "complete" : "progress",
            message: `关注列表第 ${page} 页：本页 ${incoming.length} 人，累计 ${dataset.accounts.length} 人`,
            current: dataset.accounts.length,
            page
          });
          app.log("info", "Following", `第 ${page} 页保存完成`, {
            page_accounts: incoming.length,
            total_accounts: dataset.accounts.length,
            completed: dataset.completed_following
          });
          if (!dataset.completed_following) await app.sleep(900 + Math.random() * 600);
        }
        if (this.stopRequested) {
          onProgress({
            phase: "stopped",
            message: `已安全停止；当前保存 ${dataset.accounts.length} 人，可稍后继续`,
            current: dataset.accounts.length,
            page
          });
          app.log("warn", "Following", "用户请求停止", {
            saved_accounts: dataset.accounts.length,
            page
          });
        }
        return dataset;
      } catch (error) {
        app.log("error", "Following", error.message || String(error));
        throw error;
      } finally {
        await app.releaseTaskLease(lease);
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
      if (this.running) throw new Error("最近推文检查已经在运行。");
      let dataset = await app.loadDataset();
      if (!dataset.accounts.length) throw new Error("请先导出关注列表。");
      const sourceUserId = String(dataset.source_user_id || "");
      const lease = await app.acquireTaskLease(sourceUserId, "profile-probe", 90000);
      const intervalMs = Math.max(500, Number(options.intervalMs || 3000));
      const limit = Math.max(0, Number(options.limit || 0));
      const concurrency = Math.min(8, Math.max(1, Number(options.concurrency || 1)));
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
      const overallTotal = dataset.accounts.length;
      const overallCompleted = () =>
        dataset.accounts.filter((account) => Boolean(account.fetched_at)).length;
      this.running = true;
      this.stopRequested = false;
      let completed = 0;
      let nextTargetIndex = 0;
      let fatalError = null;
      let saveChain = Promise.resolve();
      let pendingResults = [];
      let flushTimer = null;
      dataset.profile_probe = {
        status: targets.length ? "running" : "complete",
        completed: overallCompleted(),
        total: overallTotal,
        batch_completed: 0,
        batch_total: targets.length,
        concurrency,
        interval_ms: intervalMs,
        started_at: app.nowIso(),
        updated_at: app.nowIso()
      };
      try {
        await app.saveProbeTask(sourceUserId, dataset.profile_probe);
      } catch (error) {
        this.running = false;
        await app.releaseTaskLease(lease);
        throw error;
      }
      onProgress({
        phase: targets.length ? "start" : "complete",
        message: targets.length
          ? `整体已检查 ${overallCompleted()}/${overallTotal} · 本轮 ${targets.length} · 并发 ${concurrency}`
          : `已检查 ${overallCompleted()}/${overallTotal}，没有待处理账号`,
        current: overallCompleted(),
        total: overallTotal,
        batch_current: 0,
        batch_total: targets.length
      });
      app.log("info", "ProfileProbe", "任务开始", {
        targets: targets.length,
        interval_ms: intervalMs,
        concurrency,
        retry_failed: retryFailed
      });

      const flushPending = (force = false) => {
        if (!pendingResults.length) return saveChain;
        if (!force && pendingResults.length < 5) return saveChain;
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        const batch = pendingResults;
        pendingResults = [];
        const taskSnapshot = { ...dataset.profile_probe, updated_at: app.nowIso() };
        saveChain = saveChain.then(async () => {
          await app.saveProbeResults(sourceUserId, batch, taskSnapshot);
          if (!await app.heartbeatTaskLease(lease)) throw new Error("推文检查任务租约已失效，任务停止。");
        });
        return saveChain;
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushPending(true).catch((error) => {
            fatalError ||= error;
          });
        }, 2000);
      };

      const flushForLifecycle = (event) => {
        if (event?.type === "visibilitychange" && document.visibilityState !== "hidden") return;
        flushPending(true).catch((error) => app.log(
          "error", "ProfileProbe", `后台切换时保存失败：${error.message || error}`
        ));
      };
      if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("visibilitychange", flushForLifecycle);
        document.addEventListener("freeze", flushForLifecycle);
        window.addEventListener("pagehide", flushForLifecycle);
      }

      const commitResult = async (target, result) => {
        const account = dataset.accounts.find((item) => String(item.account_id) === String(target.account_id));
        if (account) {
          Object.assign(account, {
            last_post_at: result.last_post_at,
            inactive_days: result.inactive_days,
            last_post_id: result.last_post_id,
            last_post_url: result.last_post_url,
            data_status: result.data_status,
            fetched_at: result.fetched_at
          });
        }
        completed += 1;
        const currentOverall = overallCompleted();
        dataset.profile_probe = {
          ...dataset.profile_probe,
          status: "running",
          completed: currentOverall,
          total: overallTotal,
          batch_completed: completed,
          current_screen_name: target.screen_name,
          updated_at: app.nowIso()
        };
        pendingResults.push(result);
        scheduleFlush();
        if (pendingResults.length >= 5) await flushPending(true);
        else if (!await app.heartbeatTaskLease(lease)) throw new Error("推文检查任务租约已失效，任务停止。");
        onProgress({
          phase: "progress",
          message: `已检查 ${currentOverall}/${overallTotal} · 本轮 ${completed}/${targets.length}：@${target.screen_name} ${result.data_status}`,
          current: currentOverall,
          total: overallTotal,
          batch_current: completed,
          batch_total: targets.length
        });
        app.log(
          result.data_status === "ok" ? "info" : "warn",
          "ProfileProbe",
          `@${target.screen_name} ${result.data_status}`,
          { current: completed, total: targets.length, concurrency }
        );
      };

      const worker = async (workerIndex) => {
        if (workerIndex > 0) {
          await app.sleep(
            workerIndex * Math.min(250, Math.max(60, intervalMs / concurrency))
          );
        }
        while (!this.stopRequested && !fatalError) {
          if (!await app.heartbeatTaskLease(lease)) {
            fatalError = new Error("推文检查任务租约已失效，任务停止。");
            return;
          }
          const targetIndex = nextTargetIndex;
          nextTargetIndex += 1;
          if (targetIndex >= targets.length) return;
          const target = targets[targetIndex];
          let result;
          onProgress({
            phase: "request",
            message: `已检查 ${overallCompleted()}/${overallTotal} · 正在请求本轮 ${targetIndex + 1}/${targets.length}：@${target.screen_name}`,
            current: overallCompleted(),
            total: overallTotal,
            batch_current: completed,
            batch_total: targets.length,
            active: Math.min(concurrency, targets.length - completed)
          });
          app.log("info", "ProfileProbe", `工作槽 ${workerIndex + 1} 请求 @${target.screen_name}`, {
            scheduled: targetIndex + 1,
            completed,
            total: targets.length,
            concurrency,
            anonymous: true
          });
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
              await commitResult(target, result);
              fatalError = new Error("匿名主页请求遇到 429，已保存进度并停止。");
              return;
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
          await commitResult(target, result);
          if (
            !this.stopRequested &&
            !fatalError &&
            nextTargetIndex < targets.length
          ) {
            await app.sleep(intervalMs + Math.random() * Math.min(intervalMs * 0.35, 1500));
          }
        }
      };

      try {
        const workerCount = Math.min(concurrency, Math.max(1, targets.length));
        await Promise.all(
          Array.from({ length: workerCount }, (_, index) => worker(index))
        );
        await flushPending(true);
        await saveChain;
        if (fatalError) throw fatalError;
        if (this.stopRequested) {
          dataset.profile_probe = {
            ...dataset.profile_probe,
            status: "paused",
            completed: overallCompleted(),
            batch_completed: completed,
            updated_at: app.nowIso()
          };
          await app.saveProbeTask(sourceUserId, dataset.profile_probe);
          onProgress({
            phase: "stopped",
            message: `已暂停 · 整体已检查 ${overallCompleted()}/${overallTotal} · 本轮完成 ${completed}/${targets.length}`,
            current: overallCompleted(),
            total: overallTotal,
            batch_current: completed,
            batch_total: targets.length
          });
          app.log("warn", "ProfileProbe", "用户请求停止", {
            completed,
            total: targets.length
          });
        } else {
          const currentOverall = overallCompleted();
          const allAttempted = currentOverall >= overallTotal;
          dataset.profile_probe = {
            ...dataset.profile_probe,
            status: allAttempted ? "complete" : "paused",
            completed: currentOverall,
            batch_completed: completed,
            updated_at: app.nowIso()
          };
          await app.saveProbeTask(sourceUserId, dataset.profile_probe);
          onProgress({
            phase: allAttempted ? "complete" : "stopped",
            message: allAttempted
              ? `检查完成 · 已检查 ${currentOverall}/${overallTotal}`
              : `本轮结束 · 整体已检查 ${currentOverall}/${overallTotal} · 本轮 ${completed}/${targets.length}`,
            current: currentOverall,
            total: overallTotal,
            batch_current: completed,
            batch_total: targets.length
          });
        }
        return dataset;
      } catch (error) {
        await flushPending(true);
        await saveChain;
        dataset.profile_probe = {
          ...dataset.profile_probe,
          status: "error",
          completed: overallCompleted(),
          batch_completed: completed,
          error: error.message || String(error),
          updated_at: app.nowIso()
        };
        await app.saveProbeTask(sourceUserId, dataset.profile_probe);
        app.log("error", "ProfileProbe", error.message || String(error), {
          completed,
          total: targets.length
        });
        throw error;
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        if (typeof document !== "undefined" && document.removeEventListener) {
          document.removeEventListener("visibilitychange", flushForLifecycle);
          document.removeEventListener("freeze", flushForLifecycle);
          window.removeEventListener("pagehide", flushForLifecycle);
        }
        await app.releaseTaskLease(lease);
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
  const WEB_BEARER_TOKEN =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const DEFAULT_PARAMS = {
    include_profile_interstitial_type: "1",
    include_blocking: "1",
    include_blocked_by: "1",
    include_followed_by: "1",
    include_want_retweets: "1",
    include_mute_edge: "1",
    include_can_dm: "1",
    include_can_media_tag: "1",
    include_ext_is_blue_verified: "1",
    include_ext_verified_type: "1",
    include_ext_profile_image_shape: "1",
    skip_status: "1"
  };

  function automaticTemplate() {
    return {
      url: "https://x.com/i/api/1.1/friendships/destroy.json",
      headers: {
        accept: "*/*",
        authorization: `Bearer ${WEB_BEARER_TOKEN}`,
        "content-type": "application/x-www-form-urlencoded",
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": document.documentElement.lang || "zh-cn"
      },
      params: { ...DEFAULT_PARAMS },
      source: "automatic",
      saved_at: app.nowIso()
    };
  }

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
      await app.saveUnfollowTemplate(template);
      return template;
    },

    createAutomaticTemplate() {
      return automaticTemplate();
    },

    async saveAutomaticTemplate() {
      const template = automaticTemplate();
      await app.saveUnfollowTemplate(template);
      return template;
    },

    async queueAccounts(accounts = null) {
      const dataset = await app.loadDataset();
      const sourceUserId = String(dataset.source_user_id || "");
      if (!sourceUserId) throw new Error("没有活动账号，无法建立取消队列。");
      const known = new Map(dataset.accounts.map((account) => [String(account.account_id), account]));
      const previousQueue = await app.loadUnfollowQueue(sourceUserId);
      const previous = new Map(previousQueue.map((item) => [String(item.account_id), item]));
      const queue = [];
      let ignoredProcessed = 0;
      let ignoredUnknown = 0;
      const selected = Array.isArray(accounts)
        ? accounts
        : dataset.accounts.filter((account) => account.review_status === "remove");
      for (const value of selected) {
        const id = String(value.account_id || value || "");
        if (!/^\d+$/.test(id) || !known.has(id)) {
          ignoredUnknown += 1;
          continue;
        }
        const account = known.get(id);
        const processed =
          account.unfollow_status === "success" ||
          Boolean(account.unfollowed_at);
        if (processed) {
          ignoredProcessed += 1;
          continue;
        }
        const previousStatus = previous.get(id)?.status;
        queue.push({
          account_id: id,
          screen_name: account.screen_name,
          status: ["failed", "executing", "needs_review"].includes(previousStatus)
            ? previousStatus
            : "pending"
        });
      }
      await app.saveUnfollowQueue(queue, sourceUserId);
      return {
        queue,
        stats: {
          selected: selected.length,
          queued: queue.length,
          failed: queue.filter((item) => item.status === "failed").length,
          ignored_processed: ignoredProcessed,
          ignored_unknown: ignoredUnknown,
          removed_from_previous: previousQueue.filter((item) =>
            !queue.some((queued) => queued.account_id === item.account_id)
          ).length
        }
      };
    },

    async start(options = {}, onProgress = () => {}) {
      if (this.running) throw new Error("取消关注任务已经在运行。");
      if (location.hostname !== "x.com") throw new Error("请在 x.com 页面执行取消关注。");
      const csrf = app.getCookie("ct0");
      if (!csrf) throw new Error("没有读取到 ct0，请确认已登录 X。");
      const dataset = await app.loadDataset();
      const sourceUserId = String(dataset.source_user_id || "");
      if (!sourceUserId) throw new Error("没有活动账号，请先导出当前账号的关注列表。");
      let template = await app.loadUnfollowTemplate(sourceUserId);
      if (!template) {
        template = automaticTemplate();
        await app.saveUnfollowTemplate(template, sourceUserId);
        app.log("info", "Unfollow", "已自动生成 destroy.json 请求模板。", {
          source_user_id: sourceUserId
        });
      }
      const loggedAccountId = app.getLoggedAccountId();
      if (loggedAccountId && loggedAccountId !== sourceUserId) {
        throw new Error(
          `账号不匹配：当前登录账号是 ${loggedAccountId}，取消队列属于 ${sourceUserId}。`
        );
      }
      if (!loggedAccountId) {
        app.log("warn", "Unfollow", "无法从 twid 读取当前登录账号 ID，请确认队列属于当前账号。", {
          source_user_id: sourceUserId
        });
      }
      const lease = await app.acquireTaskLease(sourceUserId, "unfollow", 90000);
      const batchSize = Math.min(50, Math.max(1, Number(options.batchSize || 10)));
      const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
      let queue;
      let targets;
      try {
        queue = await app.loadUnfollowQueue(sourceUserId);
        const interrupted = queue.filter((item) => item.status === "executing");
        if (interrupted.length) {
          await app.saveUnfollowResults(sourceUserId, interrupted.map((item) => ({
            account_id: item.account_id,
            unfollow_status: "needs_review",
            unfollow_error: "上次任务在请求完成前中断，请核验当前关注状态。"
          })));
          queue = await app.loadUnfollowQueue(sourceUserId);
          await app.saveUnfollowQueue(queue, sourceUserId);
        }
        targets = queue.filter((item) =>
          !["success", "executing", "needs_review"].includes(item.status)
        ).slice(0, batchSize);
        if (!targets.length) {
          const needsReview = queue.filter((item) => item.status === "needs_review").length;
          throw new Error(needsReview
            ? `有 ${needsReview} 个账号的上次执行结果待人工核验。确认仍在关注后，请在筛选页重新标记“待取消”再发送。`
            : "没有待取消账号。");
        }
      } catch (error) {
        await app.releaseTaskLease(lease);
        throw error;
      }
      this.running = true;
      this.stopRequested = false;
      let batchSucceeded = 0;
      try {
        onProgress({
          phase: "start",
          message: `取消关注任务准备完成，本批 ${targets.length} 人`,
          current: 0,
          total: targets.length
        });
        app.log("info", "Unfollow", "任务开始", {
          batch_size: targets.length,
          interval_ms: intervalMs
        });
        for (let index = 0; index < targets.length; index += 1) {
          if (this.stopRequested) break;
          if (!await app.heartbeatTaskLease(lease)) {
            throw new Error("取消关注任务租约已失效，任务停止。");
          }
          const target = targets[index];
          const latestDataset = await app.loadDataset(sourceUserId);
          const latestAccount = latestDataset.accounts.find((account) =>
            String(account.account_id) === String(target.account_id)
          );
          if (!latestAccount || latestAccount.review_status !== "remove" ||
              latestAccount.unfollow_status === "success" || latestAccount.unfollowed_at) {
            queue = await app.loadUnfollowQueue(sourceUserId);
            await app.saveUnfollowQueue(queue, sourceUserId);
            continue;
          }
          const previousHistory = (await app.loadUnfollowHistory(sourceUserId))[target.account_id] || {};
          const attemptCount = Number(previousHistory.unfollow_attempt_count || 0) + 1;
          const startedAt = app.nowIso();
          await app.saveUnfollowResults(sourceUserId, [{
            account_id: target.account_id,
            unfollow_status: "executing",
            unfollow_started_at: startedAt,
            unfollow_attempt_count: attemptCount,
            unfollow_error: ""
          }]);
          queue = (await app.loadUnfollowQueue(sourceUserId)).map((item) =>
            item.account_id === target.account_id ? { ...item, status: "executing" } : item
          );
          await app.saveUnfollowQueue(queue, sourceUserId);
          onProgress({
            phase: "request",
            message: `正在处理 ${index + 1}/${targets.length}：@${target.screen_name || target.account_id}`,
            current: index,
            total: targets.length
          });
          app.log("info", "Unfollow", `请求 @${target.screen_name || target.account_id}`, {
            current: index + 1,
            total: targets.length
          });
          const headers = {
            ...template.headers,
            "content-type": "application/x-www-form-urlencoded",
            "x-csrf-token": app.getCookie("ct0")
          };
          const body = new URLSearchParams({ ...template.params, user_id: target.account_id });
          let status = "failed";
          let httpStatus = 0;
          let requestError = "";
          try {
            const response = await fetch(template.url, {
              method: "POST",
              credentials: "include",
              headers,
              body
            });
            httpStatus = response.status;
            if (response.status === 429) {
              status = "failed";
              requestError = "HTTP 429";
            } else {
              status = response.ok ? "success" : "failed";
              if (!response.ok) requestError = `HTTP ${response.status}`;
            }
          } catch (error) {
            status = "needs_review";
            requestError = error.message || String(error);
          }
          await app.saveUnfollowResults(sourceUserId, [{
            account_id: target.account_id,
            unfollow_status: status,
            unfollow_http_status: httpStatus || "",
            unfollowed_at: status === "success" ? app.nowIso() : "",
            unfollow_error: requestError,
            unfollow_started_at: startedAt,
            unfollow_attempt_count: attemptCount
          }]);
          const latestQueue = await app.loadUnfollowQueue(sourceUserId);
          if (status === "success") {
            queue = latestQueue.filter((item) => item.account_id !== target.account_id);
          } else {
            queue = latestQueue;
            const queueItem = queue.find((item) => item.account_id === target.account_id);
            if (queueItem) {
              queueItem.status = status;
              queueItem.last_error = requestError;
            }
          }
          if (status === "success") batchSucceeded += 1;
          await app.saveUnfollowQueue(queue, sourceUserId);
          if (!await app.heartbeatTaskLease(lease)) {
            throw new Error("取消关注任务租约已失效，任务停止。");
          }
          onProgress({
            phase: index + 1 === targets.length ? "complete" : "progress",
            message: `取消关注 ${index + 1}/${targets.length}：@${target.screen_name || target.account_id} ${status}`,
            current: index + 1,
            total: targets.length
          });
          app.log(status === "success" ? "info" : "warn", "Unfollow", `@${target.screen_name || target.account_id} ${status}`, {
            http_status: httpStatus,
            current: index + 1,
            total: targets.length
          });
          if (httpStatus === 429) {
            throw new Error("取消关注遇到 429，已保存进度并停止。");
          }
          if (index + 1 < targets.length) await app.sleep(intervalMs);
        }
        if (this.stopRequested) {
          onProgress({
            phase: "stopped",
            message: `已安全停止；本批成功 ${batchSucceeded}/${targets.length}`,
            current: batchSucceeded,
            total: targets.length
          });
          app.log("warn", "Unfollow", "用户请求停止", {
            completed: batchSucceeded,
            total: targets.length
          });
        }
        return queue;
      } catch (error) {
        app.log("error", "Unfollow", error.message || String(error));
        throw error;
      } finally {
        await app.releaseTaskLease(lease);
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
      const watchedKeys = new Set();
      let changeTimer = null;
      const scheduleDataset = () => {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => sendDataset().catch((error) => {
          app.log("error", "Bridge", `实时同步失败：${error.message || error}`);
        }), 350);
      };

      const watchSource = (sourceUserId) => {
        if (!sourceUserId || typeof GM_addValueChangeListener !== "function") return;
        for (const key of [
          app.baseDatasetKey(sourceUserId),
          app.probeResultsKey(sourceUserId),
          app.reviewsKey(sourceUserId),
          app.unfollowHistoryKey(sourceUserId),
          app.queueKey(sourceUserId)
        ]) {
          if (watchedKeys.has(key)) continue;
          watchedKeys.add(key);
          GM_addValueChangeListener(key, scheduleDataset);
        }
      };

      const sendDataset = async () => {
        const dataset = await app.loadDataset();
        const queue = await app.loadUnfollowQueue(dataset.source_user_id);
        watchSource(dataset.source_user_id);
        app.log("info", "Bridge", "向筛选页面发送数据集", {
          accounts: dataset.accounts.length,
          updated_at: dataset.updated_at,
          queued: queue.length
        });
        window.dispatchEvent(
          new CustomEvent("xfc:dataset", {
            detail: {
              schema_version: dataset.schema_version,
              source_user_id: dataset.source_user_id,
              updated_at: dataset.updated_at,
              profile_probe: dataset.profile_probe || null,
              accounts: dataset.accounts,
              queue
            }
          })
        );
      };

      window.addEventListener("xfc:request-dataset", sendDataset);
      if (typeof GM_addValueChangeListener === "function") {
        GM_addValueChangeListener(app.constants.ACTIVE_SOURCE_KEY, scheduleDataset);
      }

      window.addEventListener("xfc:save-reviews", async (event) => {
        const requestedReviews = Array.isArray(event.detail?.reviews) ? event.detail.reviews : [];
        const dataset = await app.loadDataset();
        const requestedSource = String(event.detail?.source_user_id || "");
        if (
          requestedSource &&
          requestedSource !== String(dataset.source_user_id || "")
        ) {
          app.log("error", "Bridge", "拒绝写入其他账号的审核标记", {
            requested_source: requestedSource,
            active_source: dataset.source_user_id
          });
          window.dispatchEvent(
            new CustomEvent("xfc:reviews-error", {
              detail: { message: "账号已切换，请重新从油猴同步后再发送队列。" }
            })
          );
          return;
        }
        const knownIds = new Set(dataset.accounts.map((account) => String(account.account_id)));
        const reviews = requestedReviews.filter((review) => knownIds.has(String(review.account_id || "")));
        try {
          await app.saveReviewChanges(dataset.source_user_id, reviews);
          await app.prepareUnfollowRetries(dataset.source_user_id, reviews);
          const result = await app.unfollow.queueAccounts();
          app.log("info", "Bridge", "审核标记已写回", {
            reviews: reviews.length,
            ...result.stats
          });
          await sendDataset();
          window.dispatchEvent(
            new CustomEvent("xfc:reviews-saved", {
              detail: { saved: reviews.length, ...result.stats }
            })
          );
        } catch (error) {
          const message = error.message || String(error);
          app.log("error", "Bridge", message);
          window.dispatchEvent(new CustomEvent("xfc:reviews-error", { detail: { message } }));
        }
      });

      window.dispatchEvent(new CustomEvent("xfc:bridge-ready"));
      app.log("info", "Bridge", "筛选页面数据桥已就绪", {
        origin: location.origin
      });
    }
  };
})(window.XFollowCleaner);


/* ---- panel.js ---- */
(function (app) {
  const SUPPORT_PROMPT_KEY = "xfc:support-prompt:v1";
  const SUPPORT_COOLDOWN_MS = 45 * 24 * 60 * 60 * 1000;
  const styles = `
    #xfc-launch{position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:11px 16px;background:#0f1419;color:#fff;font:700 13px system-ui;box-shadow:0 10px 35px #0004;cursor:pointer}
    #xfc-panel{position:fixed;right:18px;bottom:70px;z-index:2147483647;width:min(430px,calc(100vw - 28px));max-height:78vh;overflow:auto;overscroll-behavior:contain;border:1px solid #cfd9de;border-radius:18px;background:#fff;color:#0f1419;box-shadow:0 24px 80px #0005;font:13px/1.45 system-ui}
    #xfc-panel[hidden]{display:none}#xfc-panel header{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:15px 17px;background:#fff;border-bottom:1px solid #eff3f4}
    #xfc-panel .xfc-header-actions{display:flex;align-items:center;gap:7px}#xfc-panel .xfc-header-support{display:inline-flex;align-items:center;gap:5px;border:1px solid #f0bdca;border-radius:999px;padding:6px 10px;background:#fff;color:#0f1419;text-decoration:none;font:700 12px system-ui;white-space:nowrap}#xfc-panel .xfc-header-support span{color:#e0245e;font-size:14px;line-height:1}#xfc-panel .xfc-header-support:hover{background:#fff1f4}
    #xfc-panel h2,#xfc-panel p{margin:0}#xfc-panel h2{font-size:17px}#xfc-panel main{padding:14px 17px 18px}#xfc-panel section{padding:13px 0;border-bottom:1px solid #eff3f4}
    #xfc-panel section:last-child{border:0}#xfc-panel h3{margin:0 0 9px;font-size:13px}#xfc-panel textarea{width:100%;height:90px;box-sizing:border-box;padding:9px;border:1px solid #cfd9de;border-radius:9px;font:11px/1.4 ui-monospace,monospace;resize:vertical}
    #xfc-panel .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}#xfc-panel button,#xfc-panel a.xfc-btn{border:1px solid #cfd9de;border-radius:999px;padding:7px 11px;background:#fff;color:#0f1419;text-decoration:none;font:700 12px system-ui;cursor:pointer}
    #xfc-panel button.primary{background:#0f1419;color:#fff;border-color:#0f1419}#xfc-panel button.danger{background:#b42318;color:#fff;border-color:#b42318}
    #xfc-panel button.xfc-clear-danger{background:#fff0ee;color:#b42318;border-color:#f2a49d}
    #xfc-panel button.xfc-help-button{height:31px;padding:0 10px;font-size:12px}
    #xfc-panel button:disabled{cursor:wait;opacity:.55}
    #xfc-panel label{display:flex;flex-direction:column;gap:4px;color:#536471;font-size:11px}#xfc-panel input{width:92px;padding:6px 8px;border:1px solid #cfd9de;border-radius:8px}#xfc-panel input[type=checkbox]{width:auto;padding:0}#xfc-panel input:disabled{cursor:not-allowed;background:#eff3f4;color:#8b98a1;opacity:.72}
    #xfc-account-summary{margin-bottom:5px;padding:9px;border-radius:9px;background:#fff8dc;color:#655016;font-size:10px}
    #xfc-help{margin:12px 17px 0;padding:12px;border:1px solid #b9d8ee;border-radius:11px;background:#f1f8fd;color:#334b5b;font-size:11px}#xfc-help strong{display:block;margin-bottom:6px;color:#0f1419}#xfc-help ol{margin:0;padding-left:19px}#xfc-help li+li{margin-top:5px}#xfc-help p{margin-top:8px!important;color:#536471}
    .xfc-progress{margin-top:9px}.xfc-progress-track{height:7px;overflow:hidden;border-radius:999px;background:#eff3f4}.xfc-progress-bar{display:block;width:0;height:100%;border-radius:inherit;background:#1d9bf0;transition:width .2s ease}.xfc-progress.active.indeterminate .xfc-progress-bar{width:36%;animation:xfc-slide 1.15s ease-in-out infinite}.xfc-progress.complete .xfc-progress-bar{width:100%;background:#2e7d53}.xfc-progress.error .xfc-progress-bar{width:100%;background:#b42318}.xfc-progress.stopped .xfc-progress-bar{background:#b7791f}.xfc-progress small{display:block;margin-top:5px;color:#536471;font-size:10px}
    @keyframes xfc-slide{from{transform:translateX(-110%)}to{transform:translateX(300%)}}
    .xfc-queue-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:9px 0 6px}.xfc-queue-head strong{font-size:11px}.xfc-queue-list{height:118px!important;background:#f7f9f9!important;color:#536471!important}.xfc-queue-list[hidden]{display:none}
    #xfc-panel details{margin-top:10px;padding:9px;border:1px solid #eff3f4;border-radius:10px;background:#f7f9f9}#xfc-panel summary{cursor:pointer;color:#536471;font-size:11px;font-weight:700}#xfc-panel details ol{margin:8px 0 0;padding-left:19px;color:#536471;font-size:11px}#xfc-panel details li+li{margin-top:4px}#xfc-panel .xfc-help-note{margin-top:8px!important;color:#2e7352;font-size:10px}#xfc-panel .xfc-template-note{margin-top:8px;color:#2e7d53;font-size:11px}
    #xfc-log{max-height:150px;min-height:50px;overflow:auto;margin-top:10px;padding:9px;border-radius:9px;background:#f7f9f9;color:#536471;font:10px/1.55 ui-monospace,monospace;white-space:pre-wrap}
    #xfc-support-prompt{margin:0 0 12px;padding:11px 12px;border:1px solid #eadca9;border-radius:11px;background:#fff8dc;color:#655016}#xfc-support-prompt[hidden]{display:none}#xfc-support-prompt strong{display:block;color:#0f1419;font-size:12px}#xfc-support-prompt p{margin-top:4px!important;font-size:10px;line-height:1.55}#xfc-support-prompt .row{margin-top:9px}
    #xfc-panel .xfc-support-heart{color:#e0245e}#xfc-panel details.xfc-data-management{margin-top:12px;background:#fff}#xfc-panel details.xfc-data-management p{margin:8px 0!important;color:#536471;font-size:10px}#xfc-panel details.xfc-data-management button{border-color:#f2a49d;color:#b42318}
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
        <button id="xfc-launch" type="button">X/推特取关助手</button>
        <aside id="xfc-panel" hidden>
          <header>
            <h2>X/推特取关助手</h2>
            <div class="xfc-header-actions">
              <a class="xfc-header-support" id="xfc-support" target="_blank" rel="noreferrer"><span aria-hidden="true">♥</span>赞助开发者</a>
              <button class="xfc-help-button" id="xfc-help-toggle" title="使用帮助" aria-label="使用帮助" aria-expanded="false">❓ 帮助</button>
              <button id="xfc-close">关闭</button>
            </div>
          </header>
          <div id="xfc-help" hidden>
            <strong>使用流程</strong>
            <ol>
              <li><b>导出关注列表：</b>从 X 读取当前账号的完整关注列表。</li>
              <li><b>检查最近推文：</b>不携带 X 登录 Cookie 请求公开主页，获取最近可见推文时间。</li>
              <li><b>筛选与标记：</b>按距最近可见推文天数等条件，标记保留或待取消账号。</li>
              <li><b>发送队列：</b>把当前选择同步回油猴，已处理账号会自动排除。</li>
              <li><b>分批取消：</b>返回 X，设置数量和间隔，确认后执行。</li>
            </ol>
            <p>数据默认保存在当前浏览器，建议定期导出 CSV。遇到 429 时请稍后继续。</p>
          </div>
          <main>
            <div id="xfc-account-summary">正在读取本地进度…</div>
            <div id="xfc-support-prompt" hidden>
              <strong><span class="xfc-support-heart" aria-hidden="true">♥</span> 这个工具帮你节省了时间吗？</strong>
              <p>可以自愿支持后续维护。赞助不会解锁额外功能，也不会影响正常使用。</p>
              <div class="row"><a class="xfc-btn" id="xfc-support-prompt-link" target="_blank" rel="noreferrer">赞助开发者</a><button id="xfc-support-later">稍后再说</button><button id="xfc-support-never">不再提示</button></div>
            </div>
            <section>
              <h3>1. 导出关注列表（登录态）</h3>
              <details>
                <summary>怎么复制 Following cURL？</summary>
                <ol>
                  <li>打开自己的“正在关注”页面。</li>
                  <li>按 <b>F12</b> 打开开发者工具，选择 <b>Network / 网络</b> 和 <b>Fetch/XHR</b>。</li>
                  <li>搜索 <b>Following</b>，必要时向下滚动一次关注列表。</li>
                  <li>右键 Following 请求，选择 <b>Copy → Copy as cURL (bash)</b>。</li>
                  <li>把完整内容粘贴到下方。</li>
                </ol>
                <p class="xfc-help-note">只保存请求结构和分页参数，不保存原始 cURL、Cookie 或 ct0。</p>
              </details>
              <textarea id="xfc-following-curl" placeholder="在这里粘贴完整的 Following cURL"></textarea>
              <div class="row"><button class="primary" id="xfc-following-start">开始 / 继续导出</button><button id="xfc-following-stop">停止导出</button></div>
              <div class="xfc-progress" id="xfc-following-progress" hidden><div class="xfc-progress-track"><span class="xfc-progress-bar"></span></div><small>等待开始</small></div>
            </section>
            <section>
              <h3>2. 检查最近可见推文时间</h3>
              <div class="row">
                <label>本次最多<input id="xfc-probe-limit" type="number" min="0" value="50"></label>
                <label>间隔（秒）<input id="xfc-probe-delay" type="number" min="1" value="3"></label>
                <label>并发数<input id="xfc-probe-concurrency" type="number" min="1" max="8" value="2"></label>
                <label><span>数量</span><span><input id="xfc-probe-all" type="checkbox">处理全部剩余</span></label>
                <label><span>范围</span><span><input id="xfc-retry-failed" type="checkbox">重试全部异常</span></label>
              </div>
              <div class="row"><button class="primary" id="xfc-probe-start">开始检查</button><button id="xfc-probe-stop">停止检查</button></div>
              <div class="xfc-progress" id="xfc-probe-progress" hidden><div class="xfc-progress-track"><span class="xfc-progress-bar"></span></div><small>等待开始</small></div>
            </section>
            <section>
              <h3>3. 筛选与导出</h3>
              <div class="row"><a class="xfc-btn" id="xfc-dashboard" target="_blank" rel="noreferrer">打开筛选页面</a><button id="xfc-export">导出当前 CSV</button></div>
            </section>
            <section>
              <h3>4. 分批取消关注（登录态）</h3>
              <div class="xfc-queue-head"><strong id="xfc-queue-summary">队列尚未读取</strong><button id="xfc-refresh-queue">刷新队列</button></div>
              <textarea class="xfc-queue-list" id="xfc-queue-list" readonly hidden placeholder="静态页面发送的待取消账号会显示在这里"></textarea>
              <p class="xfc-template-note">取消请求模板会自动生成，通常不需要复制第二个 cURL。</p>
              <details>
                <summary>高级兜底：接口变化时粘贴 destroy.json cURL</summary>
                <textarea id="xfc-destroy-curl" placeholder="仅在自动模板失效时，粘贴 friendships/destroy.json 的 Copy as cURL (bash)"></textarea>
                <div class="row"><button id="xfc-save-destroy">保存兜底模板</button><button id="xfc-auto-destroy">恢复自动模板</button></div>
              </details>
              <div class="row">
                <label>本批数量<input id="xfc-batch-size" type="number" min="1" max="50" value="10"></label>
                <label>间隔（秒）<input id="xfc-unfollow-delay" type="number" min="1" value="5"></label>
              </div>
              <div class="row"><button class="danger" id="xfc-unfollow-start">确认并执行一批</button><button id="xfc-unfollow-stop">停止取消任务</button></div>
              <div class="xfc-progress" id="xfc-unfollow-progress" hidden><div class="xfc-progress-track"><span class="xfc-progress-bar"></span></div><small>等待开始</small></div>
            </section>
            <div id="xfc-log">[XFC] 等待操作。控制台可用 “XFC” 过滤完整日志。</div>
            <details class="xfc-data-management">
              <summary>数据管理</summary>
              <p>只清除当前活动账号的本地数据，其他账号不受影响。</p>
              <button class="xfc-clear-danger" id="xfc-clear-data">清空当前账号数据</button>
            </details>
          </main>
        </aside>
      `);
      el("xfc-dashboard").href = app.dashboardUrl;
      for (const id of ["xfc-support", "xfc-support-prompt-link"]) {
        el(id).href = app.sponsorUrl;
      }
      const logLines = [];
      const showLog = (detail) => {
        const time = new Date().toLocaleTimeString();
        logLines.push(`[${time}][${detail.scope || "UI"}] ${detail.message}`);
        if (logLines.length > 30) logLines.shift();
        el("xfc-log").textContent = logLines.join("\n");
        el("xfc-log").scrollTop = el("xfc-log").scrollHeight;
      };
      const log = (value, level = "info", scope = "UI") => {
        app.log(level, scope, value);
      };
      const setProgress = (id, update = {}) => {
        const root = el(id);
        const phase = update.phase || "progress";
        const total = Number(update.total);
        const current = Number(update.current || 0);
        root.hidden = false;
        root.className = `xfc-progress ${["complete", "error", "stopped"].includes(phase) ? phase : "active"}`;
        const knownTotal = Number.isFinite(total) && total > 0;
        root.classList.toggle("indeterminate", !knownTotal && !["complete", "error", "stopped"].includes(phase));
        const percent = knownTotal ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
        root.querySelector(".xfc-progress-bar").style.width =
          phase === "complete" ? "100%" : knownTotal ? `${percent}%` : "";
        root.querySelector("small").textContent = update.message || "处理中…";
      };
      const setBusy = (id, busy, busyLabel, normalLabel) => {
        const button = el(id);
        button.disabled = busy;
        button.textContent = busy ? busyLabel : normalLabel;
      };
      const hideSupportPrompt = () => {
        el("xfc-support-prompt").hidden = true;
      };
      const recordSupportMilestone = async (milestone) => {
        const fallback = {
          success_count: 0,
          shown_count: 0,
          last_shown_at: "",
          dismissed_forever: false,
          milestones: []
        };
        const saved = await app.gmGet(SUPPORT_PROMPT_KEY, fallback);
        const state = saved && typeof saved === "object" ? { ...fallback, ...saved } : fallback;
        state.milestones = Array.isArray(state.milestones) ? state.milestones : [];
        if (state.milestones.includes(milestone)) return;
        state.milestones = [...state.milestones.slice(-19), milestone];
        state.success_count = Number(state.success_count || 0) + 1;
        const lastShown = Date.parse(state.last_shown_at || "");
        const cooldownPassed = !Number.isFinite(lastShown) || Date.now() - lastShown >= SUPPORT_COOLDOWN_MS;
        if (
          !state.dismissed_forever &&
          Number(state.shown_count || 0) < 2 &&
          state.success_count >= 2 &&
          cooldownPassed
        ) {
          state.shown_count = Number(state.shown_count || 0) + 1;
          state.last_shown_at = new Date().toISOString();
          el("xfc-support-prompt").hidden = false;
        }
        await app.gmSet(SUPPORT_PROMPT_KEY, state);
      };
      const watchedQueueKeys = new Set();
      const refreshQueue = async (writeLog = true) => {
        const sourceUserId = await app.getActiveSourceId();
        const queue = await app.loadUnfollowQueue(sourceUserId);
        const dataset = await app.loadDataset(sourceUserId);
        const pending = queue;
        const success = dataset.accounts.filter((account) =>
          account.unfollow_status === "success" || account.unfollowed_at
        ).length;
        const failed = queue.filter((item) => item.status === "failed").length;
        const needsReview = queue.filter((item) => ["executing", "needs_review"].includes(item.status)).length;
        el("xfc-queue-summary").textContent =
          `活动队列 ${pending.length} 人 · 历史成功 ${success}` +
          (failed ? ` · 失败待重试 ${failed}` : "") +
          (needsReview ? ` · 待人工核验 ${needsReview}` : "");
        const list = el("xfc-queue-list");
        list.hidden = pending.length === 0;
        list.value = pending
          .map((item, index) =>
            `${index + 1}. @${item.screen_name || "未知"} · ${item.account_id}` +
            (item.status === "failed" ? " · 上次失败" :
              ["executing", "needs_review"].includes(item.status) ? " · 结果待核验" : "")
          )
          .join("\n");
        if (writeLog) {
          log(`取消队列已刷新：待处理 ${pending.length}，历史成功 ${success}。`, "info", "Unfollow");
        }
        if (
          sourceUserId &&
          typeof GM_addValueChangeListener === "function" &&
          !watchedQueueKeys.has(app.queueKey(sourceUserId))
        ) {
          const queueKey = app.queueKey(sourceUserId);
          watchedQueueKeys.add(queueKey);
          GM_addValueChangeListener(queueKey, () => refreshQueue(false));
        }
        if (queue.length) {
          setProgress("xfc-unfollow-progress", {
            phase: "stopped",
            message: `取消队列待处理 ${pending.length} 人 · 历史成功 ${success}`,
            current: 0,
            total: pending.length
          });
        } else {
          el("xfc-unfollow-progress").hidden = true;
        }
        return queue;
      };
      const restoreState = async () => {
        const dataset = await app.loadDataset();
        const total = dataset.accounts.length;
        const probed = dataset.accounts.filter((account) => account.fetched_at).length;
        const sourceUserId = String(dataset.source_user_id || "");
        el("xfc-account-summary").textContent = sourceUserId
          ? `当前数据账号：${sourceUserId} · 关注 ${total} 人 · 已检查 ${probed}/${total}`
          : "尚无账号数据，请先导出关注列表。";
        if (total || dataset.following_page) {
          setProgress("xfc-following-progress", {
            phase: dataset.completed_following ? "complete" : "stopped",
            message: dataset.completed_following
              ? `关注列表已完成 · 共 ${total} 人`
              : `关注列表未完成 · 已保存 ${total} 人 · 第 ${dataset.following_page || 0} 页`,
            current: total,
            total: dataset.completed_following ? total : undefined
          });
        } else {
          el("xfc-following-progress").hidden = true;
        }
        if (total) {
          const savedStatus = dataset.profile_probe?.status || "paused";
          setProgress("xfc-probe-progress", {
            phase:
              probed >= total
                ? "complete"
                : savedStatus === "error"
                  ? "error"
                  : "stopped",
            message:
              savedStatus === "running"
                ? `${app.profileProbe.running ? "正在检查" : "上次任务中断，可安全继续"} · 已检查 ${probed}/${total}`
                : `已检查 ${probed}/${total} · ${savedStatus === "error" ? "上次任务异常停止" : probed >= total ? "全部完成" : "等待继续"}`,
            current: probed,
            total
          });
        } else {
          el("xfc-probe-progress").hidden = true;
        }
        await refreshQueue(false);
      };
      app.on("log", (event) => showLog(event.detail));
      el("xfc-help-toggle").onclick = () => {
        const help = el("xfc-help");
        help.hidden = !help.hidden;
        el("xfc-help-toggle").setAttribute("aria-expanded", String(!help.hidden));
      };
      this.open = () => {
        el("xfc-panel").hidden = false;
        restoreState();
      };
      this.close = () => {
        el("xfc-panel").hidden = true;
      };
      const panel = el("xfc-panel");
      panel.addEventListener("wheel", (event) => {
        const atTop = panel.scrollTop <= 0;
        const atBottom = Math.ceil(panel.scrollTop + panel.clientHeight) >= panel.scrollHeight;
        if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
          event.preventDefault();
        }
        event.stopPropagation();
      }, { passive: false });
      let lastTouchY = null;
      panel.addEventListener("touchstart", (event) => {
        lastTouchY = event.touches[0]?.clientY ?? null;
      }, { passive: true });
      panel.addEventListener("touchmove", (event) => {
        const currentY = event.touches[0]?.clientY;
        if (lastTouchY == null || currentY == null) return;
        const deltaY = lastTouchY - currentY;
        lastTouchY = currentY;
        const atTop = panel.scrollTop <= 0;
        const atBottom = Math.ceil(panel.scrollTop + panel.clientHeight) >= panel.scrollHeight;
        if ((deltaY < 0 && atTop) || (deltaY > 0 && atBottom)) {
          event.preventDefault();
        }
        event.stopPropagation();
      }, { passive: false });
      el("xfc-launch").onclick = () => {
        if (el("xfc-panel").hidden) this.open();
        else this.close();
      };
      el("xfc-close").onclick = () => this.close();
      el("xfc-support-later").onclick = hideSupportPrompt;
      el("xfc-support-prompt-link").onclick = hideSupportPrompt;
      el("xfc-support-never").onclick = async () => {
        const state = await app.gmGet(SUPPORT_PROMPT_KEY, {});
        await app.gmSet(SUPPORT_PROMPT_KEY, { ...state, dismissed_forever: true });
        hideSupportPrompt();
      };
      el("xfc-following-stop").onclick = () => {
        app.following.stop();
        log("已请求停止关注列表导出，将在当前请求结束后保存进度。", "warn", "Following");
      };
      el("xfc-following-start").onclick = async () => {
        setBusy("xfc-following-start", true, "正在导出…", "开始 / 继续导出");
        try {
          const curl = el("xfc-following-curl").value;
          el("xfc-following-curl").value = "";
          const dataset = await app.following.start(curl, (update) => setProgress("xfc-following-progress", update));
          if (dataset.completed_following) {
            setProgress("xfc-following-progress", {
              phase: "complete",
              message: `导出完成，共 ${dataset.accounts.length} 人`,
              current: dataset.accounts.length,
              total: dataset.accounts.length
            });
            log(`关注列表导出完成，共 ${dataset.accounts.length} 人。`, "info", "Following");
            await recordSupportMilestone(
              `following:${dataset.source_user_id}:${dataset.following_page || 0}`
            );
          }
        } catch (error) {
          const message = error.message || String(error);
          setProgress("xfc-following-progress", { phase: "error", message });
          log(message, "error", "Following");
        } finally {
          setBusy("xfc-following-start", false, "", "开始 / 继续导出");
          await restoreState();
        }
      };
      el("xfc-probe-start").onclick = async () => {
        setBusy("xfc-probe-start", true, "正在检查…", "开始检查");
        try {
          const dataset = await app.profileProbe.start({
            limit: el("xfc-probe-all").checked ? 0 : Number(el("xfc-probe-limit").value),
            intervalMs: Number(el("xfc-probe-delay").value) * 1000,
            concurrency: Number(el("xfc-probe-concurrency").value),
            retryFailed: el("xfc-retry-failed").checked
          }, (update) => setProgress("xfc-probe-progress", update));
          log(
            `本轮推文检查结束，整体 ${dataset.profile_probe?.completed || 0}/${dataset.accounts.length}。`,
            "info",
            "ProfileProbe"
          );
          if (Number(dataset.profile_probe?.batch_completed || 0) > 0) {
            await recordSupportMilestone(
              `probe:${dataset.source_user_id}:${dataset.profile_probe?.started_at || Date.now()}`
            );
          }
        } catch (error) {
          const message = error.message || String(error);
          setProgress("xfc-probe-progress", { phase: "error", message });
          log(message, "error", "ProfileProbe");
        } finally {
          setBusy("xfc-probe-start", false, "", "开始检查");
          await restoreState();
        }
      };
      const syncProbeLimitLock = () => {
        const limit = el("xfc-probe-limit");
        const locked = el("xfc-probe-all").checked;
        limit.disabled = locked;
        limit.readOnly = locked;
        limit.tabIndex = locked ? -1 : 0;
        limit.setAttribute("aria-disabled", String(locked));
        limit.title = locked ? "已选择处理全部剩余，本次最多不可修改" : "";
      };
      el("xfc-probe-all").addEventListener("change", syncProbeLimitLock);
      syncProbeLimitLock();
      el("xfc-probe-stop").onclick = () => {
        app.profileProbe.stop();
        log("已请求停止推文检查，将在当前请求结束并保存缓冲结果后暂停。", "warn", "ProfileProbe");
      };
      el("xfc-unfollow-stop").onclick = () => {
        app.unfollow.stop();
        log("已请求停止取消任务，将在当前请求结束后暂停。", "warn", "Unfollow");
      };
      el("xfc-export").onclick = async () => {
        const dataset = await app.loadDataset();
        app.download("x_following_cleaner.csv", app.toCSV(dataset.accounts), "text/csv;charset=utf-8");
        log(`已导出 CSV，共 ${dataset.accounts.length} 行。`);
      };
      el("xfc-clear-data").onclick = async () => {
        const sourceUserId = await app.getActiveSourceId();
        const activeLeases = await app.activeTaskLeases(sourceUserId);
        if (app.following.running || app.profileProbe.running || app.unfollow.running || activeLeases.length) {
          log("有任务正在运行，请先停止任务并等待当前请求结束后再清空数据。", "error", "Storage");
          return;
        }
        if (!confirm(
          `确认清空当前账号 ${sourceUserId || "未知"} 的关注列表、探测结果和取消队列？\n\n其他账号的数据不会被清空。`
        )) return;
        if (!confirm("最后确认：清空后只能通过 CSV 或重新导出恢复。确定继续吗？")) return;
        await app.clearActiveData();
        await restoreState();
        log(`账号 ${sourceUserId || "未知"} 的本地关注数据和取消队列已清空。`, "warn");
      };
      el("xfc-refresh-queue").onclick = () => refreshQueue(true);
      el("xfc-save-destroy").onclick = async () => {
        try {
          await app.unfollow.saveTemplate(el("xfc-destroy-curl").value);
          el("xfc-destroy-curl").value = "";
          log("destroy.json 请求模板已保存，不保存 Cookie 和 ct0。");
        } catch (error) { log(error.message || String(error), "error", "Unfollow"); }
      };
      el("xfc-auto-destroy").onclick = async () => {
        await app.unfollow.saveAutomaticTemplate();
        el("xfc-destroy-curl").value = "";
        log("已恢复自动生成的 destroy.json 请求模板。", "info", "Unfollow");
      };
      el("xfc-unfollow-start").onclick = async () => {
        const size = Number(el("xfc-batch-size").value);
        if (!confirm(`确认执行最多 ${size} 个取消关注请求？`)) return;
        setBusy("xfc-unfollow-start", true, "正在执行…", "确认并执行一批");
        try {
          await app.unfollow.start({
            batchSize: size,
            intervalMs: Number(el("xfc-unfollow-delay").value) * 1000
          }, (update) => setProgress("xfc-unfollow-progress", update));
          if (!app.unfollow.stopRequested) {
            const message = el("xfc-unfollow-progress").querySelector("small").textContent;
            setProgress("xfc-unfollow-progress", { phase: "complete", message });
            log("本批取消关注执行结束。", "info", "Unfollow");
          }
          await refreshQueue(false);
        } catch (error) {
          const message = error.message || String(error);
          setProgress("xfc-unfollow-progress", { phase: "error", message });
          log(message, "error", "Unfollow");
        } finally {
          setBusy("xfc-unfollow-start", false, "", "确认并执行一批");
          await restoreState();
        }
      };
      restoreState();
    }
  };
})(window.XFollowCleaner);


/* ---- main.js ---- */
(function (app) {
  if (location.hostname === "x.com") {
    app.panel.mount();
    GM_registerMenuCommand("打开 X/推特取关助手", () => {
      app.panel.open();
    });
    GM_registerMenuCommand("导出当前 CSV", async () => {
      const dataset = await app.loadDataset();
      app.download("x_following_cleaner.csv", app.toCSV(dataset.accounts), "text/csv;charset=utf-8");
    });
    GM_registerMenuCommand("赞助开发者", () => {
      window.open(app.sponsorUrl, "_blank", "noopener,noreferrer");
    });
  } else {
    app.bridge.install();
  }
})(window.XFollowCleaner);

})();

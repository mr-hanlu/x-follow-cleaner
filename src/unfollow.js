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

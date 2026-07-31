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

    async queueAccounts(accounts) {
      const dataset = await app.loadDataset();
      const sourceUserId = String(dataset.source_user_id || "");
      if (!sourceUserId) throw new Error("没有活动账号，无法建立取消队列。");
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
      await app.saveUnfollowQueue(queue, sourceUserId);
      return queue;
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
      let queue = await app.loadUnfollowQueue(sourceUserId);
      const batchSize = Math.min(50, Math.max(1, Number(options.batchSize || 10)));
      const intervalMs = Math.max(1000, Number(options.intervalMs || 5000));
      const targets = queue.filter((item) => item.status !== "success").slice(0, batchSize);
      if (!targets.length) throw new Error("没有待取消账号。");
      const map = new Map(dataset.accounts.map((account) => [String(account.account_id), account]));
      this.running = true;
      this.stopRequested = false;
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

      try {
        for (let index = 0; index < targets.length; index += 1) {
          if (this.stopRequested) break;
          const target = targets[index];
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
          await app.saveUnfollowQueue(queue, sourceUserId);
          await app.saveDataset(dataset);
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
          if (index + 1 < targets.length) await app.sleep(intervalMs);
        }
        if (this.stopRequested) {
          const completed = targets.filter((target) =>
            queue.find((item) => item.account_id === target.account_id)?.status === "success"
          ).length;
          onProgress({
            phase: "stopped",
            message: `已安全停止；本批成功 ${completed}/${targets.length}`,
            current: completed,
            total: targets.length
          });
          app.log("warn", "Unfollow", "用户请求停止", {
            completed,
            total: targets.length
          });
        }
        return queue;
      } catch (error) {
        app.log("error", "Unfollow", error.message || String(error));
        throw error;
      } finally {
        this.running = false;
      }
    },

    stop() {
      this.stopRequested = true;
    }
  };
})(window.XFollowCleaner);

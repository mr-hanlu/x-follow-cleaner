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
          await app.gmSet(app.constants.UNFOLLOW_QUEUE_KEY, queue);
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

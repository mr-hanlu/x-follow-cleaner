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

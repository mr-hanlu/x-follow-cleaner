(function (app) {
  app.bridge = {
    install() {
      if (location.hostname === "x.com") return;

      window.addEventListener("xfc:request-dataset", async () => {
        const dataset = await app.loadDataset();
        app.log("info", "Bridge", "向筛选页面发送数据集", {
          accounts: dataset.accounts.length,
          updated_at: dataset.updated_at
        });
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
        app.log("info", "Bridge", "审核标记已写回", {
          reviews: reviews.length,
          queued: queue.filter((item) => item.status !== "success").length
        });
        window.dispatchEvent(
          new CustomEvent("xfc:reviews-saved", {
            detail: { saved: reviews.length, queued: queue.filter((item) => item.status !== "success").length }
          })
        );
      });

      window.dispatchEvent(new CustomEvent("xfc:bridge-ready"));
      app.log("info", "Bridge", "筛选页面数据桥已就绪", {
        origin: location.origin
      });
    }
  };
})(window.XFollowCleaner);

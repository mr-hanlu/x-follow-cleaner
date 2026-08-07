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
        if (reviews.length !== requestedReviews.length) {
          const unknown = requestedReviews.length - reviews.length;
          const message = `有 ${unknown} 个账号不在油猴数据集中，请先同步或从 CSV 恢复数据。`;
          app.log("error", "Bridge", message);
          window.dispatchEvent(new CustomEvent("xfc:reviews-error", { detail: { message } }));
          return;
        }
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

      window.addEventListener("xfc:restore-dataset", async (event) => {
        try {
          const imported = event.detail?.dataset;
          const requestedSource = String(imported?.source_user_id || "");
          const requestedAccounts = Array.isArray(imported?.accounts) ? imported.accounts : [];
          if (!/^\d+$/.test(requestedSource)) {
            throw new Error("CSV 缺少有效的所属账号 ID，无法安全恢复到油猴。");
          }
          if (!requestedAccounts.length) throw new Error("CSV 中没有可恢复的账号数据。");
          const invalidAccounts = requestedAccounts.filter((account) =>
            !/^\d+$/.test(String(account?.account_id || ""))
          );
          if (invalidAccounts.length) {
            throw new Error(`CSV 中有 ${invalidAccounts.length} 条无效账号记录，已停止恢复。`);
          }
          const ids = requestedAccounts.map((account) => String(account.account_id));
          if (new Set(ids).size !== ids.length) throw new Error("CSV 中存在重复账号 ID，已停止恢复。");

          const current = await app.loadDataset();
          const currentSource = String(current.source_user_id || "");
          if (currentSource && currentSource !== requestedSource) {
            throw new Error(`账号不一致：油猴当前数据属于 ${currentSource}，CSV 属于 ${requestedSource}。`);
          }
          if (current.accounts.length) {
            throw new Error("油猴中已有关注数据。为避免覆盖，请先从油猴同步；只有数据为空时才能从 CSV 恢复。");
          }

          const restored = await app.saveDataset({
            ...app.emptyDataset(requestedSource),
            completed_following: Boolean(imported.completed_following),
            following_cursor: String(imported.following_cursor || ""),
            following_page: Math.max(0, Number(imported.following_page || 0)),
            profile_probe: imported.profile_probe || null,
            accounts: requestedAccounts.map((account) => ({
              ...account,
              account_id: String(account.account_id)
            }))
          });
          const queueResult = await app.unfollow.queueAccounts();
          watchSource(requestedSource);
          await sendDataset();
          window.dispatchEvent(new CustomEvent("xfc:restore-saved", {
            detail: {
              source_user_id: requestedSource,
              restored: restored.accounts.length,
              ...queueResult.stats
            }
          }));
          app.log("info", "Bridge", "CSV 数据已恢复到油猴", {
            source_user_id: requestedSource,
            restored: restored.accounts.length,
            queued: queueResult.stats.queued
          });
        } catch (error) {
          const message = error.message || String(error);
          app.log("error", "Bridge", message);
          window.dispatchEvent(new CustomEvent("xfc:restore-error", { detail: { message } }));
        }
      });

      window.dispatchEvent(new CustomEvent("xfc:bridge-ready"));
      app.log("info", "Bridge", "筛选页面数据桥已就绪", {
        origin: location.origin
      });
    }
  };
})(window.XFollowCleaner);

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

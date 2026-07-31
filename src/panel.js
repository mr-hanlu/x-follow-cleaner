(function (app) {
  const styles = `
    #xfc-launch{position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:11px 16px;background:#0f1419;color:#fff;font:700 13px system-ui;box-shadow:0 10px 35px #0004;cursor:pointer}
    #xfc-panel{position:fixed;right:18px;bottom:70px;z-index:2147483647;width:min(430px,calc(100vw - 28px));max-height:78vh;overflow:auto;border:1px solid #cfd9de;border-radius:18px;background:#fff;color:#0f1419;box-shadow:0 24px 80px #0005;font:13px/1.45 system-ui}
    #xfc-panel[hidden]{display:none}#xfc-panel header{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:15px 17px;background:#fff;border-bottom:1px solid #eff3f4}
    #xfc-panel h2,#xfc-panel p{margin:0}#xfc-panel h2{font-size:17px}#xfc-panel main{padding:14px 17px 18px}#xfc-panel section{padding:13px 0;border-bottom:1px solid #eff3f4}
    #xfc-panel section:last-child{border:0}#xfc-panel h3{margin:0 0 9px;font-size:13px}#xfc-panel textarea{width:100%;height:90px;box-sizing:border-box;padding:9px;border:1px solid #cfd9de;border-radius:9px;font:11px/1.4 ui-monospace,monospace;resize:vertical}
    #xfc-panel .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}#xfc-panel button,#xfc-panel a.xfc-btn{border:1px solid #cfd9de;border-radius:999px;padding:7px 11px;background:#fff;color:#0f1419;text-decoration:none;font:700 12px system-ui;cursor:pointer}
    #xfc-panel button.primary{background:#0f1419;color:#fff;border-color:#0f1419}#xfc-panel button.danger{background:#b42318;color:#fff;border-color:#b42318}
    #xfc-panel button:disabled{cursor:wait;opacity:.55}
    #xfc-panel label{display:flex;flex-direction:column;gap:4px;color:#536471;font-size:11px}#xfc-panel input{width:92px;padding:6px 8px;border:1px solid #cfd9de;border-radius:8px}#xfc-panel input[type=checkbox]{width:auto;padding:0}
    .xfc-progress{margin-top:9px}.xfc-progress-track{height:7px;overflow:hidden;border-radius:999px;background:#eff3f4}.xfc-progress-bar{display:block;width:0;height:100%;border-radius:inherit;background:#1d9bf0;transition:width .2s ease}.xfc-progress.active.indeterminate .xfc-progress-bar{width:36%;animation:xfc-slide 1.15s ease-in-out infinite}.xfc-progress.complete .xfc-progress-bar{width:100%;background:#2e7d53}.xfc-progress.error .xfc-progress-bar{width:100%;background:#b42318}.xfc-progress.stopped .xfc-progress-bar{background:#b7791f}.xfc-progress small{display:block;margin-top:5px;color:#536471;font-size:10px}
    @keyframes xfc-slide{from{transform:translateX(-110%)}to{transform:translateX(300%)}}
    #xfc-log{max-height:150px;min-height:50px;overflow:auto;margin-top:10px;padding:9px;border-radius:9px;background:#f7f9f9;color:#536471;font:10px/1.55 ui-monospace,monospace;white-space:pre-wrap}
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
        <button id="xfc-launch" type="button">关注清理助手</button>
        <aside id="xfc-panel" hidden>
          <header><h2>关注清理助手</h2><button id="xfc-close">关闭</button></header>
          <main>
            <section>
              <h3>1. 导出关注列表（登录态）</h3>
              <textarea id="xfc-following-curl" placeholder="粘贴 Following 的 Copy as cURL (bash)"></textarea>
              <div class="row"><button class="primary" id="xfc-following-start">开始 / 继续导出</button></div>
              <div class="xfc-progress" id="xfc-following-progress" hidden><div class="xfc-progress-track"><span class="xfc-progress-bar"></span></div><small>等待开始</small></div>
            </section>
            <section>
              <h3>2. 匿名探测公开主页</h3>
              <div class="row">
                <label>本次最多<input id="xfc-probe-limit" type="number" min="0" value="50"></label>
                <label>间隔（秒）<input id="xfc-probe-delay" type="number" min="1" value="3"></label>
                <label><span>范围</span><span><input id="xfc-retry-failed" type="checkbox">重试全部异常</span></label>
              </div>
              <div class="row"><button class="primary" id="xfc-probe-start">开始探测</button><button id="xfc-stop">安全停止</button></div>
              <div class="xfc-progress" id="xfc-probe-progress" hidden><div class="xfc-progress-track"><span class="xfc-progress-bar"></span></div><small>等待开始</small></div>
            </section>
            <section>
              <h3>3. 筛选与导出</h3>
              <div class="row"><a class="xfc-btn" id="xfc-dashboard" target="_blank" rel="noreferrer">打开筛选页面</a><button id="xfc-export">导出当前 CSV</button><button id="xfc-clear-data">清空本地数据</button></div>
            </section>
            <section>
              <h3>4. 分批取消关注（登录态）</h3>
              <textarea id="xfc-destroy-curl" placeholder="粘贴 friendships/destroy.json 的 Copy as cURL (bash)"></textarea>
              <div class="row"><button id="xfc-save-destroy">保存请求模板</button></div>
              <div class="row">
                <label>本批数量<input id="xfc-batch-size" type="number" min="1" max="50" value="10"></label>
                <label>间隔（秒）<input id="xfc-unfollow-delay" type="number" min="1" value="5"></label>
              </div>
              <div class="row"><button class="danger" id="xfc-unfollow-start">确认并执行一批</button></div>
              <div class="xfc-progress" id="xfc-unfollow-progress" hidden><div class="xfc-progress-track"><span class="xfc-progress-bar"></span></div><small>等待开始</small></div>
            </section>
            <div id="xfc-log">[XFC] 等待操作。控制台可用 “XFC” 过滤完整日志。</div>
          </main>
        </aside>
      `);
      el("xfc-dashboard").href = app.dashboardUrl;
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
      app.on("log", (event) => showLog(event.detail));
      el("xfc-launch").onclick = () => { el("xfc-panel").hidden = !el("xfc-panel").hidden; };
      el("xfc-close").onclick = () => { el("xfc-panel").hidden = true; };
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
          }
        } catch (error) {
          const message = error.message || String(error);
          setProgress("xfc-following-progress", { phase: "error", message });
          log(message, "error", "Following");
        } finally {
          setBusy("xfc-following-start", false, "", "开始 / 继续导出");
        }
      };
      el("xfc-probe-start").onclick = async () => {
        setBusy("xfc-probe-start", true, "正在探测…", "开始探测");
        try {
          await app.profileProbe.start({
            limit: Number(el("xfc-probe-limit").value),
            intervalMs: Number(el("xfc-probe-delay").value) * 1000,
            retryFailed: el("xfc-retry-failed").checked
          }, (update) => setProgress("xfc-probe-progress", update));
          if (!app.profileProbe.stopRequested) {
            const progress = el("xfc-probe-progress");
            const message = progress.querySelector("small").textContent || "本轮匿名探测结束";
            setProgress("xfc-probe-progress", { phase: "complete", message });
            log("本轮匿名探测结束。", "info", "ProfileProbe");
          }
        } catch (error) {
          const message = error.message || String(error);
          setProgress("xfc-probe-progress", { phase: "error", message });
          log(message, "error", "ProfileProbe");
        } finally {
          setBusy("xfc-probe-start", false, "", "开始探测");
        }
      };
      el("xfc-stop").onclick = () => {
        app.following.stop();
        app.profileProbe.stop();
        app.unfollow.stop();
        log("已请求安全停止，将在当前请求结束后暂停。", "warn");
      };
      el("xfc-export").onclick = async () => {
        const dataset = await app.loadDataset();
        app.download("x_following_cleaner.csv", app.toCSV(dataset.accounts), "text/csv;charset=utf-8");
        log(`已导出 CSV，共 ${dataset.accounts.length} 行。`);
      };
      el("xfc-clear-data").onclick = async () => {
        if (!confirm("确认清空关注列表、探测结果和取消队列？请先导出 CSV 备份。")) return;
        await app.gmDelete(app.constants.DATASET_KEY);
        await app.gmDelete(app.constants.UNFOLLOW_QUEUE_KEY);
        log("本地关注数据和取消队列已清空。", "warn");
      };
      el("xfc-save-destroy").onclick = async () => {
        try {
          await app.unfollow.saveTemplate(el("xfc-destroy-curl").value);
          el("xfc-destroy-curl").value = "";
          log("destroy.json 请求模板已保存，不保存 Cookie 和 ct0。");
        } catch (error) { log(error.message || String(error), "error", "Unfollow"); }
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
        } catch (error) {
          const message = error.message || String(error);
          setProgress("xfc-unfollow-progress", { phase: "error", message });
          log(message, "error", "Unfollow");
        } finally {
          setBusy("xfc-unfollow-start", false, "", "确认并执行一批");
        }
      };
    }
  };
})(window.XFollowCleaner);

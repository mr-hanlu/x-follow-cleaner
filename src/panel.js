(function (app) {
  const styles = `
    #xfc-launch{position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:11px 16px;background:#0f1419;color:#fff;font:700 13px system-ui;box-shadow:0 10px 35px #0004;cursor:pointer}
    #xfc-panel{position:fixed;right:18px;bottom:70px;z-index:2147483647;width:min(430px,calc(100vw - 28px));max-height:78vh;overflow:auto;border:1px solid #cfd9de;border-radius:18px;background:#fff;color:#0f1419;box-shadow:0 24px 80px #0005;font:13px/1.45 system-ui}
    #xfc-panel[hidden]{display:none}#xfc-panel header{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:15px 17px;background:#fff;border-bottom:1px solid #eff3f4}
    #xfc-panel h2,#xfc-panel p{margin:0}#xfc-panel h2{font-size:17px}#xfc-panel main{padding:14px 17px 18px}#xfc-panel section{padding:13px 0;border-bottom:1px solid #eff3f4}
    #xfc-panel section:last-child{border:0}#xfc-panel h3{margin:0 0 9px;font-size:13px}#xfc-panel textarea{width:100%;height:90px;box-sizing:border-box;padding:9px;border:1px solid #cfd9de;border-radius:9px;font:11px/1.4 ui-monospace,monospace;resize:vertical}
    #xfc-panel .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}#xfc-panel button,#xfc-panel a.xfc-btn{border:1px solid #cfd9de;border-radius:999px;padding:7px 11px;background:#fff;color:#0f1419;text-decoration:none;font:700 12px system-ui;cursor:pointer}
    #xfc-panel button.primary{background:#0f1419;color:#fff;border-color:#0f1419}#xfc-panel button.danger{background:#b42318;color:#fff;border-color:#b42318}
    #xfc-panel label{display:flex;flex-direction:column;gap:4px;color:#536471;font-size:11px}#xfc-panel input{width:92px;padding:6px 8px;border:1px solid #cfd9de;border-radius:8px}#xfc-panel input[type=checkbox]{width:auto;padding:0}
    #xfc-log{min-height:44px;margin-top:10px;padding:9px;border-radius:9px;background:#f7f9f9;color:#536471;white-space:pre-wrap}
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
            </section>
            <section>
              <h3>2. 匿名探测公开主页</h3>
              <div class="row">
                <label>本次最多<input id="xfc-probe-limit" type="number" min="0" value="50"></label>
                <label>间隔（秒）<input id="xfc-probe-delay" type="number" min="1" value="3"></label>
                <label><span>范围</span><span><input id="xfc-retry-failed" type="checkbox">重试全部异常</span></label>
              </div>
              <div class="row"><button class="primary" id="xfc-probe-start">开始探测</button><button id="xfc-stop">安全停止</button></div>
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
            </section>
            <div id="xfc-log">等待操作。</div>
          </main>
        </aside>
      `);
      el("xfc-dashboard").href = app.dashboardUrl;
      const log = (value) => {
        el("xfc-log").textContent = value;
        app.emit("log", { message: value });
      };
      el("xfc-launch").onclick = () => { el("xfc-panel").hidden = !el("xfc-panel").hidden; };
      el("xfc-close").onclick = () => { el("xfc-panel").hidden = true; };
      el("xfc-following-start").onclick = async () => {
        try {
          const curl = el("xfc-following-curl").value;
          el("xfc-following-curl").value = "";
          await app.following.start(curl, ({ message }) => log(message));
          log("关注列表导出完成。");
        } catch (error) { log(error.message || String(error)); }
      };
      el("xfc-probe-start").onclick = async () => {
        try {
          await app.profileProbe.start({
            limit: Number(el("xfc-probe-limit").value),
            intervalMs: Number(el("xfc-probe-delay").value) * 1000,
            retryFailed: el("xfc-retry-failed").checked
          }, ({ message }) => log(message));
          log("本轮匿名探测结束。");
        } catch (error) { log(error.message || String(error)); }
      };
      el("xfc-stop").onclick = () => {
        app.following.stop();
        app.profileProbe.stop();
        app.unfollow.stop();
        log("已请求安全停止，将在当前请求结束后暂停。");
      };
      el("xfc-export").onclick = async () => {
        const dataset = await app.loadDataset();
        app.download("x_following_cleaner.csv", app.toCSV(dataset.accounts), "text/csv;charset=utf-8");
      };
      el("xfc-clear-data").onclick = async () => {
        if (!confirm("确认清空关注列表、探测结果和取消队列？请先导出 CSV 备份。")) return;
        await app.gmDelete(app.constants.DATASET_KEY);
        await app.gmDelete(app.constants.UNFOLLOW_QUEUE_KEY);
        log("本地关注数据和取消队列已清空。");
      };
      el("xfc-save-destroy").onclick = async () => {
        try {
          await app.unfollow.saveTemplate(el("xfc-destroy-curl").value);
          el("xfc-destroy-curl").value = "";
          log("destroy.json 请求模板已保存，不保存 Cookie 和 ct0。");
        } catch (error) { log(error.message || String(error)); }
      };
      el("xfc-unfollow-start").onclick = async () => {
        const size = Number(el("xfc-batch-size").value);
        if (!confirm(`确认执行最多 ${size} 个取消关注请求？`)) return;
        try {
          await app.unfollow.start({
            batchSize: size,
            intervalMs: Number(el("xfc-unfollow-delay").value) * 1000
          }, ({ message }) => log(message));
          log("本批取消关注执行结束。");
        } catch (error) { log(error.message || String(error)); }
      };
    }
  };
})(window.XFollowCleaner);

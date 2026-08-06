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
    #xfc-support-prompt{width:min(360px,calc(100vw - 32px));box-sizing:border-box;border:1px solid #eadca9;border-radius:18px;padding:0;background:#fffdf5;color:#0f1419;box-shadow:0 24px 90px #0007;font:13px/1.5 system-ui}#xfc-support-prompt::backdrop{background:#0f141966;backdrop-filter:blur(2px)}#xfc-support-prompt .xfc-support-dialog-head{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid #f2e8bf}#xfc-support-prompt h2,#xfc-support-prompt p{margin:0}#xfc-support-prompt h2{display:flex;align-items:center;gap:7px;font-size:16px}#xfc-support-prompt h2 span{color:#e0245e;font-size:19px}#xfc-support-prompt .xfc-support-dialog-close{border:0;background:transparent;color:#655016;font-size:18px;cursor:pointer}#xfc-support-prompt .xfc-support-dialog-body{padding:15px 17px;color:#655016}#xfc-support-prompt .xfc-support-dialog-note{margin-top:8px!important;color:#536471;font-size:11px}#xfc-support-prompt .xfc-support-dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:0 17px 16px}#xfc-support-prompt .xfc-support-dialog-actions button,#xfc-support-prompt .xfc-support-dialog-actions a{border:1px solid #d9c77f;border-radius:999px;padding:8px 12px;background:#fff;color:#655016;text-decoration:none;font:700 12px system-ui;cursor:pointer}#xfc-support-prompt .xfc-support-dialog-actions a{border-color:#e0245e;background:#e0245e;color:#fff}
    #xfc-panel .xfc-support-heart{color:#e0245e}#xfc-panel details.xfc-data-management{margin-top:12px;border-color:#e6c7c3;background:#fff8f7}#xfc-panel details.xfc-data-management summary{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#7a271f;font-size:12px;list-style:none}#xfc-panel details.xfc-data-management summary::-webkit-details-marker{display:none}#xfc-panel details.xfc-data-management summary::after{content:"展开 ›";color:#9a514a;font-size:10px}#xfc-panel details.xfc-data-management[open] summary::after{content:"收起⌄"}#xfc-panel details.xfc-data-management p{margin:9px 0!important;color:#536471;font-size:10px}#xfc-panel details.xfc-data-management button{border-color:#f2a49d;color:#b42318}
    #xfc-unfollow-confirm{width:min(390px,calc(100vw - 32px));box-sizing:border-box;border:1px solid #cfd9de;border-radius:18px;padding:0;background:#fff;color:#0f1419;box-shadow:0 24px 90px #0007;font:13px/1.45 system-ui}#xfc-unfollow-confirm::backdrop{background:#0f141980;backdrop-filter:blur(2px)}#xfc-unfollow-confirm form{margin:0}#xfc-unfollow-confirm .xfc-dialog-head{display:flex;align-items:center;justify-content:space-between;padding:15px 17px;border-bottom:1px solid #eff3f4}#xfc-unfollow-confirm h2,#xfc-unfollow-confirm p{margin:0}#xfc-unfollow-confirm h2{font-size:17px}#xfc-unfollow-confirm .xfc-dialog-close{border:0;background:transparent;color:#536471;font-size:18px;cursor:pointer}#xfc-unfollow-confirm .xfc-dialog-body{padding:15px 17px}#xfc-unfollow-confirm dl{display:grid;grid-template-columns:auto 1fr;gap:7px 14px;margin:0 0 13px;padding:11px;border-radius:10px;background:#f7f9f9}#xfc-unfollow-confirm dt{color:#536471}#xfc-unfollow-confirm dd{margin:0;text-align:right;font-weight:700;overflow-wrap:anywhere}#xfc-unfollow-confirm .xfc-dialog-accounts{max-height:100px;overflow:auto;margin:8px 0 0;padding:9px 9px 9px 28px;border:1px solid #eff3f4;border-radius:9px;color:#536471;font:11px/1.5 ui-monospace,monospace}#xfc-unfollow-confirm .xfc-dialog-warning{margin-top:12px;padding:10px;border-radius:9px;background:#fff1f0;color:#8a1c13;font-size:11px}#xfc-unfollow-confirm .xfc-dialog-warning.error{background:#b42318;color:#fff}#xfc-unfollow-confirm .xfc-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:0 17px 16px}#xfc-unfollow-confirm .xfc-dialog-actions button{border:1px solid #cfd9de;border-radius:999px;padding:8px 13px;background:#fff;color:#0f1419;font:700 12px system-ui;cursor:pointer}#xfc-unfollow-confirm .xfc-dialog-actions button.danger{border-color:#b42318;background:#b42318;color:#fff}#xfc-unfollow-confirm .xfc-dialog-actions button:disabled{cursor:not-allowed;opacity:.5}
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
          <div id="xfc-help" tabindex="-1" hidden>
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
                <label>间隔（秒）<input id="xfc-probe-delay" type="number" min="1" value="1"></label>
                <label>并发数<input id="xfc-probe-concurrency" type="number" min="1" max="8" value="8"></label>
                <label><span>数量</span><span><input id="xfc-probe-all" type="checkbox">处理全部剩余</span></label>
                <label><span>范围</span><span><input id="xfc-retry-failed" type="checkbox">重试全部异常</span></label>
              </div>
              <p class="xfc-help-note">当前默认为快速检查：1 秒、并发 8。遇到 429 时会停止并保存进度，请降低并发或延长间隔后继续。</p>
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
              <div class="row"><button class="danger" id="xfc-unfollow-start">执行这一批</button><button id="xfc-unfollow-stop">停止取消任务</button></div>
              <div class="xfc-progress" id="xfc-unfollow-progress" hidden><div class="xfc-progress-track"><span class="xfc-progress-bar"></span></div><small>等待开始</small></div>
            </section>
            <div id="xfc-log" tabindex="0" role="log" aria-label="运行日志">[XFC] 等待操作。控制台可用 “XFC” 过滤完整日志。</div>
            <details class="xfc-data-management">
              <summary><span>⚙ 数据管理 · 清空/重置</span></summary>
              <p>需要重新开始时，可清空当前账号的关注列表、检查结果和取消队列；其他账号不受影响。</p>
              <button class="xfc-clear-danger" id="xfc-clear-data">清空当前账号数据</button>
            </details>
          </main>
        </aside>
        <dialog id="xfc-unfollow-confirm" aria-labelledby="xfc-unfollow-confirm-title">
          <form method="dialog">
            <div class="xfc-dialog-head">
              <h2 id="xfc-unfollow-confirm-title">确认执行这一批</h2>
              <button class="xfc-dialog-close" value="cancel" aria-label="关闭确认弹窗">×</button>
            </div>
            <div class="xfc-dialog-body">
              <dl>
                <dt>本批人数</dt><dd id="xfc-confirm-count">0 人</dd>
                <dt>请求间隔</dt><dd id="xfc-confirm-delay">—</dd>
                <dt>队列账号</dt><dd id="xfc-confirm-source">—</dd>
                <dt>当前登录</dt><dd id="xfc-confirm-login">—</dd>
              </dl>
              <strong>即将取消关注</strong>
              <ol class="xfc-dialog-accounts" id="xfc-confirm-accounts"></ol>
              <p class="xfc-dialog-warning" id="xfc-confirm-warning">取消关注会立即提交到 X，本工具不会自动恢复；请确认队列和当前账号无误。</p>
            </div>
            <div class="xfc-dialog-actions">
              <button value="cancel">返回检查</button>
              <button class="danger" id="xfc-confirm-submit" value="confirm">确认取消关注</button>
            </div>
          </form>
        </dialog>
        <dialog id="xfc-support-prompt" aria-labelledby="xfc-support-prompt-title">
          <div class="xfc-support-dialog-head">
            <h2 id="xfc-support-prompt-title"><span aria-hidden="true">♥</span>这个工具帮你节省了时间吗？</h2>
            <button class="xfc-support-dialog-close" id="xfc-support-prompt-close" type="button" aria-label="关闭赞助提示">×</button>
          </div>
          <div class="xfc-support-dialog-body">
            <p>如果它确实帮到了你，可以自愿支持后续维护和浏览器扩展开发。</p>
            <p class="xfc-support-dialog-note">赞助不会解锁额外功能，也不会影响工具的正常使用。</p>
          </div>
          <div class="xfc-support-dialog-actions">
            <button id="xfc-support-never" type="button">不再提示</button>
            <button id="xfc-support-later" type="button">稍后再说</button>
            <a id="xfc-support-prompt-link" target="_blank" rel="noreferrer">♥ 赞助开发者</a>
          </div>
        </dialog>
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
      const confirmUnfollowBatch = ({ size, intervalSeconds, sourceUserId, loggedAccountId, targets }) => {
        const dialog = el("xfc-unfollow-confirm");
        const mismatch = Boolean(loggedAccountId && sourceUserId && loggedAccountId !== sourceUserId);
        el("xfc-confirm-count").textContent = `${targets.length} 人（最多 ${size} 人）`;
        el("xfc-confirm-delay").textContent = `${intervalSeconds} 秒`;
        el("xfc-confirm-source").textContent = sourceUserId || "未知";
        el("xfc-confirm-login").textContent = loggedAccountId || "未读取到";
        const accounts = el("xfc-confirm-accounts");
        accounts.replaceChildren();
        for (const target of targets.slice(0, 5)) {
          const item = document.createElement("li");
          item.textContent = `@${target.screen_name || target.account_id}`;
          accounts.append(item);
        }
        if (targets.length > 5) {
          const more = document.createElement("li");
          more.textContent = `以及另外 ${targets.length - 5} 人`;
          accounts.append(more);
        }
        if (!targets.length) {
          const empty = document.createElement("li");
          empty.textContent = "当前没有可以执行的待取消账号";
          accounts.append(empty);
        }
        const warning = el("xfc-confirm-warning");
        warning.classList.toggle("error", mismatch || !targets.length);
        warning.textContent = mismatch
          ? `账号不匹配：当前登录账号是 ${loggedAccountId}，取消队列属于 ${sourceUserId}。`
          : !targets.length
            ? "当前队列中没有可执行账号，请返回筛选页面检查并重新发送队列。"
            : loggedAccountId
              ? "取消关注会立即提交到 X，本工具不会自动恢复；请确认以上账号无误。"
              : "无法读取当前登录账号 ID。执行时仍会校验登录状态，请先确认队列属于当前账号。";
        el("xfc-confirm-submit").disabled = mismatch || !targets.length;
        dialog.returnValue = "";
        return new Promise((resolve) => {
          dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
          dialog.showModal();
          dialog.querySelector('button[value="cancel"]').focus();
        });
      };
      const hideSupportPrompt = () => {
        const prompt = el("xfc-support-prompt");
        if (prompt.open) prompt.close();
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
          const prompt = el("xfc-support-prompt");
          if (!prompt.open) prompt.showModal();
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
          `待处理队列 ${pending.length} 人 · 历史成功 ${success}` +
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
        const opening = help.hidden;
        help.hidden = !opening;
        el("xfc-help-toggle").setAttribute("aria-expanded", String(opening));
        if (opening) {
          requestAnimationFrame(() => {
            el("xfc-panel").scrollTo({ top: 0, behavior: "smooth" });
            help.focus({ preventScroll: true });
          });
        }
      };
      this.open = () => {
        el("xfc-panel").hidden = false;
        restoreState();
      };
      this.close = () => {
        el("xfc-panel").hidden = true;
      };
      const panel = el("xfc-panel");
      const logBox = el("xfc-log");
      logBox.addEventListener("wheel", (event) => {
        if (!event.deltaY || logBox.scrollHeight <= logBox.clientHeight) return;
        const atTop = logBox.scrollTop <= 0;
        const atBottom = Math.ceil(logBox.scrollTop + logBox.clientHeight) >= logBox.scrollHeight;
        const canScrollInside = (event.deltaY < 0 && !atTop) || (event.deltaY > 0 && !atBottom);
        if (!canScrollInside) return;
        const multiplier = event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? logBox.clientHeight
            : 1;
        event.preventDefault();
        event.stopPropagation();
        logBox.scrollTop += event.deltaY * multiplier;
      }, { passive: false });
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
      el("xfc-support-prompt-close").onclick = hideSupportPrompt;
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
        const size = Math.min(50, Math.max(1, Number(el("xfc-batch-size").value) || 10));
        const intervalSeconds = Math.max(1, Number(el("xfc-unfollow-delay").value) || 5);
        let queue;
        let sourceUserId;
        try {
          queue = await refreshQueue(false);
          sourceUserId = await app.getActiveSourceId();
        } catch (error) {
          log(error.message || String(error), "error", "Unfollow");
          return;
        }
        const targets = queue.filter((item) =>
          !["success", "executing", "needs_review"].includes(item.status)
        ).slice(0, size);
        const confirmed = await confirmUnfollowBatch({
          size,
          intervalSeconds,
          sourceUserId,
          loggedAccountId: app.getLoggedAccountId(),
          targets
        });
        if (!confirmed) return;
        setBusy("xfc-unfollow-start", true, "正在执行…", "执行这一批");
        try {
          await app.unfollow.start({
            batchSize: size,
            intervalMs: intervalSeconds * 1000
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
          setBusy("xfc-unfollow-start", false, "", "执行这一批");
          await restoreState();
        }
      };
      restoreState();
    }
  };
})(window.XFollowCleaner);

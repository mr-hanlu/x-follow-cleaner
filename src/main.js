(function (app) {
  if (location.hostname === "x.com") {
    app.panel.mount();
    GM_registerMenuCommand("打开关注清理助手", () => {
      app.panel.open();
    });
    GM_registerMenuCommand("导出当前 CSV", async () => {
      const dataset = await app.loadDataset();
      app.download("x_following_cleaner.csv", app.toCSV(dataset.accounts), "text/csv;charset=utf-8");
    });
  } else {
    app.bridge.install();
  }
})(window.XFollowCleaner);

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs")], {
  cwd: root,
  env: { ...process.env, DASHBOARD_URL: "https://clean.example.com/" },
  stdio: "inherit"
});
const bundle = fs.readFileSync(path.join(root, "dist", "x-follow-cleaner.user.js"), "utf8");
assert.match(bundle, /@match\s+https:\/\/clean\.example\.com\/\*/);
assert.match(bundle, /@icon\s+https:\/\/clean\.example\.com\/favicon\.svg/);
assert.match(bundle, /@updateURL\s+https:\/\/clean\.example\.com\/download\/x-follow-cleaner\.user\.js/);
assert.match(bundle, /anonymous:\s*true/);
assert.match(bundle, /id="xfc-probe-concurrency"/);
assert.match(bundle, /id="xfc-refresh-queue"/);
assert.match(bundle, /GM_addValueChangeListener/);
assert.doesNotMatch(bundle, /__DASHBOARD_MATCH__/);
assert.doesNotMatch(bundle, /__DASHBOARD_(URL|ICON)__/);
assert.doesNotMatch(bundle, /__USERSCRIPT_URL__/);

const core = fs.readFileSync(path.join(root, "src", "core.js"), "utf8");
const gmStorage = new Map();
const context = {
  window: { XFollowCleaner: {} },
  document: { cookie: "twid=u%3D12345" },
  EventTarget,
  Event,
  CustomEvent: class CustomEvent extends Event {
    constructor(name, options = {}) { super(name); this.detail = options.detail; }
  },
  URL,
  Blob,
  setTimeout,
  console,
  GM_getValue: (key, fallback) => gmStorage.has(key) ? gmStorage.get(key) : fallback,
  GM_setValue: (key, value) => gmStorage.set(key, value),
  GM_deleteValue: (key) => gmStorage.delete(key)
};
vm.runInNewContext(core, context);
const app = context.window.XFollowCleaner;
const knownTweetId = "1904571355950882816";
assert.ok(Number.isFinite(app.snowflakeDate(knownTweetId)?.getTime()));
assert.equal(app.inactiveDays("2999-01-01T00:00:00.000Z"), 0);
assert.match(app.toCSV([{ account_id: "1", screen_name: "a" }]), /account_id,screen_name/);
assert.equal(app.parseCSV("account_id,screen_name\n1,test\n")[0].screen_name, "test");
assert.equal(app.getLoggedAccountId(), "12345");
await app.saveDataset({
  ...app.emptyDataset("111"),
  accounts: [{ account_id: "1", screen_name: "first" }]
});
await app.saveDataset({
  ...app.emptyDataset("222"),
  accounts: [{ account_id: "2", screen_name: "second" }]
});
await app.setActiveSourceId("111");
assert.equal((await app.loadDataset()).accounts[0].screen_name, "first");
await app.setActiveSourceId("222");
assert.equal((await app.loadDataset()).accounts[0].screen_name, "second");
await app.saveUnfollowQueue([{ account_id: "2", status: "pending" }], "222");
assert.equal((await app.loadUnfollowQueue("222")).length, 1);
assert.equal((await app.loadUnfollowQueue("111")).length, 0);

const profileSource = fs.readFileSync(path.join(root, "src", "profile-probe.js"), "utf8");
const profileDataset = {
  accounts: Array.from({ length: 6 }, (_, index) => ({
    account_id: String(index + 1),
    screen_name: `user_${index + 1}`
  }))
};
let activeRequests = 0;
let maxActiveRequests = 0;
const profileApp = {
  loadDataset: async () => profileDataset,
  saveDataset: async () => profileDataset,
  upsertAccounts(dataset, incoming) {
    for (const row of incoming) {
      const index = dataset.accounts.findIndex((item) => item.account_id === row.account_id);
      dataset.accounts[index] = row;
    }
  },
  nowIso: () => "2026-07-31T00:00:00.000Z",
  sleep: async () => {},
  log: () => {},
  snowflakeDate: () => null,
  inactiveDays: () => null
};
const profileContext = {
  window: { XFollowCleaner: profileApp },
  URL,
  DOMParser: class {},
  setTimeout,
  GM_xmlhttpRequest(options) {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    setTimeout(() => {
      activeRequests -= 1;
      options.onload({ status: 404, responseText: "" });
    }, 5);
  }
};
vm.runInNewContext(profileSource, profileContext);
await profileApp.profileProbe.start(
  { concurrency: 3, intervalMs: 500, limit: 6 },
  () => {}
);
assert.equal(maxActiveRequests, 3);
assert.ok(profileDataset.accounts.every((account) => account.data_status === "http_404"));
console.log("All tests passed.");

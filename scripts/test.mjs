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
assert.match(bundle, /id="xfc-following-stop"/);
assert.match(bundle, /id="xfc-unfollow-stop"/);
assert.match(bundle, /id="xfc-auto-destroy"/);
assert.match(bundle, /id="xfc-probe-all"/);
assert.match(bundle, /syncProbeLimitLock/);
assert.match(bundle, /limit\.readOnly = locked/);
assert.match(bundle, /id="xfc-help-toggle"/);
assert.match(bundle, /❓ 帮助/);
assert.match(bundle, /怎么复制 Following cURL/);
assert.match(bundle, /@license\s+MIT/);
assert.match(bundle, /@name:en\s+X Following Cleaner/);
assert.match(bundle, /@version\s+0\.8\.0/);
assert.match(bundle, /overscroll-behavior:contain/);
assert.match(bundle, /passive:\s*false/);
assert.match(bundle, /清空当前账号数据/);
assert.doesNotMatch(bundle, /document\.documentElement\.style\.overflow/);
assert.match(bundle, /GM_addValueChangeListener/);
assert.doesNotMatch(bundle, /__DASHBOARD_MATCH__/);
assert.doesNotMatch(bundle, /__DASHBOARD_(URL|ICON)__/);
assert.doesNotMatch(bundle, /__USERSCRIPT_URL__/);
const dashboardSource = fs.readFileSync(path.join(root, "web", "dashboard.js"), "utf8");
const dashboardHtml = fs.readFileSync(path.join(root, "web", "index.html"), "utf8");
const dashboardStyles = fs.readFileSync(path.join(root, "web", "styles.css"), "utf8");
assert.match(dashboardHtml, /id="help-dialog"/);
assert.match(dashboardSource, /helpDialog\.showModal\(\)/);
assert.match(dashboardHtml, /id="help-toggle"[^>]*>❓ 帮助<\/button>/);
assert.match(dashboardSource, /document\.body\.classList\.add\("help-open"\)/);
assert.match(dashboardSource, /new ResizeObserver\(syncTopbarHeight\)/);
assert.match(dashboardStyles, /body\.help-open\{overflow:hidden\}/);
assert.match(dashboardStyles, /overscroll-behavior:contain/);
assert.match(dashboardStyles, /\.filters\{position:sticky;top:var\(--topbar-height,68px\)/);
assert.match(dashboardStyles, /@media\(max-width:1180px\)\{\.filters\{position:static\}/);
assert.match(dashboardSource, /queueMicrotask\(\(\) => requestDataset/);
assert.match(dashboardSource, /requestDataset\(\{ automatic: true, force: true \}\)/);
assert.match(dashboardSource, /filter\(\(account\) => state\.dirty\.has\(account\.account_id\)\)/);
assert.match(dashboardSource, /state\.dirty\.add\(account\.account_id\)/);
assert.match(dashboardSource, /button\.classList\.toggle\("active", active\)/);
assert.match(dashboardHtml, /id="page-jump"/);
assert.match(dashboardHtml, /id="probe-count"/);
assert.match(dashboardSource, /探测进度/);
assert.match(bundle, /profile_probe: dataset\.profile_probe \|\| null/);
assert.match(dashboardSource, /const jumpToPage = \(\) =>/);
assert.match(dashboardSource, /Math\.min\(pages, Math\.max\(1, target\)\)/);
assert.match(bundle, /probe-results:v1:/);
assert.match(bundle, /unfollow-history:v1:/);
assert.match(bundle, /pendingResults\.length >= 5/);

const core = fs.readFileSync(path.join(root, "src", "core.js"), "utf8");
const gmStorage = new Map();
const gmWrites = [];
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const context = {
  window: { XFollowCleaner: {} },
  document: { cookie: "twid=u%3D12345; ct0=test", documentElement: { lang: "zh-CN" } },
  location: { hostname: "x.com" },
  EventTarget,
  Event,
  CustomEvent: class CustomEvent extends Event {
    constructor(name, options = {}) { super(name); this.detail = options.detail; }
  },
  URL,
  URLSearchParams,
  Blob,
  setTimeout,
  clearTimeout,
  console,
  GM_getValue: (key, fallback) => clone(gmStorage.has(key) ? gmStorage.get(key) : fallback),
  GM_setValue: (key, value) => {
    gmWrites.push({ key, value: clone(value) });
    gmStorage.set(key, clone(value));
  },
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
await app.saveReviewChanges("222", [{ account_id: "2", review_status: "remove" }]);
await app.saveUnfollowQueue([{ account_id: "2", status: "pending" }], "222");
assert.equal((await app.loadUnfollowQueue("222")).length, 1);
assert.equal((await app.loadUnfollowQueue("111")).length, 0);

await app.saveDataset({
  ...app.emptyDataset("333"),
  accounts: [{ account_id: "30", screen_name: "race", review_status: "" }]
});
const staleProbeAccount = { ...(await app.loadDataset("333")).accounts[0] };
await app.saveReviewChanges("333", [{ account_id: "30", review_status: "remove" }]);
await app.saveUnfollowResults("333", [{
  account_id: "30",
  unfollow_status: "success",
  unfollowed_at: "2026-08-01T00:00:00.000Z",
  unfollow_http_status: 200
}]);
await app.saveProbeResults("333", [{
  ...staleProbeAccount,
  data_status: "ok",
  fetched_at: "2026-08-01T00:01:00.000Z",
  inactive_days: 10
}]);
const raceResult = (await app.loadDataset("333")).accounts[0];
assert.equal(raceResult.data_status, "ok");
assert.equal(raceResult.unfollow_status, "success");
assert.equal(raceResult.review_status, "done");

gmStorage.set(`${app.constants.DATASET_PREFIX}444`, {
  schema_version: "x-follow-cleaner-v1",
  source_user_id: "444",
  completed_following: true,
  profile_probe: { status: "paused", completed: 1 },
  accounts: [{
    account_id: "40", screen_name: "legacy", data_status: "ok",
    fetched_at: "2026-07-01T00:00:00.000Z", review_status: "keep"
  }]
});
const migrated = await app.loadDataset("444");
assert.equal(migrated.schema_version, "x-follow-cleaner-v3");
assert.equal(migrated.accounts[0].data_status, "ok");
assert.equal(migrated.accounts[0].review_status, "keep");
assert.ok(gmStorage.has(app.baseDatasetKey("444")));

const firstLease = await app.acquireTaskLease("444", "profile-probe", 5000);
assert.equal((await app.activeTaskLeases("444")).length, 1);
await assert.rejects(() => app.acquireTaskLease("444", "profile-probe", 5000), /另一个页面/);
await app.releaseTaskLease(firstLease);

const profileSource = fs.readFileSync(path.join(root, "src", "profile-probe.js"), "utf8");
const profileDataset = {
  accounts: Array.from({ length: 6 }, (_, index) => ({
    account_id: String(index + 1),
    screen_name: `user_${index + 1}`
  }))
};
let activeRequests = 0;
let maxActiveRequests = 0;
let profileWrites = 0;
const profileApp = {
  loadDataset: async () => profileDataset,
  saveProbeTask: async (_sourceUserId, task) => { profileDataset.profile_probe = task; },
  saveProbeResults: async (_sourceUserId, results, task) => {
    profileWrites += 1;
    for (const row of results) {
      const account = profileDataset.accounts.find((item) => item.account_id === row.account_id);
      Object.assign(account, row);
    }
    profileDataset.profile_probe = task;
  },
  acquireTaskLease: async () => ({ key: "lease", ownerId: "test", ttlMs: 90000 }),
  heartbeatTaskLease: async () => true,
  releaseTaskLease: async () => {},
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
  clearTimeout,
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
assert.equal(profileWrites, 2);

const unfollowSource = fs.readFileSync(path.join(root, "src", "unfollow.js"), "utf8");
context.fetch = async () => ({ status: 200, ok: true });
vm.runInNewContext(unfollowSource, context);
await app.saveDataset({
  ...app.emptyDataset("12345"),
  completed_following: true,
  accounts: [{ account_id: "50", screen_name: "integrated" }]
});
await app.saveReviewChanges("12345", [{ account_id: "50", review_status: "remove" }]);
await app.saveUnfollowQueue([{ account_id: "50", screen_name: "integrated", status: "pending" }], "12345");
gmWrites.length = 0;
await app.unfollow.start({ batchSize: 1, intervalMs: 1000 });
const integratedAccount = (await app.loadDataset("12345")).accounts[0];
assert.equal(integratedAccount.unfollow_status, "success");
assert.equal(integratedAccount.review_status, "done");
assert.equal((await app.loadUnfollowQueue("12345")).length, 0);
const successWrite = gmWrites.findIndex((entry) =>
  entry.key === app.unfollowHistoryKey("12345") &&
  entry.value.values?.["50"]?.unfollow_status === "success"
);
const queueRemovalWrite = gmWrites.findIndex((entry) =>
  entry.key === app.queueKey("12345") && Array.isArray(entry.value) && entry.value.length === 0
);
assert.ok(successWrite >= 0 && queueRemovalWrite > successWrite);
const interruptedDataset = await app.loadDataset("12345");
interruptedDataset.accounts.push({ account_id: "51", screen_name: "interrupted" });
await app.saveBaseDataset(interruptedDataset);
await app.saveReviewChanges("12345", [{ account_id: "51", review_status: "remove" }]);
await app.saveUnfollowResults("12345", [{
  account_id: "51",
  unfollow_status: "executing",
  unfollow_started_at: "2026-08-01T00:00:00.000Z"
}]);
await app.saveUnfollowQueue([{ account_id: "51", screen_name: "interrupted", status: "executing" }], "12345");
await assert.rejects(() => app.unfollow.start({ batchSize: 1 }), /待人工核验/);
assert.equal((await app.loadUnfollowHistory("12345"))["51"].unfollow_status, "needs_review");
assert.equal(await app.prepareUnfollowRetries("12345", [
  { account_id: "51", review_status: "remove" }
]), 1);
assert.equal((await app.loadUnfollowQueue("12345"))[0].status, "failed");

let savedAutomaticTemplate = null;
const unfollowApp = {
  nowIso: () => "2026-07-31T00:00:00.000Z",
  saveUnfollowTemplate: async (template) => { savedAutomaticTemplate = template; },
  parseCurl: () => { throw new Error("not used"); }
};
const unfollowContext = {
  window: { XFollowCleaner: unfollowApp },
  document: { documentElement: { lang: "zh-CN" } },
  URL,
  URLSearchParams
};
vm.runInNewContext(unfollowSource, unfollowContext);
const automaticTemplate = unfollowApp.unfollow.createAutomaticTemplate();
assert.equal(automaticTemplate.url, "https://x.com/i/api/1.1/friendships/destroy.json");
assert.equal(automaticTemplate.source, "automatic");
assert.equal(automaticTemplate.params.skip_status, "1");
assert.ok(automaticTemplate.headers.authorization.startsWith("Bearer "));
assert.ok(!("user_id" in automaticTemplate.params));
assert.ok(!("cookie" in automaticTemplate.headers));
assert.ok(!("x-csrf-token" in automaticTemplate.headers));
await unfollowApp.unfollow.saveAutomaticTemplate();
assert.equal(savedAutomaticTemplate.source, "automatic");

const queueDataset = {
  source_user_id: "123",
  accounts: [
    { account_id: "1", screen_name: "done", review_status: "remove", unfollow_status: "success", unfollowed_at: "2026-07-31T00:00:00Z" },
    { account_id: "2", screen_name: "retry", review_status: "remove" },
    { account_id: "3", screen_name: "new", review_status: "" }
  ]
};
let savedQueue = [];
const queueApp = {
  nowIso: () => "2026-07-31T00:00:00.000Z",
  parseCurl: () => { throw new Error("not used"); },
  loadDataset: async () => queueDataset,
  saveDataset: async () => queueDataset,
  loadUnfollowQueue: async () => [
    { account_id: "1", screen_name: "done", status: "success" },
    { account_id: "2", screen_name: "retry", status: "failed" }
  ],
  saveUnfollowQueue: async (queue) => { savedQueue = queue; }
};
const queueContext = {
  window: { XFollowCleaner: queueApp },
  document: { documentElement: { lang: "zh-CN" } },
  URL,
  URLSearchParams
};
vm.runInNewContext(unfollowSource, queueContext);
const queueResult = await queueApp.unfollow.queueAccounts(["1", "2", "3"]);
assert.deepEqual(Array.from(savedQueue, (item) => item.account_id), ["2", "3"]);
assert.equal(savedQueue[0].status, "failed");
assert.equal(savedQueue[1].status, "pending");
assert.equal(queueDataset.accounts[0].review_status, "remove");
assert.equal(queueResult.stats.ignored_processed, 1);
assert.equal(queueResult.stats.queued, 2);
console.log("All tests passed.");

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
assert.match(bundle, /anonymous:\s*true/);
assert.doesNotMatch(bundle, /__DASHBOARD_MATCH__/);

const core = fs.readFileSync(path.join(root, "src", "core.js"), "utf8");
const context = {
  window: { XFollowCleaner: {} },
  document: { cookie: "" },
  EventTarget,
  Event,
  CustomEvent: class CustomEvent extends Event {
    constructor(name, options = {}) { super(name); this.detail = options.detail; }
  },
  URL,
  Blob,
  setTimeout,
  GM_getValue: () => null,
  GM_setValue: () => null
};
vm.runInNewContext(core, context);
const app = context.window.XFollowCleaner;
const knownTweetId = "1904571355950882816";
assert.ok(Number.isFinite(app.snowflakeDate(knownTweetId)?.getTime()));
assert.equal(app.inactiveDays("2999-01-01T00:00:00.000Z"), 0);
assert.match(app.toCSV([{ account_id: "1", screen_name: "a" }]), /account_id,screen_name/);
assert.equal(app.parseCSV("account_id,screen_name\n1,test\n")[0].screen_name, "test");
console.log("All tests passed.");

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "src");
const output = path.join(root, "dist", "x-follow-cleaner.user.js");
const webOutput = path.join(root, "web", "download", "x-follow-cleaner.user.js");
const dashboardUrl = (process.env.DASHBOARD_URL || "http://localhost:8788/").trim();
const dashboard = new URL(dashboardUrl);
const dashboardMatch = `${dashboard.protocol}//${dashboard.hostname}/*`;

const modules = [
  "core.js",
  "curl.js",
  "following.js",
  "profile-probe.js",
  "unfollow.js",
  "bridge.js",
  "panel.js",
  "main.js"
];

const metadata = fs
  .readFileSync(path.join(sourceDir, "metadata.txt"), "utf8")
  .replace("__DASHBOARD_MATCH__", dashboardMatch);
const body = modules
  .map((name) => `\n/* ---- ${name} ---- */\n${fs.readFileSync(path.join(sourceDir, name), "utf8")}`)
  .join("\n");
const bundle = `${metadata}\n\n(function () {\n"use strict";\nwindow.XFollowCleaner = window.XFollowCleaner || {};\nwindow.XFollowCleaner.dashboardUrl = ${JSON.stringify(dashboard.toString())};\n${body}\n})();\n`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(webOutput), { recursive: true });
fs.writeFileSync(output, bundle);
fs.writeFileSync(webOutput, bundle);
console.log(`Built ${path.relative(root, output)}`);
console.log(`Dashboard match: ${dashboardMatch}`);

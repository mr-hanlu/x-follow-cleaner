import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "src");
const output = path.join(root, "dist", "x-follow-cleaner.user.js");
const webOutput = path.join(root, "web", "download", "x-follow-cleaner.user.js");
const dashboardUrl = (
  process.env.DASHBOARD_URL ||
  "https://x-follow-cleaner.mrhanlu224.workers.dev/"
).trim();
const dashboard = new URL(dashboardUrl);
const dashboardMatch = `${dashboard.protocol}//${dashboard.hostname}/*`;
const dashboardIcon = new URL("favicon.svg", dashboard).toString();
const userscriptUrl = new URL(
  "download/x-follow-cleaner.user.js",
  dashboard
).toString();
const sponsorUrl = new URL("sponsor/", dashboard).toString();

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
  .replaceAll("__DASHBOARD_MATCH__", dashboardMatch)
  .replaceAll("__DASHBOARD_URL__", dashboard.toString())
  .replaceAll("__DASHBOARD_ICON__", dashboardIcon)
  .replaceAll("__SPONSOR_URL__", sponsorUrl)
  .replaceAll("__USERSCRIPT_URL__", userscriptUrl);
const body = modules
  .map((name) => `\n/* ---- ${name} ---- */\n${fs.readFileSync(path.join(sourceDir, name), "utf8")}`)
  .join("\n");
const bundle = `${metadata}\n\n(function () {\n"use strict";\nwindow.XFollowCleaner = window.XFollowCleaner || {};\nwindow.XFollowCleaner.dashboardUrl = ${JSON.stringify(dashboard.toString())};\nwindow.XFollowCleaner.sponsorUrl = ${JSON.stringify(sponsorUrl)};\n${body}\n})();\n`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(webOutput), { recursive: true });
fs.writeFileSync(output, bundle);
fs.writeFileSync(webOutput, bundle);
console.log(`Built ${path.relative(root, output)}`);
console.log(`Dashboard match: ${dashboardMatch}`);
console.log(`Userscript URL: ${userscriptUrl}`);

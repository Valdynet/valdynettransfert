"use strict";
// Static security checks on the code base. Run: node --test tests/security.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const files = (dir, ext) => fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(ext)).map((f) => dir + "/" + f);
const sql = files("database/migrations", ".sql").sort().map(read).join("\n");
const clientFiles = [...files("assets/js", ".js"), ...["index.html", "track.html", "forgot-password.html"], ...files("customer", ".html"), ...files("admin", ".html")];

test("every table has Row Level Security enabled", () => {
  const tables = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 10);
  tables.forEach((t) => assert.match(sql, new RegExp("alter table public\\." + t + "\\s+enable row level security"), "RLS missing on " + t));
});
test("SECURITY DEFINER functions pin search_path and are service-role only (except helpers)", () => {
  const parts = sql.split(/\ncreate function /).slice(1);
  const granted = new Set(), revoked = new Set();
  for (const m of sql.matchAll(/grant execute on function([\s\S]*?)to service_role;/g)) for (const n of m[1].matchAll(/public\.(\w+)\(/g)) granted.add(n[1]);
  for (const m of sql.matchAll(/revoke all on function([\s\S]*?)from public, anon, authenticated;/g)) for (const n of m[1].matchAll(/public\.(\w+)\(/g)) revoked.add(n[1]);
  const helpers = ["is_admin", "my_customer_id", "handle_new_user", "notify_on_tx_log"];
  let definers = 0;
  for (const p of parts) {
    const header = p.split("$$")[0], name = p.match(/^public\.(\w+)/)[1];
    if (!/security definer/i.test(header)) continue;
    definers++;
    assert.match(header, /set search_path/i, name + " has no fixed search_path");
    if (!helpers.includes(name)) { assert.ok(granted.has(name), name + " not granted to service_role"); assert.ok(revoked.has(name), name + " still callable by anon/authenticated"); }
  }
  assert.ok(definers >= 10);
});
test("the browser never writes financial tables directly", () => {
  clientFiles.filter((f) => f.endsWith(".js")).forEach((f) => {
    const s = read(f);
    assert.doesNotMatch(s, /\.(insert|upsert|delete)\(/, f);
    s.split("\n").filter((l) => /\.update\(/.test(l)).forEach((l) => assert.match(l, /from\("profiles"\)/, f + ": " + l.trim()));
  });
});
test("no HTML injection sinks and no browser-stored secrets", () => {
  clientFiles.forEach((f) => assert.doesNotMatch(read(f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write\(|\beval\(/, f));
  clientFiles.filter((f) => f.endsWith(".js")).forEach((f) => read(f).split("\n").filter((l) => /localStorage/.test(l))
    .forEach((l) => assert.match(l, /vt_remember|sessionStorage : localStorage/, f + ": " + l.trim())));
});
test("secrets and service keys never appear in files served to the browser", () => {
  clientFiles.concat(files("assets/css", ".css")).forEach((f) => assert.doesNotMatch(read(f), /PAYPAL_CLIENT_SECRET|PAYPAL_WEBHOOK_ID|SERVICE_ROLE|EMAIL_API_KEY/, f));
});
test("security headers are configured without unsafe-inline / unsafe-eval", () => {
  const t = read("netlify.toml");
  assert.match(t, /Strict-Transport-Security/); assert.match(t, /X-Content-Type-Options = "nosniff"/); assert.match(t, /frame-ancestors 'none'/);
  assert.doesNotMatch(t, /unsafe-inline|unsafe-eval/);
});
test("every Netlify Function authenticates or is deliberately public, and bounds its input", () => {
  const publicFns = ["calculate", "config", "track", "paypal-webhook", "send-notifications"]; // webhook = PayPal signature; dispatch = rate limited
  files("netlify/functions", ".js").forEach((f) => {
    const name = path.basename(f, ".js"), s = read(f);
    if (!publicFns.includes(name)) assert.match(s, /userFrom|requireAdmin/, name + " has no authentication");
    if (!["config", "send-notifications"].includes(name)) assert.match(s, /PAYLOAD_TOO_LARGE|slice\(0, 500\)/, name + " does not bound its input");
  });
  assert.match(read("netlify/functions/paypal-webhook.js"), /verifyWebhook/);
});

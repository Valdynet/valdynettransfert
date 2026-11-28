#!/usr/bin/env node
// Post-deploy check of the live site. Usage: node scripts/smoke.js https://your-site.netlify.app
// Shows exactly which file is missing or served with the wrong type (the usual cause of an unstyled page).
const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) { console.error("Usage: node scripts/smoke.js https://your-site.netlify.app"); process.exit(2); }
let failed = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + extra)); if (!ok) failed++; };
const get = async (p, init) => { const r = await fetch(base + p, { redirect: "manual", ...init }); return { r, type: r.headers.get("content-type") || "", text: await r.text() }; };
const post = (p, b) => get(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

(async () => {
  const pages = [["/", "text/html"], ["/track.html", "text/html"], ["/customer/dashboard.html", "text/html"], ["/admin/dashboard.html", "text/html"],
    ["/assets/css/style.css", "text/css"], ["/assets/css/dashboard.css", "text/css"], ["/assets/js/app.js", "javascript"],
    ["/assets/js/auth.js", "javascript"], ["/assets/js/calculator.js", "javascript"], ["/assets/js/pay.js", "javascript"]];
  for (const [p, t] of pages) { const x = await get(p); check(`${p} served as ${t}`, x.r.status === 200 && x.type.includes(t), `HTTP ${x.r.status}, type "${x.type}"`); }
  const h = await get("/");
  check("security headers present (HSTS, CSP)", !!h.r.headers.get("strict-transport-security") && !!h.r.headers.get("content-security-policy"), "netlify.toml not deployed?");
  const c = await post("/api/calculate", { service: "deposit", method: "paypal", amount: 50 });
  let j = {}; try { j = JSON.parse(c.text); } catch {}
  check("/api/calculate: 50 USD deposit -> 7000 HTG, total 55", j.ok === true && j.convertedAmount === 7000 && j.totalAmount === 55, `HTTP ${c.r.status} ${c.text.slice(0, 100)}`);
  check("/api/track answers generically (404)", (await post("/api/track", { reference: "nope" })).r.status === 404, "HTTP status differs");
  const a = await post("/api/admin-payments", { action: "payments" });
  check("admin API refuses anonymous calls", [401, 403].includes(a.r.status), `HTTP ${a.r.status}`);
  check("/api/config exposes no secret", !/secret|service_role/i.test((await get("/api/config")).text));
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("Could not reach the site:", e.message); process.exit(2); });

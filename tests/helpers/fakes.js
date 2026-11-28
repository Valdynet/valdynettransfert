"use strict";
// In-memory stand-ins for the database client and the user session (no network).
const lib = (n) => require.resolve("../../netlify/functions/_lib/" + n);
const st = {};
const reply = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });
const inject = (name, exports) => { require.cache[lib(name)] = { id: lib(name), filename: lib(name), loaded: true, exports }; };
inject("common", { reply, log() {}, clientIp: () => "1.1.1.1", db: () => st.supa, userFrom: async () => st.user });

function fakeSupa({ tables = {}, rpc = {} } = {}) {
  const calls = [];
  const q = (t) => { const o = { select: () => o, eq: () => o, order: () => o, range: () => o,
    maybeSingle: async () => ({ data: tables[t] ?? null }), single: async () => ({ data: tables[t] ?? null }) }; return o; };
  return { calls, from: q, rpc: async (n, a) => { calls.push(["rpc", n, a]); const r = rpc[n]; return typeof r === "function" ? r(a) : r || { data: true, error: null }; } };
}
const call = (h, body) => h({ httpMethod: "POST", headers: {}, body: typeof body === "string" ? body : JSON.stringify(body) });
const rpcs = (name) => st.supa.calls.filter((c) => c[0] === "rpc" && c[1] === name);
const handler = (n) => require("../../netlify/functions/" + n).handler;
module.exports = { st, fakeSupa, call, rpcs, handler };


"use strict";
const { userFrom } = require("./common");

// Admin role is read from the database on every request (never from the browser or the token).
async function requireAdmin(event, supa) {
  const user = await userFrom(event);
  if (!user) return { code: 401, error: "UNAUTHENTICATED" };
  const { data } = await supa.from("profiles").select("role").eq("id", user.id).single();
  if (!data || data.role !== "admin") return { code: 403, error: "FORBIDDEN" };
  return { user };
}

module.exports = { requireAdmin };


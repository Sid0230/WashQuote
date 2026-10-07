import { db } from "hatchable";

export const access = "public";
export const methods = ["POST", "OPTIONS"];

const ALLOWED_ORIGINS = new Set(["https://washquote.swarivo.in","https://www.washquote.swarivo.in"]);

function secure(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "https://washquote.swarivo.in");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

export default async function (req, res) {
  const origin = String(req.headers?.origin || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ok:false,error:"Origin not allowed"});
  secure(res, origin);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ok:false,error:"Method not allowed"});
  const contentType = String(req.headers?.["content-type"] || "");
  if (!contentType.toLowerCase().includes("application/json")) return res.status(415).json({ok:false,error:"JSON required"});
  if (JSON.stringify(req.body || {}).length > 12000) return res.status(413).json({ok:false,error:"Request too large"});

  const email = String(req.body?.email || "").trim().toLowerCase();
  const need = String(req.body?.need || "pricing").trim().slice(0,40);
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ok:false,error:"Enter a valid email address."});
  if (email.length > 200) return res.status(400).json({ok:false,error:"Email is too long."});
  const allowed = new Set(["pricing","quotes","packages","targets","customers","repeat","pipeline","analytics"]);
  const selected = allowed.has(need) ? need : "pricing";
  await db.query("INSERT INTO pro_waitlist (email, primary_need) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET primary_need = EXCLUDED.primary_need", [email,selected]);
  return res.json({ok:true});
}
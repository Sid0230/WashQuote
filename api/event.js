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

  const allowed = new Set(["calculator_used","quote_generated","quote_saved","pro_interest","pro_page_viewed","purchase_intent","price_interest_19","pro_value_choice","pro_workspace_opened","pro_activated","service_saved","package_saved","template_saved","target_calculated","pro_quote_saved"]);
  const eventName = String(req.body?.event_name || "");
  const page = String(req.body?.page || "").slice(0,200);
  const sessionId = String(req.body?.session_id || "").slice(0,80);
  const source = String(req.body?.source || "").slice(0,80);
  const medium = String(req.body?.medium || "").slice(0,80);
  const campaign = String(req.body?.campaign || "").slice(0,120);
  const value = String(req.body?.value || "").slice(0,40);
  const eventPage = value && eventName === "pro_value_choice" ? (page + "?value=" + encodeURIComponent(value)).slice(0,200) : page;
  if (!allowed.has(eventName)) return res.status(400).json({ok:false,error:"Invalid event"});
  await db.query("INSERT INTO product_events (event_name, page, session_id, source, medium, campaign) VALUES ($1, $2, $3, $4, $5, $6)", [eventName,eventPage,sessionId||null,source||null,medium||null,campaign||null]);
  return res.json({ok:true});
}
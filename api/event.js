import { db } from "hatchable";

export const access = "public";
export const methods = ["POST", "OPTIONS"];

export default async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  const allowed = new Set([
    "calculator_used","quote_generated","quote_saved","pro_interest","pro_page_viewed","purchase_intent","price_interest_19","pro_value_choice",
    "pro_workspace_opened","pro_activated","service_saved","package_saved","template_saved",
    "target_calculated","pro_quote_saved"
  ]);
  const eventName = String(req.body?.event_name || "");
  const page = String(req.body?.page || "").slice(0,200);
  const sessionId = String(req.body?.session_id || "").slice(0,80);
  const source = String(req.body?.source || "").slice(0,80);
  const medium = String(req.body?.medium || "").slice(0,80);
  const campaign = String(req.body?.campaign || "").slice(0,120);
  const value = String(req.body?.value || "").slice(0,40);
  const eventPage = value && eventName === "pro_value_choice" ? `${page}?value=${encodeURIComponent(value)}`.slice(0,200) : page;
  if (!allowed.has(eventName)) return res.status(400).json({ok:false});
  await db.query(
    "INSERT INTO product_events (event_name, page, session_id, source, medium, campaign) VALUES ($1, $2, $3, $4, $5, $6)",
    [eventName, eventPage, sessionId || null, source || null, medium || null, campaign || null]
  );
  res.json({ok:true});
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json", ...cors}
  });
}

function clean(value, max=200) {
  return String(value ?? "").slice(0,max);
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS product_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL, page TEXT, session_id TEXT, source TEXT, medium TEXT, campaign TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_product_events_event ON product_events(event_name)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_product_events_session ON product_events(session_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pro_waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, primary_need TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
  ]);
}

const allowedEvents = new Set([
  "calculator_used","quote_generated","quote_saved","pro_interest","pro_page_viewed",
  "purchase_intent","price_interest_19","pro_value_choice","pro_workspace_opened",
  "pro_activated","service_saved","package_saved","template_saved","target_calculated",
  "pro_quote_saved"
]);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, {status:204, headers:cors});
    const url = new URL(request.url);
    if (url.pathname !== "/api/event" && url.pathname !== "/api/waitlist") return json({ok:false,error:"Not found"},404);
    if (request.method !== "POST") return json({ok:false,error:"Method not allowed"},405);

    await ensureSchema(env);
    let body;
    try { body = await request.json(); } catch { return json({ok:false,error:"Invalid JSON"},400); }

    if (url.pathname === "/api/event") {
      const eventName = clean(body.event_name,80);
      if (!allowedEvents.has(eventName)) return json({ok:false},400);
      await env.DB.prepare(
        "INSERT INTO product_events (event_name,page,session_id,source,medium,campaign) VALUES (?,?,?,?,?,?)"
      ).bind(
        eventName, clean(body.page), clean(body.session_id,80),
        clean(body.source,80), clean(body.medium,80), clean(body.campaign,120)
      ).run();
      return json({ok:true});
    }

    const email = clean(body.email,200).trim().toLowerCase();
    if (!/^\\S+@\\S+\\.\\S+$/.test(email)) return json({ok:false,error:"Enter a valid email address."},400);
    const allowedNeeds = new Set(["pricing","quotes","packages","targets","customers","repeat","pipeline","analytics"]);
    const need = allowedNeeds.has(String(body.need)) ? String(body.need) : "pricing";
    await env.DB.prepare(
      "INSERT INTO pro_waitlist (email,primary_need) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET primary_need=excluded.primary_need"
    ).bind(email,need).run();
    return json({ok:true});
  }
};
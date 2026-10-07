import { db } from "hatchable";

export const access = "admin";
export const methods = ["GET"];

export default async function (req, res) {
  const { rows: events } = await db.query("SELECT event_name, count(*)::int AS count FROM product_events GROUP BY event_name ORDER BY count DESC");
  const { rows: wait } = await db.query("SELECT count(*)::int AS count FROM pro_waitlist");
  const { rows: needs } = await db.query("SELECT primary_need, count(*)::int AS count FROM pro_waitlist GROUP BY primary_need ORDER BY count DESC");
  const { rows: unique } = await db.query("SELECT count(DISTINCT session_id)::int AS count FROM product_events WHERE session_id IS NOT NULL");
  const { rows: proSessions } = await db.query("SELECT count(DISTINCT session_id)::int AS count FROM product_events WHERE session_id IS NOT NULL AND event_name = 'pro_workspace_opened'");
  const { rows: activatedSessions } = await db.query("SELECT count(DISTINCT session_id)::int AS count FROM product_events WHERE session_id IS NOT NULL AND event_name = 'pro_activated'");
  const { rows: quoteSessions } = await db.query("SELECT count(DISTINCT session_id)::int AS count FROM product_events WHERE session_id IS NOT NULL AND event_name = 'pro_quote_saved'");
  const { rows: proPageSessions } = await db.query("SELECT count(DISTINCT session_id)::int AS count FROM product_events WHERE session_id IS NOT NULL AND event_name = 'pro_page_viewed'");
  const counts = Object.fromEntries(events.map(x => [x.event_name, x.count]));
  const opened = counts.pro_workspace_opened || 0;
  const activated = counts.pro_activated || 0;
  const quoteSaved = counts.pro_quote_saved || 0;
  const activationActions = (counts.service_saved || 0) + (counts.package_saved || 0) + (counts.template_saved || 0) + (counts.target_calculated || 0);
  const uniqueSessions = unique[0]?.count || 0;
  const uniqueProSessions = proSessions[0]?.count || 0;
  const uniqueProPageSessions = proPageSessions[0]?.count || 0;
  const uniqueActivatedSessions = activatedSessions[0]?.count || 0;
  const uniqueQuoteSessions = quoteSessions[0]?.count || 0;
  const { rows: priceInterest } = await db.query("SELECT count(DISTINCT session_id)::int AS count FROM product_events WHERE session_id IS NOT NULL AND event_name = 'price_interest_19'");
  const { rows: proInterestSessions } = await db.query("SELECT count(DISTINCT session_id)::int AS count FROM product_events WHERE session_id IS NOT NULL AND event_name = 'pro_interest'");
  const uniquePriceInterest = priceInterest[0]?.count || 0;
  const uniqueProInterest = proInterestSessions[0]?.count || 0;
  const { rows: valueChoices } = await db.query("SELECT COALESCE(NULLIF(split_part(page, '?value=', 2), ''), 'unknown') AS value, count(DISTINCT session_id)::int AS sessions FROM product_events WHERE event_name = 'pro_value_choice' AND session_id IS NOT NULL GROUP BY 1 ORDER BY sessions DESC");
  const { rows: valueToPrice } = await db.query("SELECT COALESCE(NULLIF(split_part(c.page, '?value=', 2), ''), 'unknown') AS value, count(DISTINCT c.session_id)::int AS chosen_sessions, count(DISTINCT p.session_id)::int AS price_sessions FROM product_events c LEFT JOIN product_events p ON p.session_id = c.session_id AND p.event_name = 'price_interest_19' WHERE c.event_name = 'pro_value_choice' AND c.session_id IS NOT NULL GROUP BY 1 ORDER BY chosen_sessions DESC");
  const { rows: sources } = await db.query("SELECT COALESCE(NULLIF(source,''),'direct') AS source, COALESCE(NULLIF(medium,''),'unknown') AS medium, count(DISTINCT session_id)::int AS sessions, count(DISTINCT CASE WHEN event_name = 'calculator_used' THEN session_id END)::int AS calculator_sessions, count(DISTINCT CASE WHEN event_name = 'pro_page_viewed' THEN session_id END)::int AS pro_page_sessions, count(DISTINCT CASE WHEN event_name = 'price_interest_19' THEN session_id END)::int AS price_interest_sessions FROM product_events WHERE session_id IS NOT NULL GROUP BY 1,2 ORDER BY sessions DESC");
  const acquisitionFunnel = sources.map(x => ({...x, calculator_to_pro_rate:x.calculator_sessions ? Math.round((x.pro_page_sessions / x.calculator_sessions) * 100) : 0, pro_to_price_interest_rate:x.pro_page_sessions ? Math.round((x.price_interest_sessions / x.pro_page_sessions) * 100) : 0}));
  res.json({
    events,
    unique_sessions: uniqueSessions,
    pro_waitlist: wait[0]?.count || 0,
    requested_features: needs,
    pro_page_sessions: uniqueProPageSessions,
    calculator_to_pro_rate: uniqueSessions ? Math.round((uniqueProPageSessions / uniqueSessions) * 100) : 0,
    pro_page_to_price_interest_rate: uniqueProPageSessions ? Math.round((uniquePriceInterest / uniqueProPageSessions) * 100) : 0,
    unique_pro_interest_sessions: uniqueProInterest,
    pro_page_to_interest_rate: uniqueProPageSessions ? Math.round((uniqueProInterest / uniqueProPageSessions) * 100) : 0,
    pro_value_demand: valueChoices,
    pro_value_to_price_interest: valueToPrice.map(x => ({value:x.value, chosen_sessions:x.chosen_sessions, price_interest_sessions:x.price_sessions, conversion_rate:x.chosen_sessions ? Math.round((x.price_sessions / x.chosen_sessions) * 100) : 0})),
    acquisition_sources: acquisitionFunnel,
    pro_funnel: {
      workspace_opened: opened,
      activated,
      activation_rate: opened ? Math.round((activated / opened) * 100) : 0,
      activation_actions: activationActions,
      quotes_saved: quoteSaved,
      workspace_to_quote_rate: opened ? Math.round((quoteSaved / opened) * 100) : 0,
      unique_workspace_sessions: uniqueProSessions,
      unique_activated_sessions: uniqueActivatedSessions,
      unique_quote_sessions: uniqueQuoteSessions,
      unique_workspace_to_activation_rate: uniqueProSessions ? Math.round((uniqueActivatedSessions / uniqueProSessions) * 100) : 0,
      unique_workspace_to_quote_rate: uniqueProSessions ? Math.round((uniqueQuoteSessions / uniqueProSessions) * 100) : 0,
      unique_price_interest_19_sessions: uniquePriceInterest,
      unique_workspace_to_price_interest_rate: uniqueProSessions ? Math.round((uniquePriceInterest / uniqueProSessions) * 100) : 0
    }
  });
}
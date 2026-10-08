const ALLOWED_ORIGINS = new Set(["https://washquote.swarivo.in","https://www.washquote.swarivo.in"]);
const SUPABASE_URL = "https://espxcjuruenfjnniqada.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JzPWuS2VSucOsw5OwgI11Q_ffgC1yF4";
const STARTER_PRICES = { month: "price_1UOF7MHO7zYntAPdyjdYNti0", year: "price_1UOF7OHO7zYntAPd3lU0jxNq" };
const ACTIVE_STATUSES = new Set(["active","trialing"]);


function headers(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://washquote.swarivo.in",
    "Vary":"Origin",
    "Access-Control-Allow-Headers":"Content-Type, Authorization, Stripe-Signature",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "X-Content-Type-Options":"nosniff",
    "Referrer-Policy":"no-referrer",
    "Cache-Control":"no-store"
  };
}
function json(data,status=200,origin="") {
  return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json",...headers(origin)}});
}
function clean(value,max=200){return String(value ?? "").slice(0,max);}

async function hash(value){
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function requireUser(request){
  const h=request.headers.get("Authorization")||"";
  if(!h.startsWith("Bearer "))return null;
  const token=h.slice(7).trim();
  const r=await fetch(SUPABASE_URL+"/auth/v1/user",{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+token}});
  if(!r.ok)return null;
  const user=await r.json();
  return user?.id?user:null;
}
function formEncode(entries){const p=new URLSearchParams();for(const [k,v] of entries){if(v!==undefined&&v!==null)p.append(k,String(v));}return p.toString();}
async function stripeJson(env,path,params,method="POST"){
  if(!env.STRIPE_SECRET_KEY)throw new Error("Stripe is not configured on the API yet.");
  const r=await fetch("https://api.stripe.com"+path,{method,headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},body:method==="GET"?undefined:formEncode(params)});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={error:{message:"Invalid Stripe response"}}}
  if(!r.ok)throw new Error(data?.error?.message||"Stripe request failed");return data;
}
function safeEqual(a,b){if(a.length!==b.length)return false;let out=0;for(let i=0;i<a.length;i++)out|=a.charCodeAt(i)^b.charCodeAt(i);return out===0;}
function hex(bytes){return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");}
async function verifyStripeSignature(payload,signature,secret){
  if(!signature||!secret)return false;
  const parts=signature.split(","),timestamp=parts.find(x=>x.startsWith("t="))?.slice(2),signatures=parts.filter(x=>x.startsWith("v1=")).map(x=>x.slice(3));
  if(!timestamp||!/^d+$/.test(timestamp)||!signatures.length||Math.abs(Date.now()/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const mac=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+"."+payload));
  const expected=hex(mac);return signatures.some(sig=>safeEqual(sig,expected));
}
async function upsertSubscription(env,s){
  const userId=String(s.metadata?.user_id||"").slice(0,100);if(!userId)return;
  await env.DB.prepare("INSERT INTO subscriptions (user_id,stripe_customer_id,stripe_subscription_id,plan,price_id,status,current_period_end,cancel_at_period_end,updated_at) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,stripe_subscription_id=excluded.stripe_subscription_id,plan=excluded.plan,price_id=excluded.price_id,status=excluded.status,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,updated_at=CURRENT_TIMESTAMP").bind(userId,s.customer||null,s.id,String(s.metadata?.plan||"starter").slice(0,40),s.items?.data?.[0]?.price?.id||"",s.status||"unknown",s.current_period_end||null,s.cancel_at_period_end?1:0).run();
}
async function handleStripeEvent(env,event){
  const o=event.data?.object||{};
  if(event.type==="checkout.session.completed"){
    const userId=String(o.metadata?.user_id||o.client_reference_id||"").slice(0,100),subId=o.subscription;if(!userId||!subId)return;
    const sub=await stripeJson(env,"/v1/subscriptions/"+encodeURIComponent(subId),null,"GET");
    sub.metadata={...(sub.metadata||{}),user_id:userId,plan:String(o.metadata?.plan||"starter").slice(0,40)};await upsertSubscription(env,sub);
  }else if(["customer.subscription.created","customer.subscription.updated","customer.subscription.deleted"].includes(event.type)){await upsertSubscription(env,o)}
  else if(event.type==="invoice.paid"){const subId=typeof o.subscription==="string"?o.subscription:o.subscription?.id;if(subId){const sub=await stripeJson(env,"/v1/subscriptions/"+encodeURIComponent(subId),null,"GET");await upsertSubscription(env,sub)}}
  else if(event.type==="invoice.payment_failed"){const subId=typeof o.subscription==="string"?o.subscription:o.subscription?.id;if(subId){await env.DB.prepare("UPDATE subscriptions SET status='past_due',updated_at=CURRENT_TIMESTAMP WHERE stripe_subscription_id=?").bind(subId).run()}}
}

async function ensureSchema(env){
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS product_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_name TEXT NOT NULL, page TEXT, session_id TEXT, source TEXT, medium TEXT, campaign TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_product_events_event ON product_events(event_name)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_product_events_session ON product_events(session_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS pro_waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, primary_need TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS api_rate_limits (bucket_key TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS subscriptions (user_id TEXT PRIMARY KEY, stripe_customer_id TEXT, stripe_subscription_id TEXT UNIQUE, plan TEXT NOT NULL, price_id TEXT NOT NULL, status TEXT NOT NULL, current_period_end INTEGER, cancel_at_period_end INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id)")
  ]);
}

async function rateLimit(env,request,route,limit,windowSeconds){
  const ip=request.headers.get("CF-Connecting-IP") || "unknown";
  const now=Math.floor(Date.now()/1000);
  const bucket=Math.floor(now/windowSeconds);
  const key=await hash(route+"|"+ip+"|"+bucket);
  const row=await env.DB.prepare("SELECT hits,expires_at FROM api_rate_limits WHERE bucket_key=?").bind(key).first();
  if(row && Number(row.hits)>=limit) return false;
  if(row){
    await env.DB.prepare("UPDATE api_rate_limits SET hits=hits+1 WHERE bucket_key=?").bind(key).run();
  }else{
    await env.DB.prepare("INSERT INTO api_rate_limits (bucket_key,hits,expires_at) VALUES (?,?,?)").bind(key,1,(bucket+1)*windowSeconds).run();
  }
  if(bucket % 20 === 0) await env.DB.prepare("DELETE FROM api_rate_limits WHERE expires_at < ?").bind(now).run();
  return true;
}


// --- Stripe subscription entitlement layer ---
const STRIPE_API="https://api.stripe.com/v1";
const STARTER_PRICES={
  month:"price_1UOF7MHO7zYntAPdyjdYNti0",
  year:"price_1UOF7OHO7zYntAPd3lU0jxNq"
};

function bearer(request){
  const h=request.headers.get("Authorization")||"";
  return h.startsWith("Bearer ")?h.slice(7):"";
}
async function supabaseUser(env,token){
  if(!token) return null;
  const r=await fetch(env.SUPABASE_URL+"/auth/v1/user",{
    headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+token}
  });
  if(!r.ok) return null;
  return await r.json();
}
async function stripeRequest(env,path,params){
  const body=new URLSearchParams();
  for(const [k,v] of Object.entries(params||{})) body.set(k,String(v));
  const r=await fetch(STRIPE_API+path,{
    method:"POST",
    headers:{Authorization:"Bearer "+env.STRIPE_SECRET_KEY,"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data?.error?.message||"Stripe request failed");
  return data;
}
async function getEntitlement(env,userId){
  return await env.DB.prepare("SELECT starter_active,subscription_id FROM entitlements WHERE user_id=?").bind(userId).first();
}
async function setEntitlement(env,userId,active,subscriptionId="",customerId=""){
  await env.DB.prepare(
    "INSERT INTO entitlements (user_id,starter_active,subscription_id,stripe_customer_id,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET starter_active=excluded.starter_active,subscription_id=excluded.subscription_id,stripe_customer_id=excluded.stripe_customer_id,updated_at=CURRENT_TIMESTAMP"
  ).bind(userId,active?1:0,subscriptionId,customerId).run();
}
function timingSafeEqual(a,b){
  if(a.length!==b.length) return false;
  let x=0; for(let i=0;i<a.length;i++) x|=a.charCodeAt(i)^b.charCodeAt(i);
  return x===0;
}
function hex(bytes){return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("")}
async function verifyStripeSignature(payload,header,secret){
  const parts=Object.fromEntries(header.split(",").map(x=>x.split("=")));
  const ts=parts.t, sig=parts.v1;
  if(!ts||!sig) return false;
  if(Math.abs(Math.floor(Date.now()/1000)-Number(ts))>300) return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const mac=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(ts+"."+payload));
  return timingSafeEqual(hex(mac),sig);
}

const allowedEvents=new Set(["calculator_used","quote_generated","quote_saved","pro_interest","pro_page_viewed","purchase_intent","price_interest_19","pro_value_choice","pro_workspace_opened","pro_activated","service_saved","package_saved","template_saved","target_calculated","pro_quote_saved"]);

export default {async fetch(request,env){
  const origin=request.headers.get("Origin")||"";
  const url=new URL(request.url);
  if(url.pathname!=="/api/stripe/webhook" && !ALLOWED_ORIGINS.has(origin)) return json({ok:false,error:"Origin not allowed"},403,origin);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:headers(origin)});
  if(url.pathname==="/api/stripe/webhook"){
    if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405,origin);
    const raw=await request.text();
    if(!env.STRIPE_WEBHOOK_SECRET || !(await verifyStripeSignature(raw,request.headers.get("Stripe-Signature")||"",env.STRIPE_WEBHOOK_SECRET)))return json({ok:false,error:"Invalid signature"},400,origin);
    try{await ensureSchema(env);await handleStripeEvent(env,JSON.parse(raw));return json({received:true},200,origin)}catch(e){return json({ok:false,error:"Webhook processing failed"},500,origin)}
  }
  if(url.pathname==="/api/entitlement"){
    if(request.method!=="GET")return json({ok:false,error:"Method not allowed"},405,origin);
    const user=await requireUser(request);if(!user)return json({ok:false,error:"Unauthorized"},401,origin);
    await ensureSchema(env);const row=await env.DB.prepare("SELECT plan,status,current_period_end,cancel_at_period_end FROM subscriptions WHERE user_id=?").bind(user.id).first();
    return json({ok:true,starterActive:Boolean(row&&ACTIVE_STATUSES.has(row.status)),plan:row?.plan||null,status:row?.status||null,current_period_end:row?.current_period_end||null,cancel_at_period_end:Boolean(row?.cancel_at_period_end)},200,origin);
  }
  if(url.pathname==="/api/create-checkout"){
    if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405,origin);
    if(!(await rateLimit(env,request,"checkout",10,3600)))return json({ok:false,error:"Too many checkout attempts. Try again later."},429,origin);
    const user=await requireUser(request);if(!user)return json({ok:false,error:"Sign in before starting checkout."},401,origin);
    let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400,origin)}
    const interval=body?.interval==="year"?"year":"month";
    try{
      const session=await stripeJson(env,"/v1/checkout/sessions",[["mode","subscription"],["line_items[0][price]",STARTER_PRICES[interval]],["line_items[0][quantity]","1"],["success_url","https://washquote.swarivo.in/?checkout=success"],["cancel_url","https://washquote.swarivo.in/?checkout=cancel"],["customer_email",user.email||""],["client_reference_id",user.id],["metadata[user_id]",user.id],["metadata[plan]","starter"],["subscription_data[metadata][user_id]",user.id],["subscription_data[metadata][plan]","starter"]]);
      return json({ok:true,url:session.url},200,origin);
    }catch(e){return json({ok:false,error:e.message||"Could not start checkout."},502,origin)}
  }
  if(url.pathname!=="/api/event" && url.pathname!=="/api/waitlist" && url.pathname!=="/api/entitlement" && url.pathname!=="/api/create-checkout" && url.pathname!=="/api/stripe-webhook") return json({ok:false,error:"Not found"},404,origin);
  if(url.pathname==="/api/stripe-webhook"){
  if(request.method!=="POST") return json({ok:false,error:"Method not allowed"},405,origin);
  const raw=await request.text();
  const sig=request.headers.get("Stripe-Signature")||"";
  if(!await verifyStripeSignature(raw,sig,env.STRIPE_WEBHOOK_SECRET)) return json({ok:false,error:"Invalid webhook signature"},400,origin);
  const event=JSON.parse(raw);
  const obj=event.data?.object||{};
  if(event.type==="checkout.session.completed"){
    const uid=obj.metadata?.supabase_user_id;
    if(uid && obj.mode==="subscription"){
      await setEntitlement(env,uid,true,obj.subscription||"",obj.customer||"");
    }
  }else if(event.type==="customer.subscription.deleted" || event.type==="customer.subscription.paused"){
    const uid=obj.metadata?.supabase_user_id;
    if(uid) await setEntitlement(env,uid,false,obj.id,obj.customer||"");
  }else if(event.type==="customer.subscription.updated"){
    const uid=obj.metadata?.supabase_user_id;
    if(uid){
      const active=["active","trialing"].includes(obj.status) && obj.cancel_at_period_end!==true;
      await setEntitlement(env,uid,active,obj.id,obj.customer||"");
    }
  }else if(event.type==="invoice.payment_failed"){
    const uid=obj.subscription_details?.metadata?.supabase_user_id || obj.metadata?.supabase_user_id;
    if(uid) await setEntitlement(env,uid,false,obj.subscription||"",obj.customer||"");
  }
  return json({received:true},200,origin);
}
if(request.method!=="POST" && url.pathname!=="/api/entitlement") return json({ok:false,error:"Method not allowed"},405,origin);
if(url.pathname==="/api/entitlement"){
  const user=await supabaseUser(env,bearer(request));
  if(!user?.id) return json({ok:false,error:"Unauthorized"},401,origin);
  const row=await getEntitlement(env,user.id);
  return json({starterActive:Boolean(row?.starter_active),subscriptionId:row?.subscription_id||null},200,origin);
}
if(url.pathname==="/api/create-checkout"){
  if(!(await rateLimit(env,request,"checkout",10,3600))) return json({ok:false,error:"Too many checkout attempts. Try again later."},429,origin);
  const user=await supabaseUser(env,bearer(request));
  if(!user?.id) return json({ok:false,error:"Unauthorized"},401,origin);
  const existing=await getEntitlement(env,user.id);
  if(existing?.starter_active) return json({ok:false,error:"Starter is already active."},409,origin);
  let body; try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400,origin);}
  const interval=body.interval==="year"?"year":"month";
  const price=STARTER_PRICES[interval];
  try{
    const session=await stripeRequest(env,"/checkout/sessions",{
      mode:"subscription",
      "line_items[0][price]":price,
      "line_items[0][quantity]":"1",
      success_url:"https://washquote.swarivo.in/?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url:"https://washquote.swarivo.in/?checkout=cancel",
      "customer_email":user.email||"",
      "metadata[supabase_user_id]":user.id,
      "metadata[plan]":"starter",
      "subscription_data[metadata][supabase_user_id]":user.id,
      "subscription_data[metadata][plan]":"starter"
    });
    return json({ok:true,url:session.url},200,origin);
  }catch(e){return json({ok:false,error:e.message||"Could not create checkout"},500,origin);}
}

  const contentType=request.headers.get("content-type")||"";
  if(!contentType.toLowerCase().includes("application/json")) return json({ok:false,error:"JSON required"},415,origin);
  const length=Number(request.headers.get("content-length")||"0");
  if(length>12000) return json({ok:false,error:"Request too large"},413,origin);
  await ensureSchema(env);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS entitlements (user_id TEXT PRIMARY KEY, starter_active INTEGER NOT NULL DEFAULT 0, subscription_id TEXT, stripe_customer_id TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();

  if(url.pathname==="/api/event" && !(await rateLimit(env,request,"event",120,60))) return json({ok:false,error:"Rate limit exceeded. Try again shortly."},429,origin);
  if(url.pathname==="/api/waitlist" && !(await rateLimit(env,request,"waitlist",5,3600))) return json({ok:false,error:"Too many requests. Try again later."},429,origin);

  let body; try{body=await request.json();}catch{return json({ok:false,error:"Invalid JSON"},400,origin);}
  if(url.pathname==="/api/event"){
    const eventName=clean(body.event_name,80);
    if(!allowedEvents.has(eventName)) return json({ok:false,error:"Invalid event"},400,origin);
    await env.DB.prepare("INSERT INTO product_events (event_name,page,session_id,source,medium,campaign) VALUES (?,?,?,?,?,?)").bind(eventName,clean(body.page),clean(body.session_id,80),clean(body.source,80),clean(body.medium,80),clean(body.campaign,120)).run();
    return json({ok:true},200,origin);
  }
  const email=clean(body.email,200).trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(email)) return json({ok:false,error:"Enter a valid email address."},400,origin);
  const allowedNeeds=new Set(["pricing","quotes","packages","targets","customers","repeat","pipeline","analytics"]);
  const need=allowedNeeds.has(String(body.need))?String(body.need):"pricing";
  await env.DB.prepare("INSERT INTO pro_waitlist (email,primary_need) VALUES (?,?) ON CONFLICT(email) DO UPDATE SET primary_need=excluded.primary_need").bind(email,need).run();
  return json({ok:true},200,origin);
}};
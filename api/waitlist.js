import { db } from "hatchable";

export const access = "public";
export const methods = ["POST", "OPTIONS"];

export default async function (req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const need = String(req.body?.need || "pricing").trim().slice(0,40);
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ ok:false, error:"Enter a valid email address." });
  const allowed = new Set(["pricing","quotes","packages","targets"]);
  const selected = allowed.has(need) ? need : "pricing";
  await db.query("INSERT INTO pro_waitlist (email, primary_need) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET primary_need = EXCLUDED.primary_need", [email, selected]);
  res.json({ ok:true });
}
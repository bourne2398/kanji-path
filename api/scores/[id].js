import { neon } from "@neondatabase/serverless";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const expected = process.env.ADMIN_TOKEN || process.env.ADMIN_PASSWORD;
    if (!expected || token !== expected) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const id = parseInt(req.query.id, 10);
    if (!id) return res.status(400).json({ error: "invalid id" });

    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`DELETE FROM scores WHERE id = ${id} RETURNING id`;
    if (!result.length) return res.status(404).json({ error: "not found" });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

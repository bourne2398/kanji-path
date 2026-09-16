export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const password = body.password || "";
    const adminPassword = process.env.ADMIN_PASSWORD || "";
    if (!adminPassword) {
      return res.status(500).json({ error: "ADMIN_PASSWORD not configured" });
    }
    // timing-safe-ish compare
    if (password.length === adminPassword.length && password === adminPassword) {
      // Return the same secret as Bearer token for delete calls
      const token = process.env.ADMIN_TOKEN || adminPassword;
      return res.status(200).json({ ok: true, token });
    }
    return res.status(401).json({ error: "Invalid password" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

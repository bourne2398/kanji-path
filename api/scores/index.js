import { neon } from "@neondatabase/serverless";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

function rowToScore(r) {
  return {
    id: r.id,
    nick: r.nick,
    when: Number(r.when_ts),
    right: r.right_count,
    wrong: r.wrong_count,
    total: r.total,
    pct: r.pct,
    grade: r.grade || "F",
    attempts: r.attempts || 1,
    completed: r.completed !== false,
    durationMs: Number(r.duration_ms || 0),
    lessons: r.lessons || "",
    dir: r.dir || "jp-en",
    timer: r.timer ?? 5,
    mistakes: r.mistakes_json || [],
    corrects: r.corrects_json || [],
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const sql = getSql();

    if (req.method === "GET") {
      const limit = Math.min(parseInt(req.query.limit || "100", 10) || 100, 200);
      const nick = (req.query.nick || "").trim();
      let rows;
      if (nick) {
        rows = await sql`
          SELECT * FROM scores
          WHERE lower(nick) = lower(${nick})
          ORDER BY when_ts DESC
          LIMIT ${limit}
        `;
      } else {
        rows = await sql`
          SELECT * FROM scores
          ORDER BY when_ts DESC
          LIMIT ${limit}
        `;
      }
      return res.status(200).json(rows.map(rowToScore));
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const nick = String(body.nick || "").trim();
      if (nick.length < 3 || nick.length > 12) return res.status(400).json({ error: "nickname must be 3-12 characters" });

      const right = parseInt(body.right || 0, 10) || 0;
      const wrong = parseInt(body.wrong || 0, 10) || 0;
      const total = parseInt(body.total || right + wrong, 10) || 0;
      const pct =
        body.pct != null
          ? parseInt(body.pct, 10) || 0
          : total
            ? Math.round((right / total) * 100)
            : 0;
      const grade = String(body.grade || "F").toUpperCase().slice(0, 1);
      if (!new Set(["A", "B", "C", "D", "F"]).has(grade)) return res.status(400).json({ error: "invalid grade" });
      const attempts = Math.max(1, parseInt(body.attempts || 1, 10) || 1);
      const completed = body.completed !== false;
      const duration_ms = Math.max(0, parseInt(body.durationMs || 0, 10) || 0);
      const when_ts = Number(body.when) || Date.now();
      const lessons = String(body.lessons || "").slice(0, 200);
      const dir = String(body.dir || "jp-en").slice(0, 16);
      const timer = body.timer != null ? parseInt(body.timer, 10) : 5;
      const mistakes = Array.isArray(body.mistakes) ? body.mistakes.slice(0, 200) : [];
      const corrects = Array.isArray(body.corrects) ? body.corrects.slice(0, 200) : [];

      const inserted = await sql`
        INSERT INTO scores (
          nick, when_ts, right_count, wrong_count, total, pct, grade, attempts, completed, duration_ms,
          lessons, dir, timer, mistakes_json, corrects_json
        ) VALUES (
          ${nick}, ${when_ts}, ${right}, ${wrong}, ${total}, ${pct}, ${grade}, ${attempts}, ${completed}, ${duration_ms},
          ${lessons}, ${dir}, ${timer},
          ${JSON.stringify(mistakes)}::jsonb,
          ${JSON.stringify(corrects)}::jsonb
        )
        RETURNING id
      `;
      return res.status(201).json({ ok: true, id: inserted[0].id });
    }

    if (req.method === "DELETE") {
      // Clear all — admin only
      const auth = req.headers.authorization || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      const expected = process.env.ADMIN_TOKEN || process.env.ADMIN_PASSWORD;
      if (!expected || token !== expected) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      await sql`DELETE FROM scores`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}


// Review history fields:
// reason: "Player quit the game" when an incomplete review is stopped.
// score_percentage: actual performance percentage, never forced to 100.
// completed: false when the player quits.

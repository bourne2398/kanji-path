#!/usr/bin/env python3
"""
Japanese Flashcards — history API + static server
Run:  python3 server.py
Open: http://127.0.0.1:5050/
Admin: http://127.0.0.1:5050/admin
"""
import os
import sqlite3
import hashlib
import secrets
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, g

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "data", "history.db")
# Change this password for production
ADMIN_PASSWORD = os.environ.get("JP_FLASH_ADMIN_PASSWORD", "admin123")
# Simple token store (in-memory; resets on restart)
ADMIN_TOKENS = set()

app = Flask(__name__, static_folder=os.path.join(BASE, "public"), static_url_path="")

def get_db():
    if "db" not in g:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db

@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
    CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nick TEXT NOT NULL,
        when_ts INTEGER NOT NULL,
        right_count INTEGER NOT NULL DEFAULT 0,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        total INTEGER NOT NULL DEFAULT 0,
        pct INTEGER NOT NULL DEFAULT 0,
        grade TEXT NOT NULL DEFAULT 'F',
        attempts INTEGER NOT NULL DEFAULT 1,
        completed INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        lessons TEXT,
        dir TEXT,
        timer INTEGER DEFAULT 5,
        mistakes_json TEXT,
        corrects_json TEXT,
        created_at TEXT
    )
    """)
    # Lightweight migration for existing SQLite databases.
    existing={row[1] for row in conn.execute("PRAGMA table_info(scores)").fetchall()}
    migrations={
        "grade":"ALTER TABLE scores ADD COLUMN grade TEXT NOT NULL DEFAULT 'F'",
        "attempts":"ALTER TABLE scores ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1",
        "completed":"ALTER TABLE scores ADD COLUMN completed INTEGER NOT NULL DEFAULT 1",
        "duration_ms":"ALTER TABLE scores ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0",
    }
    for name,sql in migrations.items():
        if name not in existing:
            conn.execute(sql)
    conn.execute("CREATE INDEX IF NOT EXISTS scores_grade_idx ON scores (grade)")
    conn.commit()
    conn.close()

def row_to_dict(r):
    import json
    mistakes = []
    corrects = []
    try:
        mistakes = json.loads(r["mistakes_json"] or "[]")
    except Exception:
        pass
    try:
        corrects = json.loads(r["corrects_json"] or "[]")
    except Exception:
        pass
    return {
        "id": r["id"],
        "nick": r["nick"],
        "when": r["when_ts"],
        "right": r["right_count"],
        "wrong": r["wrong_count"],
        "total": r["total"],
        "pct": r["pct"],
        "grade": r["grade"] if "grade" in r.keys() else "F",
        "attempts": r["attempts"] if "attempts" in r.keys() else 1,
        "completed": bool(r["completed"]) if "completed" in r.keys() else True,
        "durationMs": r["duration_ms"] if "duration_ms" in r.keys() else 0,
        "lessons": r["lessons"] or "",
        "dir": r["dir"] or "jp-en",
        "timer": r["timer"] if r["timer"] is not None else 5,
        "mistakes": mistakes,
        "corrects": corrects,
    }

def require_admin(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = auth.replace("Bearer ", "").strip() if auth.startswith("Bearer ") else ""
        if not token or token not in ADMIN_TOKENS:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapped

@app.route("/")
def index():
    return send_from_directory(os.path.join(BASE, "public"), "index.html")

@app.route("/admin")
@app.route("/admin.html")
def admin_page():
    return send_from_directory(BASE, "admin.html")

@app.route("/api/health")
def health():
    return jsonify({"ok": True})

@app.route("/api/scores", methods=["GET"])
def list_scores():
    """Public: anyone can view history."""
    limit = min(int(request.args.get("limit", 100)), 200)
    nick = (request.args.get("nick") or "").strip()
    db = get_db()
    if nick:
        rows = db.execute(
            "SELECT * FROM scores WHERE lower(nick)=lower(?) ORDER BY when_ts DESC LIMIT ?",
            (nick, limit),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM scores ORDER BY when_ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])

@app.route("/api/scores", methods=["POST"])
def add_score():
    """Public: submit a finished game."""
    import json
    data = request.get_json(silent=True) or {}
    nick = (data.get("nick") or "").strip()
    if len(nick) < 3 or len(nick) > 12:
        return jsonify({"error": "nickname must be 3-12 characters"}), 400
    right = int(data.get("right") or 0)
    wrong = int(data.get("wrong") or 0)
    total = int(data.get("total") or (right + wrong))
    pct = int(data.get("pct") if data.get("pct") is not None else (round(right / total * 100) if total else 0))
    grade = str(data.get("grade") or "F").upper()[:1]
    if grade not in {"A","B","C","D","F"}:
        return jsonify({"error": "invalid grade"}), 400
    attempts = max(1, int(data.get("attempts") or 1))
    completed = bool(data.get("completed", True))
    duration_ms = max(0, int(data.get("durationMs") or 0))
    when_ts = int(data.get("when") or int(datetime.now(timezone.utc).timestamp() * 1000))
    lessons = str(data.get("lessons") or "")[:200]
    direction = str(data.get("dir") or "jp-en")[:16]
    timer = int(data.get("timer") if data.get("timer") is not None else 5)
    mistakes = data.get("mistakes") or []
    corrects = data.get("corrects") or []
    if not isinstance(mistakes, list):
        mistakes = []
    if not isinstance(corrects, list):
        corrects = []
    # limit size
    mistakes = mistakes[:200]
    corrects = corrects[:200]
    db = get_db()
    cur = db.execute(
        """INSERT INTO scores
        (nick, when_ts, right_count, wrong_count, total, pct, grade, attempts, completed, duration_ms, lessons, dir, timer, mistakes_json, corrects_json, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            nick, when_ts, right, wrong, total, pct, grade, attempts, int(completed), duration_ms, lessons, direction, timer,
            json.dumps(mistakes, ensure_ascii=False),
            json.dumps(corrects, ensure_ascii=False),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid}), 201

@app.route("/api/scores/<int:score_id>", methods=["DELETE"])
@require_admin
def delete_score(score_id):
    db = get_db()
    cur = db.execute("DELETE FROM scores WHERE id=?", (score_id,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

@app.route("/api/scores", methods=["DELETE"])
@require_admin
def clear_scores():
    db = get_db()
    db.execute("DELETE FROM scores")
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/admin/login", methods=["POST"])
def admin_login():
    data = request.get_json(silent=True) or {}
    password = data.get("password") or ""
    if secrets.compare_digest(password, ADMIN_PASSWORD):
        token = secrets.token_urlsafe(32)
        ADMIN_TOKENS.add(token)
        return jsonify({"ok": True, "token": token})
    return jsonify({"error": "Invalid password"}), 401

@app.route("/api/admin/logout", methods=["POST"])
def admin_logout():
    auth = request.headers.get("Authorization", "")
    token = auth.replace("Bearer ", "").strip() if auth.startswith("Bearer ") else ""
    ADMIN_TOKENS.discard(token)
    return jsonify({"ok": True})

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5050))
    print(f"Flashcards: http://127.0.0.1:{port}/")
    print(f"Admin:      http://127.0.0.1:{port}/admin")
    print(f"Admin password: {ADMIN_PASSWORD}")
    app.run(host="0.0.0.0", port=port, debug=False)

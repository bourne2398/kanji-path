# Kanji Path (墨道) — Vercel + Neon + Admin

Self-contained Jōyō kanji study app with:

- Static frontend (`public/index.html`)
- Serverless API on Vercel (`/api/*`)
- Neon Postgres (users + 40,000 vocabulary rows)
- Admin dashboard at `/admin.html`; administrators sign in through the main app Sign in form.

---

## 1. Create a Neon database

1. Go to [https://console.neon.tech](https://console.neon.tech) and create a project.
2. Copy the **connection string** (pooled or direct). Example:

   ```
   postgresql://USER:PASSWORD@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

3. Keep this as `DATABASE_URL`.

---

## 2. Push this repo to GitHub

From your machine (or Codespace):

```bash
cd kanji-path
git init
git add .
git commit -m "Kanji Path: Vercel + Neon + admin"
gh repo create kanji-path --private --source=. --push
# or: git remote add origin https://github.com/YOU/kanji-path.git && git push -u origin main
```

---

## 3. Deploy on Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** your GitHub repo.
2. Framework preset: **Other** (static + serverless).
3. Root directory: leave default (repo root).
4. **Environment variables** (Project → Settings → Environment Variables):

   | Name | Value |
   |------|--------|
   | `DATABASE_URL` | Neon connection string |
   | `JWT_SECRET` | long random string (32+ chars) |
   | `ADMIN_EMAIL` | e.g. `you@example.com` (optional, for local seed) |
   | `ADMIN_PASSWORD` | strong password (optional, for local seed) |

5. Deploy. After deploy, the app is live at `https://your-project.vercel.app`.

---

## 4. Create the admin user & schema

On your computer (with Node 18+):

```bash
cd kanji-path
npm install

export DATABASE_URL="postgresql://..."   # same as Vercel
export ADMIN_EMAIL="you@example.com"
export ADMIN_PASSWORD="YourStrongPassword123!"
export ADMIN_NAME="Admin"

npm run seed:admin
```

This creates tables and an **admin** row in `users`.

---

## 5. Load the 40,000 vocabulary SQL

```bash
export DATABASE_URL="postgresql://..."
# Optional full reload:
# export RESET_VOCAB=1

npm run seed:vocab
```

Expect ~40,000 rows in `joyo_vocabulary`. Takes a few minutes depending on network.

You can also paste `scripts/joyo-vocabulary.sql` into the Neon SQL Editor, but the Node script is more reliable for the large dump.

---

## 6. Log in as admin

1. Open the main app.
2. Use the normal **Sign in** form with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. Admin accounts are redirected to `/admin.html` automatically.
3. Check health line: vocabulary count should be ~40,000
4. Create additional students/admins from the panel

Main app login button (banner) uses the same `/api/auth/login` endpoint.

---

## API overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | DB connectivity + counts |
| `/api/auth/login` | POST | `{ email, password }` → sets HttpOnly cookie |
| `/api/auth/logout` | POST | Clears session |
| `/api/auth/me` | GET | Current user or `null` |
| `/api/admin/users` | GET/POST | Admin only: list / create users |
| `/api/vocab` | GET | `?q=&kanji=&page=&limit=` query vocabulary |

---

## Local development

```bash
npm install
# Install Vercel CLI once: npm i -g vercel
cp .env.example .env.local
# fill DATABASE_URL + JWT_SECRET
vercel dev
```

Open http://localhost:3000

---

## Security notes

- Change `ADMIN_PASSWORD` after first login.
- `JWT_SECRET` must be unique and secret.
- Neon: prefer the **pooled** connection string for serverless.
- Admin routes check `role === 'admin'` from the signed JWT.

---

## Project layout

```
kanji-path/
  public/
    index.html      # main study app
    admin.html      # admin panel
  api/
    auth/login.js
    auth/logout.js
    auth/me.js
    admin/users.js
    vocab.js
    health.js
  lib/
    db.js
    auth.js
    schema.sql
  scripts/
    seed-admin.mjs
    seed-vocab.mjs
    joyo-vocabulary.sql   # 40k rows
  package.json
  vercel.json
  .env.example
  README.md
```

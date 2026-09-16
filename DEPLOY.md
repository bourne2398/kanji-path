# Deploy Kanji Path to Vercel (zero-config ready)

## Prerequisites
- Neon Postgres project → copy the connection string
- Vercel account (Hobby plan is enough — 10 serverless functions)

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Required | Example |
|------|----------|---------|
| `DATABASE_URL` | **Yes** | `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require` |
| `JWT_SECRET` | **Yes** | any random string ≥ 16 characters |
| `RESEND_API_KEY` | Optional (password reset emails) | `re_...` |
| `RESEND_FROM` | Optional | `Kanji Path <no-reply@yourdomain.com>` |
| `APP_URL` | Optional | `https://your-app.vercel.app` |

Apply to Production, Preview, and Development.

## 2. Database setup (one-time)

In the Neon SQL Editor run the contents of `lib/schema.sql`.

Then from your machine (with Node 20+):

```bash
export DATABASE_URL="postgresql://..."
export ADMIN_EMAIL="you@example.com"
export ADMIN_PASSWORD="YourStrongPassword123!"
export ADMIN_NAME="Admin"

npm install
npm run seed:admin
npm run seed:vocab   # loads ~40k vocabulary rows (takes a minute)
```

## 3. Deploy

### Option A — GitHub
```bash
git init
git add .
git commit -m "Kanji Path production ready"
# create repo and push, then import in Vercel dashboard
# Framework Preset: Other
# Root Directory: leave blank (repo root)
```

### Option B — Vercel CLI
```bash
npx vercel --prod
```

## 4. Verify

After deploy open:

- `https://YOUR-APP.vercel.app/api/health`  
  → must return JSON with `"ok": true` and non-null `vocabulary_entries` / `users`.

- `https://YOUR-APP.vercel.app/`  
  → Path mode loads, practice writing works offline.

- Sign in / register → progress should sync (check Network tab for `/api/progress`).

## Function count (Hobby limit = 12)
- /api/auth/login
- /api/auth/register
- /api/auth/logout
- /api/auth/me
- /api/auth/forgot
- /api/auth/reset
- /api/admin/users
- /api/health
- /api/vocab
- /api/progress

Do not add more files under `api/` unless you stay under 12.

## Troubleshooting 404 on /api/*
1. Confirm Root Directory in Vercel is empty (not `public`).
2. Confirm `api/` folder is at the repository root.
3. Redeploy after a clean push (no nested old `api/auth/...` copies).
4. Check Function logs in the Vercel dashboard.

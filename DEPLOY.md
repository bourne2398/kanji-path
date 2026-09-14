# Deploy to Vercel (Hobby plan)

## Why builds failed
1. Hobby plan allows **max 12 serverless functions**.
2. Older uploads included a **nested copy** of the project under `api/auth/`, which created too many functions.
3. Commits named "Update index.html" only change the frontend — **they do not remove** the old nested API files on the server.

## Fix (do this once)

### Option A — Vercel Dashboard upload
1. Download `Kanji-Path-Deploy-Clean.zip` from this release.
2. In Vercel → Project → **Settings → General**, note the connected Git repo (or use CLI).
3. **Delete every file** in the GitHub repo (or create a fresh empty repo).
4. Upload/extract this zip so the root contains:
   ```
   api/
   lib/
   public/
   scripts/
   package.json
   vercel.json
   ```
5. Push to `main` and redeploy.
6. Set Environment Variables:
   - `DATABASE_URL` = Neon connection string
   - `JWT_SECRET` = any random string, 16+ characters

### Option B — CLI
```bash
unzip Kanji-Path-Deploy-Clean.zip
cd kanji-path-main
npx vercel --prod
```

## Serverless functions in this package (7 total)
- /api/auth/login
- /api/auth/logout
- /api/auth/me
- /api/admin/users
- /api/health
- /api/vocab
- /api/progress

Do **not** add more files under `api/` unless you stay under 12.

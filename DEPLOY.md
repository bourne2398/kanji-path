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
   - `RESEND_API_KEY` = Resend API key for password-reset emails
   - `RESEND_FROM` = verified sender, e.g. `Kanji Path <no-reply@yourdomain.com>`
   - `APP_URL` = your public Vercel URL, e.g. `https://your-app.vercel.app`

### Option B — CLI
```bash
unzip Kanji-Path-Deploy-Clean.zip
cd kanji-path-main
npx vercel --prod
```

## Serverless functions in this package (10 total)
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

Do **not** add more files under `api/` unless you stay under 12.


## Database update
Run `lib/schema.sql` in the Neon SQL Editor after deploying this version. It adds password-reset fields, the `everyday` vocabulary flag, and indexes. The Kanji Path client now loads/saves path progress through `/api/progress` whenever the user is signed in.

## Vocabulary
The vocabulary API defaults to everyday-use entries (`everyday = TRUE`) instead of exposing the old N5–N1 flashcard filter. The seed SQL also classifies specialist/obscure entries out of the default flashcard pool. The classification is intentionally conservative and can be further curated by changing `joyo_vocabulary.everyday` in Neon.

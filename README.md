# Japanese Flashcards — Kanji Path 2,136

Responsive Japanese learning app for Vercel + Neon/Postgres.

## Included
- Lessons 54–70 (344 flashcards)
- Bundled caricature artwork for flashcards and 4 Pics 1 Word
- 4 Pics 1 Word Japanese vocabulary game
- Local username + Android-style 3×3 pattern-password profile
- Kanji Path with the embedded 2,136 Jōyō kanji list
- Kanji study and stroke-order practice using Japanese Hanzi Writer data
- Review history and admin tools through `/api/scores`
- Startup loader that reports flashcards, artwork, Kanji Practice, and stroke-order preparation
- Mobile/tablet responsive layout

## Authentication note
The student account is a **local browser profile**. Usernames and a salted SHA-256 hash of the pattern are stored in that browser's localStorage. This is intended for personal/device-based access, not as a server-side multi-device account system.

## Vercel
Deploy the project root. The static app is `public/index.html`; assets are under `public/assets/`. Keep `DATABASE_URL`, `ADMIN_PASSWORD`, and optional `ADMIN_TOKEN` configured if using the Neon history/admin API.

# Deployment Checklist (GitHub + Netlify + Render)

## 1) Firebase
- Create Firebase project and enable Authentication (Email/Password).
- Use mobile-to-email mapping in frontend (`0912...@puhunanph.app`).
- Create Firestore database in production mode.
- Deploy `firestore.rules` and `firestore.indexes.json`.
- Create first admin user in `users` collection with `isAdmin: true`.

## 2) Frontend (Netlify)
- Push repo to GitHub.
- Connect GitHub repo to Netlify.
- Build command: none (static).
- Publish directory: `public`.
- Keep `netlify.toml` enabled for API redirect.
- Update `public/assets/js/firebase-config.js` with real Firebase web config.

## 3) Backend (Render)
- Create new Web Service from `backend/` folder.
- Start command: `npm start`.
- Set all environment variables from `backend/.env.example`.
- Confirm `GET /api/health` returns `{ ok: true }`.

## 4) PayMongo
- Create webhook endpoint: `https://<render-domain>/api/paymongo-webhook`.
- Save webhook secret to `PAYMONGO_WEBHOOK_SECRET`.
- Save secret key to `PAYMONGO_SECRET_KEY`.
- Test deposit flow end-to-end in sandbox/live as needed.

## 5) Daily Rewards Scheduler
- In Render Cron Jobs, call `POST /api/run-daily-rewards` at 1:00 AM.
- Add header `x-cron-secret` with `CRON_SECRET` value.
- Verify daily reward logs appear in `logs` and `dailyRewards` collections.

## 6) Production Hardening
- Rotate and revoke any leaked keys before launch.
- Enable Firebase App Check and stricter Firestore rules as needed.
- Configure domain HTTPS only.
- Add monitoring/alerts for webhook failures.

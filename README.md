# PuhunanPH

Full-stack investment referral platform with Firebase realtime sync, PayMongo deposit webhook, and Render-scheduled daily rewards.

## Stack
- Frontend: HTML, CSS, JavaScript
- Auth/DB: Firebase Authentication + Firestore
- Backend: Node.js + Express (Render)
- Payments: PayMongo QRPH via webhook verification

## Project Structure
- `index.html` intro loading page
- `login.html`, `register.html`
- `dashboard.html`, `product.html`, `team.html`, `profile.html`
- `deposit.html`, `withdraw.html`
- `deposit-history.html`, `withdraw-history.html`
- `logs.html`, `admin.html`
- `assets/css/styles.css` shared green modern UI
- `assets/js/*.js` modular app logic
- `backend/` Render API + scheduler endpoint

## Setup

### 1) Frontend
Open files with any static server (or deploy to Netlify).

Set Firebase values in:
- `assets/js/firebase-config.js`

### 2) Backend
```bash
cd backend
npm install
npm run dev
```

Create `backend/.env`:
```env
PORT=10000
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
PAYMONGO_SECRET_KEY=sk_...
PAYMONGO_WEBHOOK_SECRET=whsk_...
ADMIN_MOBILE=09123456789
```

### 3) Render Cron
Create a scheduled call at `1:00 AM` to:
- `POST /api/run-daily-rewards`
with header:
- `x-cron-secret: <your custom secret>`

## Security Notes
- Never commit service account JSON or private keys.
- Use Firestore rules from `firestore.rules`.
- Set API keys and webhook secrets as environment variables only.

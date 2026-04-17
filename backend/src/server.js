import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicCandidates = [
  path.resolve(__dirname, "../../public"),
  path.resolve(__dirname, "../public"),
  path.resolve(process.cwd(), "../public"),
  path.resolve(process.cwd(), "public")
];
const publicDir = publicCandidates.find((p) => fs.existsSync(p));
const frontendBase = (process.env.FRONTEND_BASE_URL || "https://puhunanph.netlify.app").replace(/\/$/, "");

if (publicDir) {
  // Serve frontend pages/assets so routes like /register.html work on backend host.
  app.use(express.static(publicDir));
}

const frontendPages = [
  "/",
  "/index.html",
  "/login.html",
  "/register.html",
  "/dashboard.html",
  "/product.html",
  "/team.html",
  "/profile.html",
  "/deposit.html",
  "/withdraw.html",
  "/deposit-history.html",
  "/withdraw-history.html",
  "/logs.html",
  "/admin.html"
];

if (!publicDir) {
  // Fallback when the container only has backend files.
  frontendPages.forEach((route) => {
    app.get(route, (_, res) => {
      const file = route === "/" ? "index.html" : route.replace(/^\//, "");
      res.redirect(302, `${frontendBase}/${file}`);
    });
  });
}

let db = null;
try {
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
      })
    });
    db = admin.firestore();
  } else {
    console.warn("Firebase Admin not configured. API data endpoints will return 503 until env vars are set.");
  }
} catch (error) {
  console.error("Firebase Admin initialization failed:", error.message);
}
const ADMIN_SECRET = process.env.ADMIN_ACTION_SECRET || "";
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeReferralCode(length = 8) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  return out;
}

async function generateUniqueReferralCodeAdmin(length = 8) {
  for (let i = 0; i < 40; i += 1) {
    const code = makeReferralCode(length);
    const snap = await db.collection("referralCodes").doc(code).get();
    if (!snap.exists) return code;
  }
  throw new Error("Failed to generate unique referral code");
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") return parts[1];
  return null;
}

function requireAdminSecret(req, res) {
  if (!ADMIN_SECRET) return true;
  const token = req.headers["x-admin-secret"];
  if (token !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized admin action" });
    return false;
  }
  return true;
}

function nowParts() {
  const d = new Date();
  return {
    date: d.toLocaleDateString("en-PH"),
    time: d.toLocaleTimeString("en-PH")
  };
}

async function addLog(userId, type, message, meta = {}) {
  const { date, time } = nowParts();
  await db.collection("logs").add({
    userId,
    type,
    message,
    ...meta,
    date,
    time,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "puhunanph-backend" }));

app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  if (!db) return res.status(503).json({ error: "Backend is running but Firebase Admin is not configured." });
  return next();
});

app.post("/api/create-paymongo-source", async (req, res) => {
  try {
    const { uid, amount } = req.body;
    if (!uid || !amount) return res.status(400).json({ error: "uid and amount required" });
    const payload = {
      data: {
        attributes: {
          amount: Math.round(Number(amount) * 100),
          redirect: {
            success: "https://puhunanph.netlify.app/deposit-history.html",
            failed: "https://puhunanph.netlify.app/deposit.html"
          },
          type: "gcash",
          currency: "PHP"
        }
      }
    };
    const response = await axios.post("https://api.paymongo.com/v1/sources", payload, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.PAYMONGO_SECRET_KEY}:`).toString("base64")}`,
        "Content-Type": "application/json"
      }
    });

    const source = response.data.data;
    await db.collection("deposits").doc(source.id).set({
      userId: uid,
      amount: Number(amount),
      status: "pending",
      sourceId: source.id,
      checkoutUrl: source.attributes.redirect.checkout_url,
      ...nowParts(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ sourceId: source.id, checkoutUrl: source.attributes.redirect.checkout_url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/paymongo-webhook", async (req, res) => {
  try {
    const sig = req.headers["paymongo-signature"];
    if (!sig) return res.status(401).json({ error: "Missing signature" });

    const evt = req.body.data?.attributes?.type;
    const src = req.body.data?.attributes?.data?.attributes?.source;
    const sourceId = src?.id || req.body.data?.attributes?.data?.id || null;
    const amount = Number(src?.amount || req.body.data?.attributes?.data?.attributes?.amount || 0) / 100;
    if (!sourceId) return res.json({ ok: true, ignored: true });
    if (evt !== "source.chargeable" && evt !== "source.paid" && evt !== "payment.paid") {
      return res.json({ ok: true, ignored: true });
    }

    const depRef = db.collection("deposits").doc(sourceId);
    const depDoc = await depRef.get();
    if (!depDoc.exists) return res.status(404).json({ error: "Deposit source not found" });
    const deposit = depDoc.data();
    if (deposit.status === "paid") return res.json({ ok: true, duplicate: true });

    await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(deposit.userId);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const user = userSnap.data();
      tx.update(userRef, {
        balance: (user.balance || 0) + amount,
        walletBalance: (user.walletBalance || 0) + amount,
        depositBalance: (user.depositBalance || 0) + amount
      });
      tx.update(depRef, {
        status: "paid",
        amount,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        ...nowParts()
      });
    });

    await addLog(deposit.userId, "deposit", "Deposit paid via PayMongo", { amount });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/withdraw-request", async (req, res) => {
  try {
    const { uid, mobileNumber, accountName, accountNumber, amount } = req.body;
    if (!uid || !mobileNumber || !accountName || !accountNumber || !amount) return res.status(400).json({ error: "Missing fields" });
    if (Number(amount) < 100) return res.status(400).json({ error: "Minimum withdraw is 100" });

    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const user = (await tx.get(userRef)).data();
      if ((user.withdrawBalance || 0) < amount) throw new Error("Insufficient withdraw balance");
      tx.update(userRef, {
        withdrawBalance: (user.withdrawBalance || 0) - Number(amount)
      });
      tx.set(db.collection("withdraws").doc(), {
        userId: uid,
        mobileNumber,
        accountName,
        accountNumber,
        amount: Number(amount),
        status: "pending",
        ...nowParts(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await addLog(uid, "withdraw", "Withdraw request submitted", { amount: Number(amount) });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/approve-withdraw/:withdrawId", async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;
    const { withdrawId } = req.params;
    const ref = db.collection("withdraws").doc(withdrawId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Withdraw not found" });
    const wd = snap.data();
    if (wd.status === "approved") return res.json({ ok: true, alreadyApproved: true });
    await ref.update({ status: "approved", approvedAt: admin.firestore.FieldValue.serverTimestamp() });
    await addLog(wd.userId, "withdraw", "Withdraw request approved", { amount: wd.amount });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/delete-user/:uid", async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;
    const { uid } = req.params;
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error: "User not found" });
    await userRef.delete();
    await admin.auth().deleteUser(uid).catch(() => null);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/firebase/complete-registration", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const { mobile, referralCode } = req.body || {};
    const refCode = String(referralCode || "").trim().toUpperCase();
    if (!mobile || refCode.length !== 8) return res.status(400).json({ error: "Invalid registration payload" });

    const inviterSnap = await db.collection("referralCodes").doc(refCode).get();
    if (!inviterSnap.exists) return res.status(400).json({ error: "Invalid invite/referral code." });
    const inviterUid = inviterSnap.data().uid || null;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const join = nowParts();
    const myCode = await generateUniqueReferralCodeAdmin(8);
    const baseUser = userSnap.exists ? userSnap.data() : {};
    await userRef.set({
      uid,
      mobile,
      balance: baseUser.balance || 0,
      walletBalance: baseUser.walletBalance || 0,
      depositBalance: baseUser.depositBalance || 0,
      withdrawBalance: baseUser.withdrawBalance || 0,
      referralCode: myCode,
      referredBy: inviterUid,
      level1: baseUser.level1 || 0,
      level2: baseUser.level2 || 0,
      level3: baseUser.level3 || 0,
      joinDate: baseUser.joinDate || join.date,
      joinTime: baseUser.joinTime || join.time,
      isAdmin: baseUser.isAdmin === true,
      isBanned: baseUser.isBanned === true
    }, { merge: true });

    await db.collection("referralCodes").doc(myCode).set({
      code: myCode,
      uid,
      mobile,
      isAdmin: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await addLog(uid, "register", `Registered with inviter code ${refCode}`);
    res.json({ ok: true, uid, referralCode: myCode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/admin/fallback-data", async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;
    const limitN = Math.min(Number(req.query.limit || 200), 500);

    const [usersSnap, withdrawsSnap, investmentsSnap, logsSnap, dailyRewardsSnap] = await Promise.all([
      db.collection("users").limit(limitN).get(),
      db.collection("withdraws").limit(limitN).get(),
      db.collection("investments").limit(limitN).get(),
      db.collection("logs").limit(limitN).get(),
      db.collection("dailyRewards").limit(limitN).get()
    ]);

    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const withdraws = withdrawsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const investments = investmentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const dailyRewards = dailyRewardsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.json({ ok: true, users, withdraws, investments, logs, dailyRewards, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/run-daily-rewards", async (req, res) => {
  try {
    if (process.env.CRON_SECRET && req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized cron request" });
    }
    const today = new Date().toISOString().slice(0, 10);
    const active = await db.collection("investments").where("status", "==", "active").get();
    let count = 0;
    for (const invDoc of active.docs) {
      const inv = invDoc.data();
      if (new Date(inv.endDate) < new Date()) {
        await invDoc.ref.update({ status: "completed" });
        continue;
      }
      const already = await db.collection("dailyRewards")
        .where("investmentId", "==", invDoc.id)
        .where("date", "==", today)
        .limit(1)
        .get();
      if (!already.empty) continue;
      const reward = Number(inv.amount) * 0.1;
      await db.runTransaction(async (tx) => {
        const userRef = db.collection("users").doc(inv.userId);
        const user = (await tx.get(userRef)).data();
        tx.update(userRef, {
          balance: (user.balance || 0) + reward,
          walletBalance: (user.walletBalance || 0) + reward
        });
        tx.set(db.collection("dailyRewards").doc(), {
          userId: inv.userId,
          investmentId: invDoc.id,
          amount: reward,
          ...nowParts(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await addLog(inv.userId, "dailyReward", "Daily 10% reward credited", { amount: reward });
      count += 1;
    }
    res.json({ ok: true, processed: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`PuhunanPH backend listening on :${PORT}`);
});

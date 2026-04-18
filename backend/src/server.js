import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

function getEnvFirst(...keys) {
  for (const key of keys) {
    const val = process.env[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") return String(val);
  }
  return "";
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicCandidates = [
  path.resolve(__dirname, "../../public"),
  path.resolve(__dirname, "../public"),
  path.resolve(process.cwd(), "../public"),
  path.resolve(process.cwd(), "public")
];
const publicDir = publicCandidates.find((p) => fs.existsSync(p));
const frontendBase = (process.env.FRONTEND_BASE_URL || "https://puhunan-ph.xyz").replace(/\/$/, "");

if (publicDir) {
  // Same as Netlify _redirects: short invite URLs (Express does not read _redirects).
  app.get("/r/:code", (req, res) => {
    const code = String(req.params.code || "").trim();
    if (!code) {
      res.redirect(302, "/register.html");
      return;
    }
    res.redirect(302, `/register.html?ref=${encodeURIComponent(code)}`);
  });
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
  app.get("/r/:code", (req, res) => {
    const code = String(req.params.code || "").trim();
    if (!code) {
      res.redirect(302, `${frontendBase}/register.html`);
      return;
    }
    res.redirect(302, `${frontendBase}/register.html?ref=${encodeURIComponent(code)}`);
  });
  frontendPages.forEach((route) => {
    app.get(route, (_, res) => {
      const file = route === "/" ? "index.html" : route.replace(/^\//, "");
      res.redirect(302, `${frontendBase}/${file}`);
    });
  });
}

let db = null;
try {
  const normalizePrivateKey = (raw = "") => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return "";
    const unquoted = trimmed.startsWith("\"") && trimmed.endsWith("\"")
      ? trimmed.slice(1, -1)
      : trimmed;
    return unquoted.replace(/\\n/g, "\n");
  };

  const fromJson = getEnvFirst("FIREBASE_SERVICE_ACCOUNT_JSON").trim();
  if (fromJson) {
    const parsed = JSON.parse(fromJson);
    const privateKey = normalizePrivateKey(parsed.private_key || parsed.privateKey || "");
    if (parsed.project_id && parsed.client_email && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey
        })
      });
      db = admin.firestore();
    } else {
      console.warn("FIREBASE_SERVICE_ACCOUNT_JSON is present but missing required fields.");
    }
  } else {
    const projectId = getEnvFirst("FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID_B").trim();
    const clientEmail = getEnvFirst("FIREBASE_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL_B").trim();
    let privateKey = normalizePrivateKey(getEnvFirst("FIREBASE_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY_B"));
    const privateKeyBase64 = getEnvFirst("FIREBASE_PRIVATE_KEY_BASE64", "FIREBASE_PRIVATE_KEY_BASE64_B");
    if (!privateKey && privateKeyBase64) {
      try {
        privateKey = normalizePrivateKey(
          Buffer.from(privateKeyBase64, "base64").toString("utf8")
        );
      } catch (_) {
        // Ignore invalid base64 and keep fallback warning below.
      }
    }
    if (projectId && clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
      db = admin.firestore();
    } else {
      const missing = [];
      if (!projectId) missing.push("FIREBASE_PROJECT_ID");
      if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
      if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY (or FIREBASE_PRIVATE_KEY_BASE64)");
      console.warn(`Firebase Admin not configured. Missing: ${missing.join(", ")}`);
    }
  }
} catch (error) {
  console.error("Firebase Admin initialization failed:", error.message);
}
const ADMIN_SECRET = getEnvFirst("ADMIN_ACTION_SECRET") || "";
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

let bitlyGroupGuidMemo = "";

async function resolveBitlyGroupGuid(bitlyToken) {
  const fromEnv = getEnvFirst("BITLY_GROUP_GUID", "BITLY_ORG_GUID").trim();
  if (fromEnv) return fromEnv;
  if (bitlyGroupGuidMemo) return bitlyGroupGuidMemo;
  const r = await axios.get("https://api-ssl.bitly.com/v4/groups", {
    headers: { Authorization: `Bearer ${bitlyToken}` }
  });
  const guid = r.data?.groups?.[0]?.guid || "";
  if (!guid) throw new Error("Bitly returned no groups.");
  bitlyGroupGuidMemo = guid;
  return guid;
}

/** Returns https://bit.ly/... or null if not configured / Bitly error. */
async function shortenWithBitly(longUrl) {
  const bitlyToken = getEnvFirst("BITLY_API_TOKEN", "BITLY_GENERIC_ACCESS_TOKEN", "BITLY_ACCESS_TOKEN").trim();
  if (!bitlyToken || !longUrl) return null;
  try {
    const groupGuid = await resolveBitlyGroupGuid(bitlyToken);
    const res = await axios.post(
      "https://api-ssl.bitly.com/v4/shorten",
      {
        long_url: longUrl,
        domain: "bit.ly",
        group_guid: groupGuid
      },
      {
        headers: {
          Authorization: `Bearer ${bitlyToken}`,
          "Content-Type": "application/json"
        }
      }
    );
    const link = res.data?.link && String(res.data.link).trim();
    return link || null;
  } catch (err) {
    const detail = err?.response?.data?.message || err?.response?.data?.description
      || err?.response?.data?.errors?.[0]?.message;
    console.warn("Bitly shorten failed:", detail || err?.message || err);
    return null;
  }
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

/** YYYY-MM-DD in Asia/Manila — matches client `phDateKey` for daily rewards / ads. */
function phDateKey(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
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

async function distributeReferralCommissionServer(uid, amount, sourceType = "invest", sourceId = null) {
  const levels = [0.15, 0.05, 0.01];
  let currentId = uid;
  const baseUser = await db.collection("users").doc(uid).get();
  const fromUserMobile = baseUser.exists ? baseUser.data().mobile || "" : "";
  const at = nowParts();

  for (let i = 0; i < levels.length; i += 1) {
    const userSnap = await db.collection("users").doc(currentId).get();
    if (!userSnap.exists) break;
    const parentId = userSnap.data().referredBy;
    if (!parentId) break;
    const commission = Number(amount) * levels[i];
    await db.collection("users").doc(parentId).update({
      walletBalance: admin.firestore.FieldValue.increment(commission),
      withdrawBalance: admin.firestore.FieldValue.increment(commission),
      commissionIncome: admin.firestore.FieldValue.increment(commission)
    });
    await db.collection("referralCommissions").add({
      userId: parentId,
      fromUserId: currentId,
      fromUserMobile,
      sourceType,
      sourceId,
      level: i + 1,
      percent: levels[i],
      amount: commission,
      date: at.date,
      time: at.time,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await addLog(parentId, "referral", `Level ${i + 1} commission earned`, { amount: commission });
    currentId = parentId;
  }
}

/**
 * Walk PayMongo webhook JSON for a resource with type "payment" and attributes.status "paid".
 */
function extractPaymongoPaidPayment(body) {
  if (!body || typeof body !== "object") return null;
  const seen = new Set();
  const stack = [body];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== "object" || seen.has(o)) continue;
    seen.add(o);
    const type = String(o.type || "");
    const attrs = o.attributes && typeof o.attributes === "object" ? o.attributes : null;
    if (type === "payment" && attrs && String(attrs.status || "").toLowerCase() === "paid") {
      const amountCent = Number(attrs.amount);
      const netCentRaw = attrs.net_amount ?? attrs.netAmount ?? attrs.amount;
      const netCent = Number(netCentRaw);
      return {
        paymongoId: String(o.id || "").trim(),
        metadata: attrs.metadata && typeof attrs.metadata === "object" ? attrs.metadata : {},
        amountCentavos: Number.isFinite(amountCent) ? amountCent : 0,
        netAmountCentavos: Number.isFinite(netCent) ? netCent : (Number.isFinite(amountCent) ? amountCent : 0)
      };
    }
    for (const k of ["data", "attributes", "event", "resource"]) {
      const v = o[k];
      if (!v) continue;
      if (Array.isArray(v)) {
        for (const x of v) stack.push(x);
      } else if (typeof v === "object") {
        stack.push(v);
      }
    }
    const inner = attrs?.data;
    if (inner) {
      if (Array.isArray(inner)) for (const x of inner) stack.push(x);
      else stack.push(inner);
    }
  }
  return null;
}

/** PayMongo amounts are usually in centavos (minor units). */
function paymongoMinorToPhp(minor) {
  const n = Number(minor);
  if (!Number.isFinite(n) || n < 0) return null;
  return n / 100;
}

/** Flat `event` or nested PayMongo envelope → { id, attributes } */
function flattenPaymongoPayment(body) {
  if (body?.type === "payment" && body?.attributes && String(body.attributes.status || "").toLowerCase() === "paid") {
    return { id: body.id, attributes: body.attributes };
  }
  const nested = extractPaymongoPaidPayment(body);
  if (!nested?.paymongoId) return null;
  return {
    id: nested.paymongoId,
    attributes: {
      status: "paid",
      metadata: nested.metadata,
      net_amount: nested.netAmountCentavos,
      amount: nested.amountCentavos,
      paid_at: undefined,
      created_at: undefined
    }
  };
}

app.get("/api/health", (_, res) => res.json({ ok: true, service: "puhunanph-backend" }));

/**
 * PayMongo webhook — always 200 `{ received: true }` (no retry storm).
 * `type === "payment"` + `attributes.status === "paid"`, metadata.uid + metadata.depositAmount (PHP).
 * Finds pending row by metadata.referenceNumber or dep_${uid}_${created_at}, else inserts.
 */
app.post("/webhook/paymongo", async (req, res) => {
  const ok = () => res.status(200).send({ received: true });
  try {
    if (!db) return ok();

    const event = flattenPaymongoPayment(req.body);
    if (!event) return ok();

    const attrs = event.attributes && typeof event.attributes === "object" ? event.attributes : {};
    const md = attrs.metadata && typeof attrs.metadata === "object" ? attrs.metadata : {};
    const uid = String(md.uid || "").trim();
    const amountPhp = Number(md.depositAmount);
    if (!uid || !Number.isFinite(amountPhp) || amountPhp <= 0) {
      console.warn("[webhook/paymongo] missing metadata.uid or depositAmount");
      return ok();
    }

    const refFromMeta = String(md.referenceNumber || "").trim();
    const createdKey = attrs.created_at ?? attrs.created ?? "";
    const referenceNumber = refFromMeta || `dep_${uid}_${String(createdKey)}`;

    const paymongoId = String(event.id || "").trim();
    if (!paymongoId) {
      console.warn("[webhook/paymongo] missing payment id");
      return ok();
    }

    let netAmountPhp = amountPhp;
    const netFromMinor = paymongoMinorToPhp(attrs.net_amount ?? attrs.netAmount ?? attrs.amount);
    if (netFromMinor !== null && netFromMinor > 0) netAmountPhp = netFromMinor;

    const paidAtSec = Number(attrs.paid_at ?? attrs.paidAt);
    const creditedAtMs = Number.isFinite(paidAtSec) && paidAtSec > 0 ? paidAtSec * 1000 : Date.now();
    const creditedAt = admin.firestore.Timestamp.fromMillis(creditedAtMs);

    let walletCredited = false;

    await db.runTransaction(async (tx) => {
      const qSnap = await tx.get(
        db.collection("deposits").where("referenceNumber", "==", referenceNumber).limit(1)
      );
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("user not found");

      if (!qSnap.empty) {
        const docRef = qSnap.docs[0].ref;
        const existing = qSnap.docs[0].data() || {};
        const st = String(existing.status || "").toLowerCase();
        if (st === "confirmed" || st === "paid") return;
        tx.update(docRef, {
          status: "confirmed",
          netAmount: netAmountPhp,
          paymongoId,
          creditedAt
        });
        const u = userSnap.data() || {};
        tx.update(userRef, {
          walletBalance: (Number(u.walletBalance) || 0) + amountPhp,
          depositBalance: (Number(u.depositBalance) || 0) + amountPhp
        });
        walletCredited = true;
      } else {
        const newRef = db.collection("deposits").doc();
        tx.set(newRef, {
          userId: uid,
          amount: amountPhp,
          netAmount: netAmountPhp,
          paymongoId,
          referenceNumber,
          createdAt: creditedAt,
          status: "confirmed"
        });
        const u = userSnap.data() || {};
        tx.update(userRef, {
          walletBalance: (Number(u.walletBalance) || 0) + amountPhp,
          depositBalance: (Number(u.depositBalance) || 0) + amountPhp
        });
        walletCredited = true;
      }
    });

    if (walletCredited) {
      await db.collection("logs").add({
        userId: uid,
        action: "deposit",
        amount: amountPhp,
        reference: paymongoId,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      try {
        await distributeReferralCommissionServer(uid, amountPhp, "deposit", paymongoId);
      } catch (refErr) {
        console.error("[webhook/paymongo] referral commission failed", refErr);
      }
    }

    return ok();
  } catch (err) {
    console.error("[webhook/paymongo]", err);
    return ok();
  }
});

app.use("/api", (req, res, next) => {
  if (req.path === "/health") return next();
  if (!db) return res.status(503).json({ error: "Backend is running but Firebase Admin is not configured." });
  return next();
});

app.post("/api/create-paymongo-source", async (req, res) => {
  try {
    const { uid, amount } = req.body;
    if (!uid || !amount) return res.status(400).json({ error: "uid and amount required" });
    const paymongoSecretKey = getEnvFirst("PAYMONGO_SECRET_KEY", "PAYMONGO_SECRET_KEY_B");
    if (!paymongoSecretKey) {
      return res.status(503).json({ error: "PayMongo is not configured on backend yet." });
    }
    const phpAmount = Number(amount);
    if (!Number.isFinite(phpAmount) || phpAmount <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount." });
    }
    const paymongoSourceType = (getEnvFirst("PAYMONGO_SOURCE_TYPE", "PAYMONGO_SOURCE_TYPE_B") || "qrph").toLowerCase();
    const successRedirect = `${frontendBase}/deposit-history.html`;
    const failedRedirect = `${frontendBase}/deposit.html`;
    const amountCentavos = Math.round(phpAmount * 100);

    if (paymongoSourceType === "qrph") {
      const referenceNumber = `dep_${uid}_${Date.now()}`;
      const checkoutPayload = {
        data: {
          attributes: {
            line_items: [
              {
                currency: "PHP",
                amount: amountCentavos,
                name: "PuhunanPH Deposit",
                quantity: 1
              }
            ],
            payment_method_types: ["qrph"],
            success_url: successRedirect,
            cancel_url: failedRedirect,
            reference_number: referenceNumber,
            metadata: { uid, depositAmount: String(phpAmount), referenceNumber }
          }
        }
      };
      const response = await axios.post("https://api.paymongo.com/v1/checkout_sessions", checkoutPayload, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${paymongoSecretKey}:`).toString("base64")}`,
          "Content-Type": "application/json"
        }
      });
      const checkout = response.data?.data;
      const checkoutId = checkout?.id;
      const checkoutUrl = checkout?.attributes?.checkout_url;
      if (!checkoutId || !checkoutUrl) {
        return res.status(502).json({ error: "Checkout response is incomplete." });
      }
      await db.collection("deposits").doc(checkoutId).set({
        userId: uid,
        amount: phpAmount,
        status: "pending",
        sourceType: "qrph",
        sourceId: checkoutId,
        checkoutSessionId: checkoutId,
        referenceNumber,
        checkoutUrl,
        ...nowParts(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return res.json({ sourceId: checkoutId, checkoutUrl });
    }

    const allowedTypes = ["gcash", "grab_pay", "paymaya"];
    const finalType = allowedTypes.includes(paymongoSourceType) ? paymongoSourceType : "gcash";
    const payload = {
      data: {
        attributes: {
          amount: amountCentavos,
          redirect: {
            success: successRedirect,
            failed: failedRedirect
          },
          type: finalType,
          currency: "PHP"
        }
      }
    };
    const response = await axios.post("https://api.paymongo.com/v1/sources", payload, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${paymongoSecretKey}:`).toString("base64")}`,
        "Content-Type": "application/json"
      }
    });

    const source = response.data.data;
    await db.collection("deposits").doc(source.id).set({
      userId: uid,
      amount: phpAmount,
      status: "pending",
      sourceId: source.id,
      checkoutUrl: source.attributes.redirect.checkout_url,
      ...nowParts(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.json({ sourceId: source.id, checkoutUrl: source.attributes.redirect.checkout_url });
  } catch (error) {
    const paymongoDetail = error?.response?.data?.errors?.[0]?.detail
      || error?.response?.data?.errors?.[0]?.title
      || error?.response?.data?.errors?.[0]?.code;
    const msg = paymongoDetail || error?.message || "Failed to create PayMongo source.";
    const status = error?.response?.status || 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/api/invest", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const product = req.body?.product || {};
    const name = String(product.name || "").trim();
    const amount = Number(product.amount);
    const rate = Number(product.rate);
    const duration = Number(product.duration);
    if (!name || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || !Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ error: "Invalid product payload." });
    }

    const activeSnap = await db.collection("investments")
      .where("userId", "==", uid)
      .limit(200)
      .get();
    const now = Date.now();
    const hasRunning = activeSnap.docs.some((d) => {
      const row = d.data() || {};
      if (String(row?.product || "") !== name) return false;
      if (String(row?.status || "").toLowerCase() !== "active") return false;
      if (!row?.endDate) return true;
      const endTs = new Date(row.endDate).getTime();
      return Number.isFinite(endTs) ? endTs > now : true;
    });
    if (hasRunning) {
      return res.status(400).json({ error: "This product is still active. Reinvest after expiry." });
    }

    const invRef = db.collection("investments").doc();
    await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("User not found.");
      const user = userSnap.data();
      const wallet = Number(user.walletBalance || 0);
      const legacy = Number(user.balance || 0);
      const effectiveWallet = wallet > 0 ? wallet : legacy;
      if (effectiveWallet < amount) throw new Error("Insufficient balance.");
      tx.update(userRef, {
        walletBalance: effectiveWallet - amount,
        balance: 0
      });
      const start = new Date();
      const end = new Date(start);
      end.setDate(start.getDate() + duration);
      tx.set(invRef, {
        userId: uid,
        product: name,
        amount,
        profit: amount * rate,
        duration,
        status: "active",
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        referralCommissionApplied: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await addLog(uid, "investment", `Invested in ${name}`, { amount });
    await distributeReferralCommissionServer(uid, amount, "invest", invRef.id);
    await invRef.update({ referralCommissionApplied: true });
    res.json({ ok: true, investmentId: invRef.id });
  } catch (error) {
    const msg = String(error?.message || "Failed to invest.");
    if (/insufficient balance/i.test(msg) || /invalid product payload/i.test(msg) || /user not found/i.test(msg) || /still active/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

/** After client-side Firestore invest, credit uplines (rules block client from writing others' wallets). */
app.post("/api/apply-invest-referral", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const investmentId = String(req.body?.investmentId || "").trim();
    if (!investmentId) return res.status(400).json({ error: "investmentId required" });
    const invRef = db.collection("investments").doc(investmentId);
    const invSnap = await invRef.get();
    if (!invSnap.exists) return res.status(404).json({ error: "Investment not found" });
    const row = invSnap.data() || {};
    if (row.userId !== uid) return res.status(403).json({ error: "Not your investment" });
    if (row.referralCommissionApplied === true) {
      return res.json({ ok: true, already: true });
    }
    const createdAt = row.createdAt?.toDate?.() || null;
    if (!createdAt || Date.now() - createdAt.getTime() > 30 * 60 * 1000) {
      return res.status(400).json({ error: "Investment too old or missing timestamp to apply referral." });
    }
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid investment amount" });
    }
    await distributeReferralCommissionServer(uid, amount, "invest", investmentId);
    await invRef.update({ referralCommissionApplied: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message || "apply-invest-referral failed" });
  }
});

app.post("/api/paymongo-webhook", async (req, res) => {
  try {
    const sig = req.headers["paymongo-signature"];
    if (!sig) return res.status(401).json({ error: "Missing signature" });

    const evt = req.body.data?.attributes?.type;
    const eventData = req.body.data?.attributes?.data || {};
    const eventAttrs = eventData?.attributes || {};
    const src = eventAttrs?.source || {};
    const candidateId = src?.id
      || eventData?.id
      || eventAttrs?.checkout_session_id
      || null;
    const amountFromEvent = Number(src?.amount || eventAttrs?.amount || 0) / 100;
    const referenceNumber = String(eventAttrs?.reference_number || "").trim();
    if (evt !== "source.chargeable" && evt !== "source.paid" && evt !== "payment.paid" && evt !== "checkout_session.payment.paid") {
      return res.json({ ok: true, ignored: true });
    }

    let depRef = candidateId ? db.collection("deposits").doc(candidateId) : null;
    let depDoc = depRef ? await depRef.get() : null;
    if (!depDoc?.exists && eventAttrs?.checkout_session_id) {
      const q = await db.collection("deposits")
        .where("checkoutSessionId", "==", String(eventAttrs.checkout_session_id))
        .limit(1)
        .get();
      if (!q.empty) {
        depDoc = q.docs[0];
        depRef = depDoc.ref;
      }
    }
    if (!depDoc?.exists && referenceNumber) {
      const q = await db.collection("deposits")
        .where("referenceNumber", "==", referenceNumber)
        .limit(1)
        .get();
      if (!q.empty) {
        depDoc = q.docs[0];
        depRef = depDoc.ref;
      }
    }
    if (!depDoc?.exists) return res.status(404).json({ error: "Deposit source not found" });
    const deposit = depDoc.data();
    if (deposit.status === "paid") return res.json({ ok: true, duplicate: true });
    const amount = Number.isFinite(amountFromEvent) && amountFromEvent > 0
      ? amountFromEvent
      : Number(deposit.amount || 0);

    await db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(deposit.userId);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");
      const user = userSnap.data();
      tx.update(userRef, {
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

    await distributeReferralCommissionServer(deposit.userId, amount, "deposit", depRef.id);
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

    const invSnap = await db.collection("investments")
      .where("userId", "==", uid)
      .limit(200)
      .get();
    const nowMs = Date.now();
    const hasActiveProduct = invSnap.docs.some((d) => {
      const row = d.data() || {};
      if (String(row?.status || "").toLowerCase() !== "active") return false;
      const endTs = new Date(row?.endDate || "").getTime();
      if (!Number.isFinite(endTs)) return true;
      return endTs > nowMs;
    });
    if (!hasActiveProduct) {
      return res.status(400).json({ error: "Withdrawal is allowed only when user has an active product." });
    }

    const slot = Math.floor(Date.now() / 60000);
    const normAcc = String(accountNumber || "").replace(/\s+/g, "");
    const fpInput = `${uid}|${Number(amount)}|${normAcc}|${String(accountName || "").trim().toLowerCase()}|${slot}`;
    const withdrawId = `w_${crypto.createHash("sha256").update(fpInput).digest("hex").slice(0, 32)}`;
    const withdrawRef = db.collection("withdraws").doc(withdrawId);

    let duplicate = false;
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(withdrawRef);
      if (existing.exists) {
        duplicate = true;
        return;
      }
      const user = (await tx.get(userRef)).data();
      const wallet = Number(user?.walletBalance || 0);
      const legacy = Number(user?.balance || 0);
      const effectiveWallet = wallet > 0 ? wallet : legacy;
      if (effectiveWallet < amount) throw new Error("Insufficient wallet balance");
      tx.update(userRef, {
        walletBalance: effectiveWallet - Number(amount),
        balance: 0,
        withdrawBalance: (user.withdrawBalance || 0) + Number(amount)
      });
      tx.set(withdrawRef, {
        userId: uid,
        mobileNumber,
        accountName,
        accountNumber,
        amount: Number(amount),
        status: "pending",
        walletDeducted: true,
        ...nowParts(),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    if (duplicate) return res.json({ ok: true, duplicate: true });
    await addLog(uid, "withdraw", "Withdraw request submitted", { amount: Number(amount) });
    res.json({ ok: true });
  } catch (error) {
    const msg = String(error?.message || "Failed to submit withdrawal.");
    if (/insufficient wallet balance/i.test(msg) || /minimum withdraw/i.test(msg) || /missing fields/i.test(msg) || /active product/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
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
    if (wd.walletDeducted === true) {
      await ref.update({ status: "approved", approvedAt: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      await db.runTransaction(async (tx) => {
        const userRef = db.collection("users").doc(wd.userId);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error("User not found");
        const user = userSnap.data() || {};
        const amount = Number(wd.amount || 0);
        const wallet = Number(user.walletBalance || 0);
        const legacy = Number(user.balance || 0);
        const effectiveWallet = wallet > 0 ? wallet : legacy;
        if (effectiveWallet < amount) throw new Error("Insufficient wallet balance for approval");
        tx.update(userRef, {
          walletBalance: effectiveWallet - amount,
          balance: 0,
          withdrawBalance: (user.withdrawBalance || 0) + amount
        });
        tx.update(ref, {
          status: "approved",
          walletDeducted: true,
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    }
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

app.post("/api/admin/delete-withdraw/:id", async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;
    const { id } = req.params;
    await db.collection("withdraws").doc(id).delete();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/delete-investment/:id", async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;
    const { id } = req.params;
    await db.collection("investments").doc(id).delete();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/delete-log/:id", async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;
    const { id } = req.params;
    await db.collection("logs").doc(id).delete();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/delete-daily-reward/:id", async (req, res) => {
  try {
    if (!requireAdminSecret(req, res)) return;
    const { id } = req.params;
    await db.collection("dailyRewards").doc(id).delete();
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
    const signupBonus = 50;
    const alreadyGranted = baseUser.signupBonusGranted === true;
    const walletBase = Number(baseUser.walletBalance || 0);
    const walletWithBonus = alreadyGranted ? walletBase : walletBase + signupBonus;
    await userRef.set({
      uid,
      mobile,
      walletBalance: walletWithBonus,
      depositBalance: baseUser.depositBalance || 0,
      withdrawBalance: baseUser.withdrawBalance || 0,
      tradingEarnings: baseUser.tradingEarnings || 0,
      commissionIncome: baseUser.commissionIncome || 0,
      dailyProductIncome: baseUser.dailyProductIncome || 0,
      signupBonusGranted: true,
      signupBonusAmount: baseUser.signupBonusAmount || signupBonus,
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
    if (!alreadyGranted) {
      await addLog(uid, "bonus", "Signup bonus credited", { amount: signupBonus });
    }
    res.json({ ok: true, uid, referralCode: myCode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Authenticated: Bitly short URL for invite when BITLY_API_TOKEN is set; else long /r/{code} on FRONTEND_BASE_URL.
 * Caches on user doc when Bitly succeeds.
 */
app.post("/api/referral-invite-link", async (req, res) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return res.status(401).json({ error: "Missing bearer token" });
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: "User not found." });
    const code = String(userSnap.data()?.referralCode || "").trim();
    if (!code) return res.status(400).json({ error: "No referral code on profile yet." });
    const longUrl = `${frontendBase}/r/${encodeURIComponent(code)}`;

    const cachedLink = String(userSnap.data()?.referralBitlyLink || "").trim();
    const cachedLong = String(userSnap.data()?.referralBitlyLongUrl || "").trim();
    if (cachedLink && cachedLong === longUrl) {
      return res.json({ url: cachedLink, source: "cache" });
    }

    const short = await shortenWithBitly(longUrl);
    if (short) {
      await userRef.set(
        { referralBitlyLink: short, referralBitlyLongUrl: longUrl },
        { merge: true }
      );
      return res.json({ url: short, source: "bitly" });
    }

    return res.json({ url: longUrl, source: "direct" });
  } catch (error) {
    res.status(500).json({ error: error.message || "referral-invite-link failed" });
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
    const usersByUid = {};
    users.forEach((u) => { if (u?.uid) usersByUid[u.uid] = u; });
    const withdraws = withdrawsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const investments = investmentsSnap.docs.map((d) => {
      const row = { id: d.id, ...d.data() };
      return { ...row, userMobile: usersByUid[row.userId]?.mobile || row.userMobile || "" };
    });
    const logs = logsSnap.docs.map((d) => {
      const row = { id: d.id, ...d.data() };
      return { ...row, userMobile: usersByUid[row.userId]?.mobile || row.userMobile || "" };
    });
    const dailyRewards = dailyRewardsSnap.docs.map((d) => {
      const row = { id: d.id, ...d.data() };
      return { ...row, userMobile: usersByUid[row.userId]?.mobile || row.userMobile || "" };
    });

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
    const dayKey = phDateKey();
    const { time } = nowParts();
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
        .where("date", "==", dayKey)
        .limit(1)
        .get();
      if (!already.empty) continue;
      const reward = Number(inv.amount) * 0.1;
      await db.runTransaction(async (tx) => {
        const userRef = db.collection("users").doc(inv.userId);
        const user = (await tx.get(userRef)).data();
        tx.update(userRef, {
          walletBalance: (user.walletBalance || 0) + reward,
          dailyProductIncome: (user.dailyProductIncome || 0) + reward
        });
        tx.set(db.collection("dailyRewards").doc(), {
          userId: inv.userId,
          investmentId: invDoc.id,
          amount: reward,
          date: dayKey,
          time,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await addLog(inv.userId, "dailyReward", "Daily 10% reward credited", { amount: reward });
      count += 1;
    }
    res.json({ ok: true, processed: count, dayKey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`PuhunanPH backend listening on :${PORT}`);
});

// Render (and most PaaS) send SIGTERM when replacing the instance: new deploy, scaling,
// or free-tier spin-down/wake. You cannot opt out; exiting cleanly avoids SIGKILL mid-request.
function handleShutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log("HTTP server closed.");
    process.exit(0);
  });
  // Safety timeout in case there are hanging keep-alive connections.
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on("SIGTERM", () => handleShutdown("SIGTERM"));
process.on("SIGINT", () => handleShutdown("SIGINT"));

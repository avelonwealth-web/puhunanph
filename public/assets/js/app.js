import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { nowDateTime } from "./utils.js";
import { apiCompleteRegistrationProfile } from "./api.js";

export { auth, db };
const REF_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeReferralCode(length = 8) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += REF_CHARS[Math.floor(Math.random() * REF_CHARS.length)];
  }
  return out;
}

async function generateUniqueReferralCode(length = 8) {
  for (let i = 0; i < 30; i += 1) {
    const code = makeReferralCode(length);
    const snap = await getDoc(doc(db, "referralCodes", code));
    if (!snap.exists()) return code;
  }
  throw new Error("Failed to generate unique referral code.");
}

async function saveReferralCodeMap({ code, uid, mobile, isAdmin = false }) {
  await setDoc(doc(db, "referralCodes", code), {
    code,
    uid,
    mobile,
    isAdmin,
    createdAt: serverTimestamp()
  });
}

export function toEmailFromMobile(mobile) {
  const digits = mobile.replace(/\D/g, "");
  return `${digits}@puhunanph.app`;
}

export function requireAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    callback(user);
  });
}

export function requireGuest() {
  return onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = "dashboard.html";
  });
}

export async function loginMobile(mobile, password) {
  return signInWithEmailAndPassword(auth, toEmailFromMobile(mobile), password);
}

export async function adminQuickLogin(mobile, password) {
  const adminMobile = "09152444480";
  const adminPassword = "Matt@5494@";
  if (mobile !== adminMobile || password !== adminPassword) return false;

  try {
    await loginMobile(mobile, password);
    const uid = auth.currentUser?.uid;
    if (uid) {
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const join = nowDateTime();
        const referralCode = await generateUniqueReferralCode(8);
        await setDoc(ref, {
          uid,
          mobile,
          walletBalance: 0,
          depositBalance: 0,
          withdrawBalance: 0,
          referralCode,
          referredBy: null,
          level1: 0,
          level2: 0,
          level3: 0,
          joinDate: join.date,
          joinTime: join.time,
          isAdmin: true,
          isBanned: false
        });
        await saveReferralCodeMap({ code: referralCode, uid, mobile, isAdmin: true });
      } else {
        const user = snap.data();
        const updates = { isAdmin: true };
        if (!user?.referralCode || user.referralCode.length !== 8) {
          updates.referralCode = await generateUniqueReferralCode(8);
        }
        await updateDoc(ref, updates);
        if (updates.referralCode) {
          await saveReferralCodeMap({ code: updates.referralCode, uid, mobile, isAdmin: true });
        } else if (user?.referralCode) {
          await saveReferralCodeMap({ code: user.referralCode, uid, mobile, isAdmin: true });
        }
      }
    }
  } catch (error) {
    // Fallback when Firebase Auth provider/config is not ready.
    if (error?.code === "auth/configuration-not-found" || error?.code === "auth/api-key-not-valid.-please-pass-a-valid-api-key.") {
      localStorage.setItem("puhunanph_admin_bypass", "1");
      return true;
    }
    if (error?.code !== "auth/user-not-found" && error?.code !== "auth/invalid-credential") {
      throw error;
    }
    const cred = await createUserWithEmailAndPassword(auth, toEmailFromMobile(mobile), password);
    const join = nowDateTime();
    const referralCode = await generateUniqueReferralCode(8);
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      mobile,
      walletBalance: 0,
      depositBalance: 0,
      withdrawBalance: 0,
      referralCode,
      referredBy: null,
      level1: 0,
      level2: 0,
      level3: 0,
      joinDate: join.date,
      joinTime: join.time,
      isAdmin: true,
      isBanned: false
    });
    await saveReferralCodeMap({ code: referralCode, uid: cred.user.uid, mobile, isAdmin: true });
    await addLog(cred.user.uid, "admin", "Admin account auto-created via quick login");
  }
  return true;
}

export function hasAdminBypassSession() {
  return localStorage.getItem("puhunanph_admin_bypass") === "1";
}

export async function registerMobile({ mobile, password, referralCode }) {
  const refCode = (referralCode || "").trim().toUpperCase();
  if (refCode.length !== 8) throw new Error("Referral code must be 8 characters.");

  let inviterUid = null;
  try {
    const invSnap = await getDoc(doc(db, "referralCodes", refCode));
    if (!invSnap.exists()) throw new Error("Invalid invite/referral code.");
    inviterUid = invSnap.data().uid || null;
  } catch (error) {
    // Local bypass support while Firebase rules/auth are being finalized.
    if (error?.code === "permission-denied") {
      const bypassCode = localStorage.getItem("puhunanph_admin_bypass_refcode");
      if (bypassCode && bypassCode === refCode) {
        inviterUid = null;
      } else {
        throw new Error("Permission denied on referral lookup. Publish latest firestore.rules.");
      }
    } else {
      throw error;
    }
  }

  const cred = await createUserWithEmailAndPassword(auth, toEmailFromMobile(mobile), password);
  const join = nowDateTime();
  const myCode = await generateUniqueReferralCode(8);
  try {
    await setDoc(doc(db, "users", cred.user.uid), {
      uid: cred.user.uid,
      mobile,
      walletBalance: 0,
      depositBalance: 0,
      withdrawBalance: 0,
      referralCode: myCode,
      referredBy: inviterUid,
      level1: 0,
      level2: 0,
      level3: 0,
      joinDate: join.date,
      joinTime: join.time,
      isAdmin: false,
      isBanned: false
    });
    await saveReferralCodeMap({ code: myCode, uid: cred.user.uid, mobile, isAdmin: false });
    await addLog(cred.user.uid, "register", `Registered with inviter code ${refCode}`);
  } catch (error) {
    if (error?.code !== "permission-denied") throw error;
    const idToken = await cred.user.getIdToken();
    await apiCompleteRegistrationProfile(idToken, { mobile, referralCode: refCode });
  }
  return cred;
}

export async function logout() {
  localStorage.removeItem("puhunanph_admin_bypass");
  await signOut(auth).catch(() => null);
  window.location.href = "login.html";
}

export function streamUser(uid, callback) {
  return onSnapshot(doc(db, "users", uid), (snap) => callback(snap.data()));
}

export function streamCollection(path, constraints, callback) {
  const q = query(collection(db, path), ...constraints);
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

function draftDocRef(uid, key) {
  return doc(db, "drafts", `${uid}_${key}`);
}

export async function saveDraft(uid, key, data) {
  if (!uid || !key) return;
  await setDoc(draftDocRef(uid, key), {
    uid,
    key,
    data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

export function streamDraft(uid, key, callback) {
  if (!uid || !key) return () => {};
  return onSnapshot(draftDocRef(uid, key), (snap) => {
    if (!snap.exists()) return callback(null);
    callback(snap.data()?.data || null);
  });
}

export async function clearDraft(uid, key) {
  if (!uid || !key) return;
  await deleteDoc(draftDocRef(uid, key)).catch(() => null);
}

export async function addLog(userId, type, message, meta = {}) {
  const at = nowDateTime();
  await addDoc(collection(db, "logs"), {
    userId,
    type,
    message,
    ...meta,
    date: at.date,
    time: at.time,
    createdAt: serverTimestamp()
  });
}

export async function investProduct({ uid, product }) {
  const userRef = doc(db, "users", uid);
  await runTransaction(db, async (tx) => {
    const us = await tx.get(userRef);
    if (!us.exists()) throw new Error("User not found.");
    const user = us.data();
    const wallet = Number(user?.walletBalance || 0);
    const legacy = Number(user?.balance || 0);
    const effectiveWallet = wallet > 0 ? wallet : legacy;
    if (effectiveWallet < product.amount) throw new Error("Insufficient balance.");
    tx.update(userRef, {
      walletBalance: effectiveWallet - product.amount,
      balance: 0
    });

    const start = new Date();
    const end = new Date(start);
    end.setDate(start.getDate() + product.duration);

    const invRef = doc(collection(db, "investments"));
    tx.set(invRef, {
      userId: uid,
      product: product.name,
      amount: product.amount,
      profit: product.amount * product.rate,
      duration: product.duration,
      status: "active",
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      createdAt: serverTimestamp()
    });
  });

  await addLog(uid, "investment", `Invested in ${product.name}`, { amount: product.amount });
  // Do not block user investment when referral side-effects are denied by rules.
  try {
    await distributeReferralCommission(uid, product.amount);
  } catch (error) {
    if (error?.code !== "permission-denied") throw error;
  }
}

async function distributeReferralCommission(uid, amount) {
  const levels = [0.15, 0.05, 0.01];
  let currentId = uid;
  const baseUser = await getDoc(doc(db, "users", uid));
  const fromUserMobile = baseUser.exists() ? baseUser.data().mobile : "";
  const at = nowDateTime();
  for (let i = 0; i < levels.length; i += 1) {
    const userSnap = await getDoc(doc(db, "users", currentId));
    if (!userSnap.exists()) break;
    const parentId = userSnap.data().referredBy;
    if (!parentId) break;
    const commission = amount * levels[i];
    try {
      await updateDoc(doc(db, "users", parentId), {
        walletBalance: increment(commission),
        withdrawBalance: increment(commission)
      });
      await addDoc(collection(db, "referralCommissions"), {
        userId: parentId,
        fromUserId: currentId,
        fromUserMobile,
        level: i + 1,
        percent: levels[i],
        amount: commission,
        date: at.date,
        time: at.time,
        createdAt: serverTimestamp()
      });
      await addLog(parentId, "referral", `Level ${i + 1} commission earned`, { amount: commission });
    } catch (error) {
      if (error?.code !== "permission-denied") throw error;
      // Skip denied commission write on client-side rules.
    }
    currentId = parentId;
  }
}

export async function claimAdsReward(uid) {
  const today = new Date().toISOString().slice(0, 10);
  const qy = query(collection(db, "adsRewards"), where("userId", "==", uid), where("date", "==", today), limit(1));
  const qs = await getDocs(qy);
  if (!qs.empty) throw new Error("Ads reward already claimed today.");
  await addDoc(collection(db, "adsRewards"), { userId: uid, amount: 10, date: today, createdAt: serverTimestamp() });
  await updateDoc(doc(db, "users", uid), { walletBalance: increment(10) });
  await addLog(uid, "ads", "Claimed ads reward", { amount: 10 });
}

export async function adminAdjustBalance(uid, amountDelta, target = "walletBalance") {
  const allowedTargets = ["walletBalance", "depositBalance", "withdrawBalance"];
  const safeTarget = allowedTargets.includes(target) ? target : "walletBalance";
  await updateDoc(doc(db, "users", uid), {
    [safeTarget]: increment(amountDelta)
  });
  await addLog(uid, "admin", "Admin adjusted user funds", { amount: amountDelta, target: safeTarget });
}

export async function adminSetBan(uid, isBanned) {
  await updateDoc(doc(db, "users", uid), { isBanned });
  await addLog(uid, "admin", isBanned ? "User banned by admin" : "User unbanned by admin");
}

export async function adminDeleteUser(uid) {
  await deleteDoc(doc(db, "users", uid));
}

export async function adminApproveWithdraw(withdrawId) {
  await updateDoc(doc(db, "withdraws", withdrawId), { status: "approved" });
}

export async function createManualProduct(product) {
  await addDoc(collection(db, "products"), {
    ...product,
    createdAt: serverTimestamp()
  });
}

export async function upsertSystemSetting(key, value) {
  await setDoc(doc(db, "settings", key), { key, value, updatedAt: serverTimestamp() });
}

export async function ensureUserReferralCode(uid, length = 8) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const user = snap.data();
  if (user?.referralCode && user.referralCode.length === length) return user.referralCode;
  const code = await generateUniqueReferralCode(length);
  await updateDoc(ref, { referralCode: code });
  await saveReferralCodeMap({
    code,
    uid,
    mobile: user?.mobile || "",
    isAdmin: user?.isAdmin === true
  });
  return code;
}

export { collection, query, where, orderBy, limit, getDocs, updateDoc, doc };

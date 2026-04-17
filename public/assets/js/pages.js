import {
  claimAdsReward,
  auth,
  logout,
  requireAuth,
  hasAdminBypassSession,
  streamUser,
  streamCollection,
  collection,
  query,
  where,
  orderBy,
  adminAdjustBalance,
  adminSetBan,
  ensureUserReferralCode,
  saveDraft,
  streamDraft,
  clearDraft,
  limit
} from "./app.js";
import { PRODUCTS, getProductById } from "./products.js";
import { peso, maskMobile, getQuery, toast, notifySound } from "./utils.js";
import { investProduct, loginMobile, registerMobile, addLog, adminQuickLogin, db } from "./app.js";
import { doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  createPaymongoSource,
  requestWithdrawal,
  apiApproveWithdraw,
  apiDeleteUser,
  apiGetAdminFallbackData,
  apiInvest,
  apiAdminDeleteWithdraw,
  apiAdminDeleteInvestment,
  apiAdminDeleteLog,
  apiAdminDeleteDailyReward
} from "./api.js";

function setSupportButton() {
  const btn = document.getElementById("supportBtn");
  if (!btn) return;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M9.04 15.31 8.9 19.1c.42 0 .6-.18.83-.4l1.99-1.91 4.12 3.02c.76.42 1.29.2 1.49-.7l2.7-12.67.01-.01c.24-1.1-.4-1.53-1.14-1.26L2.9 11.24c-1.08.42-1.06 1.03-.18 1.3l4.08 1.27 9.48-5.93c.44-.29.84-.13.5.16z"/>
    </svg>
  `;
  btn.addEventListener("click", () =>
    window.open("https://t.me/PuhunanPH_Customer_Service_bot", "_blank", "noopener,noreferrer")
  );
}

function injectBrandHeader(page) {
  if (page === "index") return;
  const main = document.querySelector("main");
  if (!main) return;
  const wrap = document.createElement("div");
  wrap.className = "brand-header";
  wrap.innerHTML = `
    <img class="brand-logo" src="images/logo.png" alt="PuhunanPH logo" />
    <div>
      <div class="brand-name">PuhunanPH</div>
      <div class="brand-tagline">Investment Referral Platform</div>
    </div>
  `;
  main.before(wrap);
}

function renderBottomNav(activePath) {
  const nav = document.getElementById("bottomNav");
  if (!nav) return;
  const items = [
    { href: "dashboard.html", key: "HOME", icon: "🏠" },
    { href: "product.html?product=rice-01", key: "PRODUCT", icon: "🌾" },
    { href: "team.html", key: "TEAM", icon: "👥" },
    { href: "profile.html", key: "PROFILE", icon: "🧑" }
  ];
  nav.innerHTML = `
    ${items.map((item) => `
      <a class="${activePath === item.href.split("?")[0] ? "active" : ""} nav-item" href="${item.href}">
        <span class="nav-icon" aria-hidden="true">${item.icon}</span>
        <span>${item.key}</span>
      </a>
    `).join("")}
  `;
}

function setupAuthForms() {
  const loginForm = document.getElementById("loginForm");
  if (loginForm && loginForm.dataset.authBound !== "1") {
    loginForm.dataset.authBound = "1";

    const saved = JSON.parse(localStorage.getItem("puhunanph_saved_login") || "null");
    if (saved?.mobile) document.getElementById("mobile").value = saved.mobile;
    if (saved?.password) document.getElementById("password").value = saved.password;
    if (saved?.mobile || saved?.password) {
      const box = document.getElementById("rememberLogin");
      if (box) box.checked = true;
    }

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mobile = document.getElementById("mobile").value.trim();
      const password = document.getElementById("password").value.trim();
      const remember = document.getElementById("rememberLogin")?.checked;
      const submitBtn = loginForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.prevLabel = submitBtn.textContent;
        submitBtn.textContent = "Logging in...";
      }
      try {
        const isQuickAdmin = await adminQuickLogin(mobile, password);
        if (!isQuickAdmin) {
          await loginMobile(mobile, password);
        }
        if (remember) {
          try {
            localStorage.setItem("puhunanph_saved_login", JSON.stringify({ mobile, password }));
          } catch (_) {
            /* private mode / quota */
          }
        } else {
          localStorage.removeItem("puhunanph_saved_login");
        }
        window.location.href = isQuickAdmin ? "admin.html" : "dashboard.html";
      } catch (error) {
        if (error?.code === "auth/configuration-not-found") {
          toast("Firebase Auth is not configured. Enable Email/Password sign-in in Firebase console.");
        } else {
          toast(error.message);
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitBtn.dataset.prevLabel) {
            submitBtn.textContent = submitBtn.dataset.prevLabel;
            delete submitBtn.dataset.prevLabel;
          }
        }
      }
    });
  }

  const registerForm = document.getElementById("registerForm");
  if (registerForm && registerForm.dataset.authBound !== "1") {
    registerForm.dataset.authBound = "1";

    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mobile = document.getElementById("mobile").value.trim();
      const password = document.getElementById("password").value.trim();
      const confirmPassword = document.getElementById("confirmPassword").value.trim();
      const referralCode = document.getElementById("referralCode").value.trim().toUpperCase();
      if (!mobile || !password || !confirmPassword || !referralCode) return toast("All fields are required.");
      if (password !== confirmPassword) return toast("Passwords do not match.");
      const submitBtn = registerForm.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.prevLabel = submitBtn.textContent;
        submitBtn.textContent = "Creating account...";
      }
      try {
        await registerMobile({ mobile, password, referralCode });
        window.location.href = "dashboard.html";
      } catch (error) {
        if (error?.code === "permission-denied" || /Missing or insufficient permissions/i.test(error?.message || "")) {
          toast("Registration blocked by Firestore rules. Publish the latest firestore.rules first.");
        } else {
          toast(error.message);
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitBtn.dataset.prevLabel) {
            submitBtn.textContent = submitBtn.dataset.prevLabel;
            delete submitBtn.dataset.prevLabel;
          }
        }
      }
    });
  }

  document.querySelectorAll("[data-toggle-password]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      input.type = input.type === "password" ? "text" : "password";
    });
  });
}

function autosaveFormWithDraft({ uid, key, fields }) {
  const unsub = streamDraft(uid, key, (data) => {
    if (!data) return;
    fields.forEach((name) => {
      const el = document.getElementById(name);
      if (!el) return;
      if (document.activeElement === el) return;
      el.value = data[name] ?? el.value;
    });
  });

  let timer;
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const payload = {};
      fields.forEach((name) => {
        const el = document.getElementById(name);
        if (el) payload[name] = el.value;
      });
      saveDraft(uid, key, payload).catch(() => {});
    }, 450);
  };

  fields.forEach((name) => {
    const el = document.getElementById(name);
    if (!el) return;
    el.addEventListener("input", scheduleSave);
    el.addEventListener("change", scheduleSave);
  });

  return unsub;
}

function setupDashboard() {
  const cards = document.getElementById("productCards");
  if (!cards) return;
  const homeUserMobile = document.getElementById("homeUserMobile");
  const dashDepositBalance = document.getElementById("dashDepositBalance");
  const dashCommissionIncome = document.getElementById("dashCommissionIncome");
  const dashDailyIncome = document.getElementById("dashDailyIncome");
  const cardsData = PRODUCTS
    .filter((p) => p.amount >= 100 && p.amount <= 10000)
    .slice(0, 15);
  let currentUid = "";

  cards.innerHTML = cardsData.map((p, idx) => `
    <article class="card dashboard-card card-enter" style="--d:${idx * 70}ms">
      <div class="dashboard-card-head">
        <div class="dashboard-icon">${p.icon}</div>
        <div>
          <p class="muted">Product name</p>
          <h3>${p.name}</h3>
        </div>
      </div>
      <p><span class="muted">Investment amount:</span> <strong>${peso(p.amount)}</strong></p>
      <p><span class="muted">Profit rate:</span> <strong>${(p.rate * 100).toFixed(0)}% daily</strong></p>
      <p><span class="muted">Duration:</span> <strong>${p.duration} days</strong></p>
      <button class="btn btn-primary" data-invest="${p.id}">Invest Now</button>
    </article>
  `).join("");
  let liveWallet = 0;
  cards.addEventListener("click", async (e) => {
    const id = e.target.dataset.invest;
    if (!id) return;
    const picked = getProductById(id);
    if (!picked) return;
    if (!currentUid) return toast("Session not ready. Please wait.");
    if (liveWallet < Number(picked.amount || 0)) {
      toast("Insufficient wallet balance. Redirecting to deposit page.");
      window.location.href = "deposit.html";
      return;
    }
    try {
      await investProduct({ uid: currentUid, product: picked });
      toast("Investment successful.");
      window.location.href = `product.html?product=${id}`;
      return;
    } catch (error) {
      if (error?.code === "permission-denied" || /missing or insufficient permissions/i.test(error?.message || "")) {
        try {
          const idToken = await auth.currentUser?.getIdToken();
          if (!idToken) throw new Error("Session expired. Please login again.");
          await apiInvest(idToken, { product: picked });
          toast("Investment successful.");
          window.location.href = `product.html?product=${id}`;
          return;
        } catch (fallbackError) {
          toast(fallbackError.message);
          return;
        }
      }
      if (/insufficient balance/i.test(String(error?.message || ""))) {
        toast("Insufficient wallet balance. Redirecting to deposit page.");
        window.location.href = "deposit.html";
        return;
      }
      if (/still active|already active|reinvest/i.test(String(error?.message || ""))) {
        toast("This product is still ACTIVE.");
        window.location.href = `product.html?product=${id}`;
        return;
      }
      toast(error.message);
    }
  });

  const ads = document.getElementById("adsRewardBtn");
  requireAuth((u) => {
    currentUid = u.uid;
    streamUser(u.uid, (user) => {
      const wallet = Number(user?.walletBalance || 0);
      const legacy = Number(user?.balance || 0);
      liveWallet = wallet > 0 ? wallet : legacy;
      document.getElementById("walletBalance").textContent = peso(liveWallet);
      if (dashDepositBalance) dashDepositBalance.textContent = peso(Number(user?.depositBalance || 0));
      if (dashCommissionIncome) dashCommissionIncome.textContent = peso(Number(user?.commissionIncome || 0));
      if (dashDailyIncome) dashDailyIncome.textContent = peso(Number(user?.dailyProductIncome || 0));
      if (homeUserMobile) homeUserMobile.textContent = user?.mobile || "-";
    });
    ads?.addEventListener("click", async () => {
      try {
        await claimAdsReward(u.uid);
        notifySound();
        toast("You got PHP 10 ads reward.");
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function setupProductPage() {
  const wrap = document.getElementById("productView");
  if (!wrap) return;
  const product = getProductById(getQuery("product")) || PRODUCTS[0];
  wrap.innerHTML = `
    <div class="card">
      <h2>${product.icon} ${product.name}</h2>
      <p class="muted">Investment: ${peso(product.amount)}</p>
      <p class="muted">Profit: ${peso(product.amount * product.rate)} daily (10%)</p>
      <p class="muted">Duration: ${product.duration} days</p>
      <button id="confirmInvest" class="btn btn-primary">Confirm Invest</button>
    </div>
    <div class="card">
      <h3>Your Investments</h3>
      <div id="myInvestmentsList" class="grid"></div>
    </div>
  `;
  requireAuth((user) => {
    const investBtn = document.getElementById("confirmInvest");
    const listNode = document.getElementById("myInvestmentsList");
    const now = () => Date.now();
    const createdMs = (row) => {
      if (row?.createdAt?.seconds) return Number(row.createdAt.seconds) * 1000;
      const fallback = new Date(`${row?.date || ""} ${row?.time || ""}`.trim()).getTime();
      return Number.isFinite(fallback) ? fallback : 0;
    };
    const isExpiredRow = (row) => {
      if (String(row?.status || "").toLowerCase() === "completed" || String(row?.status || "").toLowerCase() === "expired") return true;
      const endTs = new Date(row?.endDate || "").getTime();
      if (!Number.isFinite(endTs)) return false;
      return endTs <= now();
    };

    streamCollection("investments", [
      where("userId", "==", user.uid)
    ], (rows) => {
      const sortedRows = [...rows].sort((a, b) => createdMs(b) - createdMs(a));
      const sameProductRows = sortedRows.filter((r) => String(r?.product || "") === String(product.name || ""));
      const isActive = sameProductRows.some((r) =>
        String(r?.status || "").toLowerCase() === "active" && !isExpiredRow(r)
      );
      if (investBtn) {
        investBtn.disabled = isActive;
        investBtn.textContent = isActive ? "ACTIVE" : "INVEST NOW";
      }

      if (listNode) {
        listNode.innerHTML = sortedRows.map((r) => {
          const expired = isExpiredRow(r);
          const icon = PRODUCTS.find((p) => p.name === r.product)?.icon || "🌾";
          const statusText = expired ? "Expired" : "Active";
          const when = r.createdAt?.seconds
            ? new Date(r.createdAt.seconds * 1000).toLocaleString("en-PH")
            : `${r.date || "-"} ${r.time || ""}`.trim();
          const badgeClass = expired ? "btn btn-outline" : "btn btn-primary";
          return `
            <article class="card">
              <p><strong>${icon} ${r.product || "-"}</strong></p>
              <p class="muted">Amount: ${peso(r.amount || 0)}</p>
              <p class="muted">Duration: ${Number(r.duration || 0)} days</p>
              <p class="muted">Date: ${when || "-"}</p>
              <button type="button" class="${badgeClass}" disabled>${statusText}</button>
            </article>
          `;
        }).join("") || "<p class=\"muted\">No investments yet.</p>";
      }
    });

    investBtn.addEventListener("click", async () => {
      try {
        await investProduct({ uid: user.uid, product });
        toast("Investment successful. Product is now active.");
      } catch (error) {
        if (error?.code === "permission-denied" || /missing or insufficient permissions/i.test(error?.message || "")) {
          try {
            const idToken = await auth.currentUser?.getIdToken();
            if (!idToken) throw new Error("Session expired. Please login again.");
            await apiInvest(idToken, { product });
            toast("Investment successful. Product is now active.");
            return;
          } catch (fallbackError) {
            toast(fallbackError.message);
            return;
          }
        }
        if ((error?.message || "").toLowerCase().includes("insufficient balance")) {
          toast("Insufficient balance. Redirecting to deposit page.");
          setTimeout(() => { window.location.href = "deposit.html"; }, 500);
          return;
        }
        toast(error.message);
      }
    });
  });
}

function setupProfilePage() {
  const profile = document.getElementById("profileData");
  if (!profile) return;
  requireAuth((u) => {
    streamUser(u.uid, (user) => {
      const link = `${window.location.origin}/register.html?ref=${user?.referralCode || ""}`;
      const wallet = Number(user?.walletBalance || 0);
      const legacy = Number(user?.balance || 0);
      const walletShown = wallet > 0 ? wallet : legacy;
      profile.innerHTML = `
        <div class="card grid">
          <h3>${user?.mobile || "-"}</h3>
          <div class="balance-grid grid grid-2">
            <article class="card balance-tile">
              <p class="muted">Wallet Balance</p>
              <p class="balance-tile-value">${peso(walletShown)}</p>
            </article>
            <article class="card balance-tile">
              <p class="muted">Deposit Balance</p>
              <p class="balance-tile-value">${peso(user?.depositBalance || 0)}</p>
            </article>
            <article class="card balance-tile">
              <p class="muted">Withdraw Balance</p>
              <p class="balance-tile-value">${peso(user?.withdrawBalance || 0)}</p>
            </article>
            <article class="card balance-tile">
              <p class="muted">Commission Income</p>
              <p class="balance-tile-value">${peso(user?.commissionIncome || 0)}</p>
            </article>
            <article class="card balance-tile balance-tile-wide">
              <p class="muted">Daily Product Income</p>
              <p class="balance-tile-value">${peso(user?.dailyProductIncome || 0)}</p>
            </article>
          </div>

          <div class="grid grid-2 quick-links">
            <a class="card quick-link-card" href="deposit.html">Deposit</a>
            <a class="card quick-link-card" href="withdraw.html">Withdraw</a>
            <a class="card quick-link-card" href="deposit-history.html">Transactions</a>
            <a class="card quick-link-card" href="logs.html">Logs</a>
          </div>

          <button class="btn btn-danger" id="logoutBtn">Logout</button>
          <p class="muted">Referral Link: ${link}</p>
          <button class="btn btn-outline" id="copyRefLink">Copy Referral Link</button>
          <p class="muted">Referral Code: ${user?.referralCode || "-"}</p>
          <button class="btn btn-outline" id="copyRefCode">Copy Referral Code</button>
        </div>
      `;
      document.getElementById("copyRefLink").onclick = async () => navigator.clipboard.writeText(link);
      document.getElementById("copyRefCode").onclick = async () => navigator.clipboard.writeText(user?.referralCode || "");
      document.getElementById("logoutBtn").onclick = logout;
    });
  });
}

function setupTeamPage() {
  const container = document.getElementById("teamWrap");
  if (!container) return;
  const linkNode = document.getElementById("teamReferralLink");
  const copyBtn = document.getElementById("copyTeamReferral");

  const levelRates = { 1: 0.15, 2: 0.05, 3: 0.01 };

  function renderLevel(lv, list) {
    const members = new Set(list.map((r) => r.fromUserId).filter(Boolean)).size;
    const totalCommission = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const membersEl = document.getElementById(`teamL${lv}Members`);
    const commissionEl = document.getElementById(`teamL${lv}Commission`);
    const panel = document.getElementById(`teamDownlines${lv}`);
    if (membersEl) membersEl.textContent = `Total members: ${members}`;
    if (commissionEl) commissionEl.textContent = `Total commission: ${peso(totalCommission)}`;

    if (!panel) return;
    const wasOpen = !panel.hasAttribute("hidden");
    const downlinesHtml = list.map((r) => {
      const pct = Number(r.percent || levelRates[lv] || 0.01);
      const totalDeposit = pct > 0 ? (Number(r.amount || 0) / pct) : Number(r.amount || 0);
      const d = r.createdAt?.seconds
        ? new Date(r.createdAt.seconds * 1000).toLocaleString("en-PH")
        : `${r.date || "-"} ${r.time || ""}`.trim();
      return `<p class="muted">${maskMobile(r.fromUserMobile || "09120000000")}/${d || "-"}/${peso(totalDeposit)}</p>`;
    }).join("") || "<p class=\"muted\">No downlines yet.</p>";
    panel.innerHTML = downlinesHtml;
    if (wasOpen) {
      const cardEl = container.querySelector(`[data-level-card="${lv}"]`);
      panel.removeAttribute("hidden");
      cardEl?.classList.add("open");
      cardEl?.querySelector(".team-level-head")?.setAttribute("aria-expanded", "true");
    }
  }

  if (!container.dataset.teamDelegated) {
    container.dataset.teamDelegated = "1";
    container.addEventListener("click", (e) => {
      const card = e.target.closest(".team-level-card");
      if (!card || !container.contains(card)) return;
      const lv = card.getAttribute("data-level-card");
      if (!lv) return;
      const panel = document.getElementById(`teamDownlines${lv}`);
      const headBtn = card.querySelector(`[data-level-toggle="${lv}"]`);
      if (!panel) return;

      const isHidden = panel.hasAttribute("hidden");
      container.querySelectorAll(".team-downlines").forEach((node) => node.setAttribute("hidden", ""));
      container.querySelectorAll(".team-level-card").forEach((node) => node.classList.remove("open"));
      container.querySelectorAll(".team-level-head").forEach((btn) => btn.setAttribute("aria-expanded", "false"));

      if (isHidden) {
        panel.removeAttribute("hidden");
        card.classList.add("open");
        headBtn?.setAttribute("aria-expanded", "true");
      }
    });
  }

  requireAuth((u) => {
    streamUser(u.uid, (user) => {
      const link = `${window.location.origin}/register.html?ref=${user?.referralCode || ""}`;
      if (linkNode) linkNode.textContent = link;
      if (copyBtn) {
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(link);
          toast("Referral link copied.");
        };
      }
    });
    streamCollection("referralCommissions", [where("userId", "==", u.uid), orderBy("createdAt", "desc")], (rows) => {
      [1, 2, 3].forEach((lv) => {
        renderLevel(lv, rows.filter((r) => r.level === lv));
      });
    });
  });
}

function setupDepositPage() {
  const form = document.getElementById("depositForm");
  if (!form) return;
  requireAuth((u) => {
    autosaveFormWithDraft({ uid: u.uid, key: "deposit_form", fields: ["amount"] });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector("button[type='submit']");
      const amount = Number(document.getElementById("amount").value);
      if (!amount || amount <= 0) return toast("Invalid amount.");
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Processing...";
        }
        const data = await createPaymongoSource({ uid: u.uid, amount });
        document.getElementById("qrWrap").innerHTML = `<p class="muted">Redirecting...</p><a href="${data.checkoutUrl}" target="_blank" rel="noopener">Tap here if not redirected</a>`;
        await clearDraft(u.uid, "deposit_form");
        // One-click flow: automatically open PayMongo checkout page.
        window.location.href = data.checkoutUrl;
      } catch (error) {
        toast(error.message);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Continue";
        }
      }
    });
  });
}

function setupWithdrawPage() {
  const form = document.getElementById("withdrawForm");
  if (!form) return;
  requireAuth((u) => {
    autosaveFormWithDraft({
      uid: u.uid,
      key: "withdraw_form",
      fields: ["accountName", "accountNumber", "amount"]
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (form.dataset.withdrawSubmitting === "1") return;
      const submitBtn = form.querySelector("button[type='submit']");
      const accountName = document.getElementById("accountName").value.trim();
      const accountNumber = document.getElementById("accountNumber").value.trim();
      const amount = Number(document.getElementById("amount").value);
      if (amount < 100) return toast("Minimum withdraw is PHP 100.");
      form.dataset.withdrawSubmitting = "1";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.prevLabel = submitBtn.textContent;
        submitBtn.textContent = "Submitting...";
      }
      try {
        const me = await new Promise((resolve) => {
          const unsub = streamUser(u.uid, (user) => {
            unsub();
            resolve(user || {});
          });
        });
        const data = await requestWithdrawal({
          uid: u.uid,
          mobileNumber: me.mobile || "",
          accountName,
          accountNumber,
          amount
        });
        if (!data?.duplicate) {
          await addLog(u.uid, "withdraw", "Withdraw request submitted", { amount });
        }
        await clearDraft(u.uid, "withdraw_form");
        toast(data?.duplicate ? "Withdraw request already received." : "Withdraw request submitted.");
        window.location.href = "profile.html";
      } catch (error) {
        toast(error.message);
      } finally {
        delete form.dataset.withdrawSubmitting;
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitBtn.dataset.prevLabel) {
            submitBtn.textContent = submitBtn.dataset.prevLabel;
            delete submitBtn.dataset.prevLabel;
          }
        }
      }
    });
  });
}

function createdAtRowMs(row) {
  const c = row?.createdAt;
  if (c && typeof c.toMillis === "function") return c.toMillis();
  if (c && typeof c.seconds === "number") return c.seconds * 1000;
  const fallback = new Date(`${row?.date || ""} ${row?.time || ""}`.trim()).getTime();
  return Number.isFinite(fallback) ? fallback : 0;
}

function setupTransactionsPage() {
  const node = document.getElementById("depositRows");
  if (!node) return;
  let deposits = [];
  let withdraws = [];
  const render = () => {
    const rows = [
      ...deposits.map((r) => ({ kind: "Deposit", ...r })),
      ...withdraws.map((r) => ({ kind: "Withdraw", ...r }))
    ].sort((a, b) => createdAtRowMs(b) - createdAtRowMs(a));
    node.innerHTML =
      rows
        .map((r) => {
          const when = [r.date, r.time].filter(Boolean).join(" ").trim() || "-";
          return `<tr><td>${r.kind}</td><td>${peso(r.amount)}</td><td>${when}</td><td>${r.status || "-"}</td></tr>`;
        })
        .join("") || "<tr><td colspan='4'>No records yet.</td></tr>";
  };
  requireAuth((u) => {
    streamCollection(
      "deposits",
      [where("userId", "==", u.uid), orderBy("createdAt", "desc"), limit(120)],
      (rows) => {
        deposits = rows;
        render();
      }
    );
    streamCollection(
      "withdraws",
      [where("userId", "==", u.uid), orderBy("createdAt", "desc"), limit(120)],
      (rows) => {
        withdraws = rows;
        render();
      }
    );
  });
}

function setupSimpleHistory(collectionName, targetId) {
  const node = document.getElementById(targetId);
  if (!node) return;
  requireAuth((u) => {
    streamCollection(
      collectionName,
      [where("userId", "==", u.uid), orderBy("createdAt", "desc"), limit(120)],
      (rows) => {
        node.innerHTML =
          rows
            .map((r) => `<tr><td>${peso(r.amount)}</td><td>${r.date || "-"}</td><td>${r.status || "-"}</td></tr>`)
            .join("") || "<tr><td colspan='3'>No records.</td></tr>";
      }
    );
  });
}

function setupLogsPage() {
  const target = document.getElementById("logsRows");
  if (!target) return;
  requireAuth((u) => {
    streamCollection(
      "logs",
      [where("userId", "==", u.uid), orderBy("createdAt", "desc"), limit(200)],
      (rows) => {
        target.innerHTML =
          rows.length > 0
            ? rows.map((r) => `<tr><td>${r.type || "-"}</td><td>${r.message || "-"}</td><td>${r.date || "-"} ${r.time || ""}</td></tr>`).join("")
            : "<tr><td colspan='3'>No logs yet.</td></tr>";
      }
    );
  });
}

function setupAdminPage() {
  const usersNode = document.getElementById("adminUsers");
  if (!usersNode) return;
  const adminInstallBtn = document.getElementById("adminInstallBtn");
  const adminLogoutBtn = document.getElementById("adminLogoutBtn");
  const codeNode = document.getElementById("adminReferralCode");
  const linkNode = document.getElementById("adminReferralLink");
  const copyCodeBtn = document.getElementById("copyAdminCode");
  const copyLinkBtn = document.getElementById("copyAdminLink");
  const withdrawNode = document.getElementById("adminWithdraws");
  const invNode = document.getElementById("adminInvestments");
  const dailyNode = document.getElementById("adminDailyRewards");
  const logsNode = document.getElementById("adminLogs");
  let deferredInstallPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (adminInstallBtn) adminInstallBtn.hidden = false;
  });

  adminInstallBtn?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      toast("Install prompt is not available on this device/browser yet.");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    adminInstallBtn.hidden = true;
  });

  if (adminLogoutBtn) {
    adminLogoutBtn.addEventListener("click", logout);
  }

  function userJoinedMs(u) {
    if (u?.createdAt?.seconds) return Number(u.createdAt.seconds) * 1000;
    const t = new Date(`${u?.joinDate || ""} ${u?.joinTime || ""}`.trim()).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  async function adminRemoveFirestoreDoc(collectionName, id, apiDelete) {
    if (hasAdminBypassSession()) {
      await apiDelete(id);
    } else {
      await deleteDoc(doc(db, collectionName, id));
    }
  }

  function renderAdminTables(rows) {
    const usersByUid = {};
    (rows.users || []).forEach((u) => { usersByUid[u.uid] = u; });
    const sortedUsers = [...(rows.users || [])].sort((a, b) => userJoinedMs(b) - userJoinedMs(a));
    usersNode.innerHTML = sortedUsers.map((r, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${r.mobile || "-"}</td>
        <td>${peso(r.walletBalance || 0)}</td>
        <td>${peso(r.depositBalance || 0)}</td>
        <td>${peso(r.withdrawBalance || 0)}</td>
        <td>${(r.joinDate || "-")} ${(r.joinTime || "")}</td>
        <td>${usersByUid[r.referredBy]?.mobile || "-"}</td>
        <td>
          <button class="btn btn-primary" data-add="${r.uid}">Add</button>
          <button class="btn btn-outline" data-deduct="${r.uid}">Deduct</button>
          <button class="btn btn-outline" data-ban="${r.uid}" data-state="${r.isBanned ? "1" : "0"}">${r.isBanned ? "Unban" : "Ban"}</button>
          <button type="button" class="btn btn-danger" data-delete="${r.uid}">Delete</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="8">No users found.</td></tr>`;

    if (withdrawNode) {
      withdrawNode.innerHTML = (rows.withdraws || []).map((r) =>
        `<tr><td>${r.mobileNumber || "-"}</td><td>${r.accountName || "-"}</td><td>${r.accountNumber || "-"}</td><td>${peso(r.amount || 0)}</td><td>${r.status || "-"}</td><td>${r.status === "pending" ? `<button class="btn btn-primary" data-approve="${r.id}">Approve</button> ` : ""}<button type="button" class="btn btn-danger" data-del-withdraw="${r.id}">Delete</button></td></tr>`
      ).join("") || `<tr><td colspan="6">No withdraw requests.</td></tr>`;
    }
    if (invNode) {
      invNode.innerHTML = (rows.investments || []).map((r) =>
        `<tr><td>${r.userMobile || usersByUid[r.userId]?.mobile || "-"}</td><td>${r.product}</td><td>${peso(r.amount)}</td><td>${r.duration} days</td><td>${r.status}</td><td><button type="button" class="btn btn-danger" data-del-investment="${r.id}">Delete</button></td></tr>`
      ).join("") || `<tr><td colspan="6">No investments.</td></tr>`;
    }
    if (logsNode) {
      logsNode.innerHTML = (rows.logs || []).slice(0, 200).map((r) =>
        `<tr><td>${r.userMobile || usersByUid[r.userId]?.mobile || "-"}</td><td>${r.type}</td><td>${r.message}</td><td>${r.date || "-"} ${r.time || ""}</td><td><button type="button" class="btn btn-danger" data-del-log="${r.id}">Delete</button></td></tr>`
      ).join("") || `<tr><td colspan="5">No logs.</td></tr>`;
    }
    if (dailyNode) {
      dailyNode.innerHTML = (rows.dailyRewards || []).slice(0, 200).map((r) =>
        `<tr><td>${r.userMobile || usersByUid[r.userId]?.mobile || "-"}</td><td>${r.investmentId}</td><td>${peso(r.amount)}</td><td>${r.date || "-"} ${r.time || ""}</td><td><button type="button" class="btn btn-danger" data-del-daily="${r.id}">Delete</button></td></tr>`
      ).join("") || `<tr><td colspan="5">No daily rewards.</td></tr>`;
    }
  }

  function setAdminReferralUI(code) {
    const finalCode = code || "-";
    const link = code ? `${window.location.origin}/register.html?ref=${code}` : "-";
    if (codeNode) codeNode.textContent = finalCode;
    if (linkNode) linkNode.textContent = link;
    if (copyCodeBtn) copyCodeBtn.onclick = async () => {
      if (!code || code === "-") return;
      await navigator.clipboard.writeText(code);
      toast("Admin referral code copied.");
    };
    if (copyLinkBtn) copyLinkBtn.onclick = async () => {
      if (!code || code === "-") return;
      await navigator.clipboard.writeText(link);
      toast("Admin referral link copied.");
    };
  }

  if (hasAdminBypassSession()) {
    let bypassCode = localStorage.getItem("puhunanph_admin_bypass_refcode");
    if (!bypassCode) {
      bypassCode = Math.random().toString(36).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8);
      localStorage.setItem("puhunanph_admin_bypass_refcode", bypassCode);
    }
    setAdminReferralUI(bypassCode);
    if (adminInstallBtn) adminInstallBtn.hidden = false;
    const loadFallback = async () => {
      try {
        const data = await apiGetAdminFallbackData(200);
        renderAdminTables(data);
      } catch (error) {
        usersNode.innerHTML = `<tr><td colspan="8">Failed to load admin data fallback. Run backend and set admin secret.</td></tr>`;
        if (withdrawNode) withdrawNode.innerHTML = `<tr><td colspan="6">No data.</td></tr>`;
        if (invNode) invNode.innerHTML = `<tr><td colspan="6">No data.</td></tr>`;
        if (dailyNode) dailyNode.innerHTML = `<tr><td colspan="5">No data.</td></tr>`;
        if (logsNode) logsNode.innerHTML = `<tr><td colspan="5">No data.</td></tr>`;
      }
    };
    loadFallback();
    setInterval(loadFallback, 7000);
    return;
  }

  requireAuth((u) => {
    streamUser(u.uid, (me) => {
      (async () => {
        const fixedCode = await ensureUserReferralCode(u.uid, 8);
        setAdminReferralUI(fixedCode || me?.referralCode || "");
      })();
      if (!me?.isAdmin) return (usersNode.innerHTML = "<p>Unauthorized.</p>");
      if (adminInstallBtn) adminInstallBtn.hidden = false;
      const current = { users: [], withdraws: [], investments: [], logs: [], dailyRewards: [] };
      streamCollection("users", [orderBy("joinDate", "desc")], (rows) => {
        current.users = rows;
        renderAdminTables(current);
      });
      streamCollection("withdraws", [orderBy("createdAt", "desc")], (rows) => {
        current.withdraws = rows;
        renderAdminTables(current);
      });
      streamCollection("investments", [orderBy("createdAt", "desc")], (rows) => {
        current.investments = rows;
        renderAdminTables(current);
      });
      streamCollection("logs", [orderBy("createdAt", "desc")], (rows) => {
        current.logs = rows;
        renderAdminTables(current);
      });
      streamCollection("dailyRewards", [orderBy("createdAt", "desc")], (rows) => {
        current.dailyRewards = rows;
        renderAdminTables(current);
      });
    });
  });

  usersNode.addEventListener("click", async (e) => {
    const addUid = e.target.dataset.add;
    const deductUid = e.target.dataset.deduct;
    const banUid = e.target.dataset.ban;
    const deleteUid = e.target.dataset.delete;
    try {
      if (addUid || deductUid) {
        const mode = addUid ? "add" : "deduct";
        const targetRaw = prompt("Choose target: wallet / deposit / withdraw", "wallet");
        if (targetRaw === null) return;
        const targetMap = {
          deposit: "depositBalance",
          wallet: "walletBalance",
          withdraw: "withdrawBalance"
        };
        const target = targetMap[String(targetRaw).trim().toLowerCase()];
        if (!target) return toast("Invalid target. Use wallet/deposit/withdraw.");
        const raw = prompt(`Enter amount to ${mode}:`, "0");
        if (raw === null) return;
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount <= 0) return toast("Invalid amount.");
        const signedAmount = mode === "deduct" ? -Math.abs(amount) : Math.abs(amount);
        await adminAdjustBalance(addUid || deductUid, signedAmount, target);
        notifySound();
        return toast(`User ${mode}ed successfully.`);
      }
      if (banUid) {
        await adminSetBan(banUid, e.target.dataset.state === "0");
        notifySound();
        return toast("User status updated.");
      }
      if (deleteUid) {
        if (!confirm("Delete this user?")) return;
        await apiDeleteUser(deleteUid);
        notifySound();
        return toast("User deleted.");
      }
    } catch (error) {
      toast(error.message);
    }
  });

  withdrawNode?.addEventListener("click", async (e) => {
    const delW = e.target.dataset.delWithdraw;
    if (delW) {
      if (!confirm("Delete this withdraw request?")) return;
      try {
        await adminRemoveFirestoreDoc("withdraws", delW, apiAdminDeleteWithdraw);
        notifySound();
        toast("Withdraw request deleted.");
      } catch (error) {
        toast(error.message);
      }
      return;
    }
    const wid = e.target.dataset.approve;
    if (!wid) return;
    try {
      await apiApproveWithdraw(wid);
      notifySound();
      toast("Withdraw approved.");
    } catch (error) {
      toast(error.message);
    }
  });

  invNode?.addEventListener("click", async (e) => {
    const id = e.target.dataset.delInvestment;
    if (!id) return;
    if (!confirm("Delete this investment record?")) return;
    try {
      await adminRemoveFirestoreDoc("investments", id, apiAdminDeleteInvestment);
      notifySound();
      toast("Investment deleted.");
    } catch (error) {
      toast(error.message);
    }
  });

  logsNode?.addEventListener("click", async (e) => {
    const id = e.target.dataset.delLog;
    if (!id) return;
    if (!confirm("Delete this log entry?")) return;
    try {
      await adminRemoveFirestoreDoc("logs", id, apiAdminDeleteLog);
      notifySound();
      toast("Log deleted.");
    } catch (error) {
      toast(error.message);
    }
  });

  dailyNode?.addEventListener("click", async (e) => {
    const id = e.target.dataset.delDaily;
    if (!id) return;
    if (!confirm("Delete this daily reward record?")) return;
    try {
      await adminRemoveFirestoreDoc("dailyRewards", id, apiAdminDeleteDailyReward);
      notifySound();
      toast("Daily reward deleted.");
    } catch (error) {
      toast(error.message);
    }
  });
}

function setupConnectionBanner() {
  // Disabled by request.
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const host = window.location.hostname;
  const isLocal = host === "127.0.0.1" || host === "localhost";
  if (isLocal) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
    return;
  }
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function boot() {
  const page = document.body.dataset.page;
  injectBrandHeader(page);
  setSupportButton();
  registerServiceWorker();
  renderBottomNav(`${page}.html`);
  setupAuthForms();
  if (page === "dashboard") setupDashboard();
  if (page === "product") setupProductPage();
  if (page === "team") setupTeamPage();
  if (page === "profile") setupProfilePage();
  if (page === "deposit") setupDepositPage();
  if (page === "withdraw") setupWithdrawPage();
  if (page === "deposit-history") setupTransactionsPage();
  if (page === "withdraw-history") setupSimpleHistory("withdraws", "withdrawRows");
  if (page === "logs") setupLogsPage();
  if (page === "admin") setupAdminPage();
}

boot();

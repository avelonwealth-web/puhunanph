import {
  claimAdsReward,
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
  createManualProduct,
  upsertSystemSetting,
  ensureUserReferralCode
} from "./app.js";
import { PRODUCTS, getProductById } from "./products.js";
import { peso, maskMobile, getQuery, toast, notifySound } from "./utils.js";
import { investProduct, loginMobile, registerMobile, addLog, adminQuickLogin } from "./app.js";
import { createPaymongoSource, requestWithdrawal, apiApproveWithdraw, apiDeleteUser, apiGetAdminFallbackData } from "./api.js";

function setSupportButton() {
  const btn = document.getElementById("supportBtn");
  if (!btn) return;
  btn.addEventListener("click", () => window.open("https://t.me/", "_blank"));
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
  nav.innerHTML = `
    <a class="${activePath === "dashboard.html" ? "active" : ""}" href="dashboard.html">Dashboard</a>
    <a class="${activePath === "team.html" ? "active" : ""}" href="team.html">Team</a>
    <a class="${activePath === "deposit.html" ? "active" : ""}" href="deposit.html">Deposit</a>
    <a class="${activePath === "profile.html" ? "active" : ""}" href="profile.html">Profile</a>
    <a class="${activePath === "logs.html" ? "active" : ""}" href="logs.html">Logs</a>
  `;
}

function setupAuthForms() {
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
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
      try {
        const isQuickAdmin = await adminQuickLogin(mobile, password);
        if (!isQuickAdmin) {
          await loginMobile(mobile, password);
        }
        if (remember) {
          const shouldSave = confirm("Save mobile number and password on this device?");
          if (shouldSave) {
            localStorage.setItem("puhunanph_saved_login", JSON.stringify({ mobile, password }));
          } else {
            localStorage.removeItem("puhunanph_saved_login");
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
      }
    });
  }

  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mobile = document.getElementById("mobile").value.trim();
      const password = document.getElementById("password").value.trim();
      const confirmPassword = document.getElementById("confirmPassword").value.trim();
      const referralCode = document.getElementById("referralCode").value.trim().toUpperCase();
      if (!mobile || !password || !confirmPassword || !referralCode) return toast("All fields are required.");
      if (password !== confirmPassword) return toast("Passwords do not match.");
      try {
        await registerMobile({ mobile, password, referralCode });
        window.location.href = "dashboard.html";
      } catch (error) {
        if (error?.code === "permission-denied" || /Missing or insufficient permissions/i.test(error?.message || "")) {
          toast("Registration blocked by Firestore rules. Publish the latest firestore.rules first.");
        } else {
          toast(error.message);
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

function setupDashboard() {
  const cards = document.getElementById("productCards");
  if (!cards) return;
  cards.innerHTML = PRODUCTS.map((p) => `
    <div class="card">
      <div class="badge">${p.icon} ${p.name}</div>
      <p class="muted">Amount: ${peso(p.amount)}</p>
      <p class="muted">Profit: ${(p.rate * 100).toFixed(0)}% daily</p>
      <p class="muted">Duration: ${p.duration} days</p>
      <button class="btn btn-primary" data-invest="${p.id}">Invest Now</button>
    </div>
  `).join("");
  cards.addEventListener("click", (e) => {
    const id = e.target.dataset.invest;
    if (id) window.location.href = `product.html?product=${id}`;
  });

  const ads = document.getElementById("adsRewardBtn");
  requireAuth((u) => {
    streamUser(u.uid, (user) => {
      document.getElementById("walletBalance").textContent = peso(user?.balance || 0);
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
  const product = getProductById(getQuery("product"));
  if (!product) {
    wrap.innerHTML = "<p>Product not found.</p>";
    return;
  }
  wrap.innerHTML = `
    <div class="card">
      <h2>${product.icon} ${product.name}</h2>
      <p class="muted">Investment: ${peso(product.amount)}</p>
      <p class="muted">Profit: ${peso(product.amount * product.rate)} daily (10%)</p>
      <p class="muted">Duration: ${product.duration} days</p>
      <button id="confirmInvest" class="btn btn-primary">Confirm Invest</button>
    </div>
  `;
  requireAuth((user) => {
    document.getElementById("confirmInvest").addEventListener("click", async () => {
      try {
        await investProduct({ uid: user.uid, product });
        toast("Investment successful.");
        window.location.href = "dashboard.html";
      } catch (error) {
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
      profile.innerHTML = `
        <div class="card grid">
          <h3>${user?.mobile || "-"}</h3>
          <p class="muted">Wallet Balance: ${peso(user?.walletBalance || 0)}</p>
          <p class="muted">Balance: ${peso(user?.balance || 0)}</p>
          <p class="muted">Deposit Balance: ${peso(user?.depositBalance || 0)}</p>
          <p class="muted">Withdraw Balance: ${peso(user?.withdrawBalance || 0)}</p>
          <p class="muted">Referral Link: ${link}</p>
          <button class="btn btn-outline" id="copyRefLink">Copy Referral Link</button>
          <p class="muted">Referral Code: ${user?.referralCode || "-"}</p>
          <button class="btn btn-outline" id="copyRefCode">Copy Referral Code</button>
          <button class="btn btn-danger" id="logoutBtn">Logout</button>
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
  requireAuth((u) => {
    streamCollection("referralCommissions", [where("userId", "==", u.uid), orderBy("createdAt", "desc")], (rows) => {
      const levelRows = [1, 2, 3].map((lv) => rows.filter((r) => r.level === lv));
      container.innerHTML = levelRows.map((list, idx) => {
        const lv = idx + 1;
        const rate = lv === 1 ? "15%" : lv === 2 ? "5%" : "2%";
        const total = list.reduce((s, r) => s + (r.amount || 0), 0);
        return `
          <details class="card">
            <summary><strong>Level ${lv}</strong> - ${rate}</summary>
            <p class="muted">Total members: ${list.length}</p>
            <p class="muted">Total commission: ${peso(total)}</p>
            <div>${list.map((r) => `<p class="muted">${maskMobile(r.fromUserMobile || "09XXXXXXXXX")} / ${r.amount}</p>`).join("") || "<p class='muted'>No downlines yet.</p>"}</div>
          </details>
        `;
      }).join("");
    });
  });
}

function setupDepositPage() {
  const form = document.getElementById("depositForm");
  if (!form) return;
  requireAuth((u) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById("amount").value);
      if (!amount || amount <= 0) return toast("Invalid amount.");
      try {
        const data = await createPaymongoSource({ uid: u.uid, amount });
        document.getElementById("qrWrap").innerHTML = `<p class="muted">Pay via QR URL:</p><a href="${data.checkoutUrl}" target="_blank">${data.checkoutUrl}</a>`;
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function setupWithdrawPage() {
  const form = document.getElementById("withdrawForm");
  if (!form) return;
  requireAuth((u) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const mobileNumber = document.getElementById("mobileNumber").value.trim();
      const accountNumber = document.getElementById("accountNumber").value.trim();
      const amount = Number(document.getElementById("amount").value);
      const hour = new Date().getHours();
      if (hour < 9 || hour >= 17) return toast("Withdraw time is 9AM to 5PM.");
      if (amount < 100) return toast("Minimum withdraw is PHP 100.");
      try {
        await requestWithdrawal({ uid: u.uid, mobileNumber, accountNumber, amount });
        await addLog(u.uid, "withdraw", "Withdraw request submitted", { amount });
        toast("Withdraw request submitted.");
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function setupSimpleHistory(collectionName, targetId) {
  const node = document.getElementById(targetId);
  if (!node) return;
  requireAuth((u) => {
    streamCollection(collectionName, [where("userId", "==", u.uid), orderBy("createdAt", "desc")], (rows) => {
      node.innerHTML = rows.map((r) => `<tr><td>${peso(r.amount)}</td><td>${r.date || "-"}</td><td>${r.status || "-"}</td></tr>`).join("") || "<tr><td colspan='3'>No records.</td></tr>";
    });
  });
}

function setupLogsPage() {
  const target = document.getElementById("logsRows");
  if (!target) return;
  requireAuth((u) => {
    streamCollection("logs", [where("userId", "==", u.uid), orderBy("createdAt", "desc")], (rows) => {
      target.innerHTML = rows.map((r) => `<tr><td>${r.type}</td><td>${r.message}</td><td>${r.date} ${r.time}</td></tr>`).join("");
    });
  });
}

function setupAdminPage() {
  const usersNode = document.getElementById("adminUsers");
  if (!usersNode) return;
  const codeNode = document.getElementById("adminReferralCode");
  const linkNode = document.getElementById("adminReferralLink");
  const copyCodeBtn = document.getElementById("copyAdminCode");
  const copyLinkBtn = document.getElementById("copyAdminLink");
  const withdrawNode = document.getElementById("adminWithdraws");
  const invNode = document.getElementById("adminInvestments");
  const dailyNode = document.getElementById("adminDailyRewards");
  const logsNode = document.getElementById("adminLogs");

  function renderAdminTables(rows) {
    usersNode.innerHTML = (rows.users || []).map((r) => `
      <tr>
        <td>${r.mobile || "-"}</td>
        <td>${peso(r.balance || 0)}</td>
        <td>${peso(r.depositBalance || 0)}</td>
        <td>${peso(r.withdrawBalance || 0)}</td>
        <td>${(r.joinDate || "-")} ${(r.joinTime || "")}</td>
        <td>${r.referredBy || "-"}</td>
        <td>
          <button class="btn btn-outline" data-adjust="${r.uid}">Adjust</button>
          <button class="btn btn-outline" data-ban="${r.uid}" data-state="${r.isBanned ? "1" : "0"}">${r.isBanned ? "Unban" : "Ban"}</button>
          <button class="btn btn-danger" data-delete="${r.uid}">Delete</button>
        </td>
      </tr>
    `).join("") || `<tr><td colspan="7">No users found.</td></tr>`;

    if (withdrawNode) {
      withdrawNode.innerHTML = (rows.withdraws || []).map((r) =>
        `<tr><td>${r.mobileNumber || "-"}</td><td>${r.accountNumber || "-"}</td><td>${peso(r.amount || 0)}</td><td>${r.status || "-"}</td><td>${r.status === "pending" ? `<button class="btn btn-primary" data-approve="${r.id}">Approve</button>` : ""}</td></tr>`
      ).join("") || `<tr><td colspan="5">No withdraw requests.</td></tr>`;
    }
    if (invNode) {
      invNode.innerHTML = (rows.investments || []).map((r) =>
        `<tr><td>${r.userId}</td><td>${r.product}</td><td>${peso(r.amount)}</td><td>${r.duration} days</td><td>${r.status}</td></tr>`
      ).join("") || `<tr><td colspan="5">No investments.</td></tr>`;
    }
    if (logsNode) {
      logsNode.innerHTML = (rows.logs || []).slice(0, 200).map((r) =>
        `<tr><td>${r.userId}</td><td>${r.type}</td><td>${r.message}</td><td>${r.date || "-"} ${r.time || ""}</td></tr>`
      ).join("") || `<tr><td colspan="4">No logs.</td></tr>`;
    }
    if (dailyNode) {
      dailyNode.innerHTML = (rows.dailyRewards || []).slice(0, 200).map((r) =>
        `<tr><td>${r.userId}</td><td>${r.investmentId}</td><td>${peso(r.amount)}</td><td>${r.date || "-"} ${r.time || ""}</td></tr>`
      ).join("") || `<tr><td colspan="4">No daily rewards.</td></tr>`;
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
    const loadFallback = async () => {
      try {
        const data = await apiGetAdminFallbackData(200);
        renderAdminTables(data);
      } catch (error) {
        usersNode.innerHTML = `<tr><td colspan="7">Failed to load admin data fallback. Run backend and set admin secret.</td></tr>`;
        if (withdrawNode) withdrawNode.innerHTML = `<tr><td colspan="5">No data.</td></tr>`;
        if (invNode) invNode.innerHTML = `<tr><td colspan="5">No data.</td></tr>`;
        if (dailyNode) dailyNode.innerHTML = `<tr><td colspan="4">No data.</td></tr>`;
        if (logsNode) logsNode.innerHTML = `<tr><td colspan="4">No data.</td></tr>`;
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
    const adjustUid = e.target.dataset.adjust;
    const banUid = e.target.dataset.ban;
    const deleteUid = e.target.dataset.delete;
    try {
      if (adjustUid) {
        const raw = prompt("Enter adjustment amount (negative to deduct):", "0");
        if (raw === null) return;
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount === 0) return toast("Invalid amount.");
        await adminAdjustBalance(adjustUid, amount);
        notifySound();
        return toast("Balance adjusted.");
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

  const addProductForm = document.getElementById("adminAddProductForm");
  addProductForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const product = {
      name: document.getElementById("newProductName").value.trim(),
      amount: Number(document.getElementById("newProductAmount").value),
      rate: Number(document.getElementById("newProductRate").value) / 100,
      duration: Number(document.getElementById("newProductDuration").value),
      icon: document.getElementById("newProductIcon").value.trim() || "🌱"
    };
    try {
      await createManualProduct(product);
      notifySound();
      toast("Product added.");
      addProductForm.reset();
    } catch (error) {
      toast(error.message);
    }
  });

  const settingsForm = document.getElementById("adminSettingsForm");
  settingsForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = document.getElementById("settingKey").value.trim();
    const value = document.getElementById("settingValue").value.trim();
    if (!key) return toast("Setting key is required.");
    try {
      await upsertSystemSetting(key, value);
      notifySound();
      toast("Setting saved.");
    } catch (error) {
      toast(error.message);
    }
  });
}

function setupConnectionBanner() {
  let node = document.getElementById("connectionBanner");
  if (!node) {
    node = document.createElement("div");
    node.id = "connectionBanner";
    node.style.position = "sticky";
    node.style.top = "0";
    node.style.zIndex = "9";
    node.style.padding = "8px 12px";
    node.style.fontSize = "12px";
    node.style.textAlign = "center";
    node.style.color = "#10311b";
    document.body.prepend(node);
  }
  const sync = () => {
    node.textContent = navigator.onLine ? "Online: realtime sync active" : "Offline mode: limited actions";
    node.style.background = navigator.onLine ? "#e6f8ed" : "#fff3cd";
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
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
  setupConnectionBanner();
  registerServiceWorker();
  renderBottomNav(`${page}.html`);
  setupAuthForms();
  if (page === "dashboard") setupDashboard();
  if (page === "product") setupProductPage();
  if (page === "team") setupTeamPage();
  if (page === "profile") setupProfilePage();
  if (page === "deposit") setupDepositPage();
  if (page === "withdraw") setupWithdrawPage();
  if (page === "deposit-history") setupSimpleHistory("deposits", "depositRows");
  if (page === "withdraw-history") setupSimpleHistory("withdraws", "withdrawRows");
  if (page === "logs") setupLogsPage();
  if (page === "admin") setupAdminPage();
}

boot();

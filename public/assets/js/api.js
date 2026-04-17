const isLocalhost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
const API_BASES = isLocalhost
  ? ["http://localhost:10000/api", "https://puhunanph.onrender.com/api"]
  : ["https://puhunanph.onrender.com/api"];
const ADMIN_SECRET = localStorage.getItem("adminSecret") || "";

async function fetchWithFallback(path, init) {
  let lastError = null;
  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${path}`, init);
      if (res.ok) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Request failed");
}

async function fetchPrimaryOnly(path, init) {
  const base = API_BASES[0];
  const res = await fetch(`${base}${path}`, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function createPaymongoSource(payload) {
  // No client retry for deposit creation to avoid duplicate sources.
  const res = await fetchPrimaryOnly(`/create-paymongo-source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Failed to create QR source.");
  return res.json();
}

export async function requestWithdrawal(payload) {
  const res = await fetchWithFallback(`/withdraw-request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Failed to submit withdrawal request.");
  return res.json();
}

export async function apiApproveWithdraw(withdrawId) {
  const res = await fetchWithFallback(`/admin/approve-withdraw/${withdrawId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": ADMIN_SECRET
    }
  });
  if (!res.ok) throw new Error("Failed to approve withdrawal.");
  return res.json();
}

export async function apiDeleteUser(uid) {
  const res = await fetchWithFallback(`/admin/delete-user/${uid}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": ADMIN_SECRET
    }
  });
  if (!res.ok) throw new Error("Failed to delete user.");
  return res.json();
}

export async function apiGetAdminFallbackData(limit = 200) {
  const res = await fetchWithFallback(`/admin/fallback-data?limit=${limit}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": ADMIN_SECRET
    }
  });
  if (!res.ok) throw new Error("Failed to load admin fallback data.");
  return res.json();
}

export async function apiCompleteRegistrationProfile(idToken, payload) {
  let lastError = null;
  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}/firebase/complete-registration`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = new Error(data.error || "Failed to complete registration.");
        continue;
      }
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Failed to complete registration.");
}

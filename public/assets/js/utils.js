export const peso = (v) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(v || 0);

export function nowDateTime() {
  const now = new Date();
  return {
    date: now.toLocaleDateString("en-PH"),
    time: now.toLocaleTimeString("en-PH")
  };
}

/** YYYY-MM-DD in Asia/Manila — daily ads cap, daily reward de-dupe, cron alignment. */
export function phDateKey(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

export function maskMobile(mobile = "") {
  if (mobile.length < 8) return mobile;
  return `${mobile.slice(0, 4)}****${mobile.slice(-3)}`;
}

export function getQuery(key) {
  return new URLSearchParams(window.location.search).get(key);
}

export function navigate(path) {
  window.location.href = path;
}

export function randomCode(prefix = "PH") {
  return `${prefix}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function toast(message) {
  const key = String(message || "");
  const now = Date.now();
  const lastMsg = window.__lastToastMessage || "";
  const lastAt = window.__lastToastAt || 0;
  if (key && lastMsg === key && now - lastAt < 1200) return;
  window.__lastToastMessage = key;
  window.__lastToastAt = now;

  let root = document.getElementById("toastRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "toastRoot";
    root.style.position = "fixed";
    root.style.top = "14px";
    root.style.right = "14px";
    root.style.zIndex = "9999";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.textContent = message;
  el.style.background = "rgba(16,49,27,0.95)";
  el.style.color = "#fff";
  el.style.padding = "10px 12px";
  el.style.marginBottom = "8px";
  el.style.borderRadius = "10px";
  el.style.boxShadow = "0 10px 20px rgba(0,0,0,0.14)";
  root.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

let audioCtx;
/** Plain text na madalas i-autolink ng Messenger (URL sa sariling linya, ASCII). */
export function referralShareClipboardText(url) {
  const u = String(url || "").trim();
  return `Join PuhunanPH - register here:\n${u}`;
}

/**
 * Mobile: system share sheet. Messenger often drops linkification when both `text` and `url`
 * are set; we try URL-only first, then plain-text body, then clipboard.
 */
export async function shareOrCopyReferral(url, toastFn) {
  const u = String(url || "").trim();
  if (!u) return;
  const clip = referralShareClipboardText(u);
  if (navigator.share) {
    try {
      await navigator.share({ title: "PuhunanPH", url: u });
      toastFn?.("Shared. Piliin ang Messenger; dapat clickable ang link.");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    try {
      await navigator.share({ title: "PuhunanPH", text: clip });
      toastFn?.("Shared. Kung plain text lang, i-paste ang URL sa bagong linya.");
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(clip);
    toastFn?.("Copied. I-paste sa Messenger — dapat clickable ang URL sa bagong linya.");
  } catch {
    try {
      await navigator.clipboard.writeText(u);
      toastFn?.("Link copied.");
    } catch {
      toastFn?.("Could not copy. Copy the link manually from the page.");
    }
  }
}

export function notifySound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 920;
    gain.gain.value = 0.02;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } catch (_) {
    // no-op
  }
}

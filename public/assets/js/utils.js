export const peso = (v) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(v || 0);

export function nowDateTime() {
  const now = new Date();
  return {
    date: now.toLocaleDateString("en-PH"),
    time: now.toLocaleTimeString("en-PH")
  };
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

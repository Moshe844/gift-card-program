let logoutTimer;
let inactivityEnabled = false;
const inactivityTime = 14 * 60 * 1000;

function showLogoutPopup() {
  document.getElementById("logoutModal")?.classList.remove("hidden");
}

async function logoutUser() {
  try { await fetch("/admin/logout", { method: "POST" }); } catch {}
  showLogoutPopup();
}

function resetTimer() {
  if (!inactivityEnabled) return;
  clearTimeout(logoutTimer);
  logoutTimer = setTimeout(logoutUser, inactivityTime);
}

function initInactivityLogout() {
  if (inactivityEnabled) return;
  inactivityEnabled = true;
  ["mousemove", "keypress", "click", "scroll", "touchstart"].forEach(event =>
    document.addEventListener(event, resetTimer, { passive: true })
  );
  resetTimer();
}

window.initInactivityLogout = initInactivityLogout;

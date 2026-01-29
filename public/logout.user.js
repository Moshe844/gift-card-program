let logoutTimer;
const inactivityTime = 14 * 60 * 1000; // 14 minute

function showLogoutPopup() {
  document.getElementById("logoutModal").classList.remove("hidden");
}

function logoutUser() {
  sessionStorage.removeItem("adminLoggedIn");
  showLogoutPopup();
}

function resetTimer() {
  clearTimeout(logoutTimer);
  logoutTimer = setTimeout(logoutUser, inactivityTime);
}

function initInactivityLogout() {
  if (sessionStorage.getItem("adminLoggedIn") !== "true") return;

  ["mousemove", "keypress", "click", "scroll"].forEach(event =>
    document.addEventListener(event, resetTimer)
  );

  resetTimer();
}

initInactivityLogout();

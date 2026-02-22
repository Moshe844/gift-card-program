let currentPhone = null;
let isUnmasked = false;
let maskedCardCache = null;

 const processingOverlay = document.getElementById("processingOverlay");
function goToGiftTools() {
    // Change the filename if yours is different:
    // gift-tools.html or admin-import.html etc.
    window.location.href = "/admin-import.html";
  }
function startProcessing() {
  processingOverlay.classList.remove("hidden");
}

function stopProcessing() {
  processingOverlay.classList.add("hidden");
}

    
    function showApp() {
      document.getElementById("loginContainer").classList.add("hidden");
      document.getElementById("appContainer").classList.remove("hidden");
      document.getElementById("topBar").classList.remove("hidden");
    }
    
    function signOut() {
      sessionStorage.removeItem("adminLoggedIn");
      location.reload();
    }
    
    async function signIn() {
      const user = document.getElementById("loginUser").value.trim();
      const pass = document.getElementById("loginPass").value;
      const err  = document.getElementById("loginError");
    
      err.textContent = "";
    
      if (!user || !pass) {
        err.textContent = "Username and PIN required";
        return;
      }
    
      try {
        const res = await fetch("/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: user, pin: pass })
        });
    
        const data = await res.json();
    
        if (!res.ok) {
          err.textContent = data.error || "Login failed";
          return;
        }
    
        sessionStorage.setItem("adminLoggedIn", "true");
        showApp();
        initInactivityLogout()// Start inactivity logout timer
    
      } catch (e) {
        console.error("Login fetch failed:", e);
        err.textContent = "Unable to reach server";
      }
    }
    
    async function lookup() {
      const phone = document.getElementById("phone").value.trim();
      const output = document.getElementById("output");
      const btn = document.getElementById("lookupBtn"); // Fix selector
    
      output.innerHTML = "";
    
      if (!phone) {
        output.innerHTML = `<div class="result err">Enter a phone number.</div>`;
        return;
      }
    
      btn.disabled = true;
      btn.style.backgroundColor = "Gray";
      btn.textContent = "Looking up...";
    
      try {
        const res = await fetch(`/admin/gift-by-phone?phone=${encodeURIComponent(phone)}`);
        const data = await res.json();
    
        if (!data.found) {
          output.innerHTML = `<div class="result err">${data.message}</div>`;
          return;
        }
    
        currentPhone = data.phone;
        maskedCardCache = data.maskedCard;
        isUnmasked = false;
    
        const displayTime = data.activatedAt
          ? new Intl.DateTimeFormat("en-US", {
              timeZone: "America/New_York",
              year: "numeric",
              month: "short",
              day: "2-digit",
              hour: "numeric",
              minute: "2-digit",
              hour12: true
            }).format(new Date(data.activatedAt))
          : "—";
    
        const isActive = data.status === "ACTIVE";
    
        output.innerHTML = `
          <div class="result ok">
            <div>
              <strong>Status:</strong>
              <span id="activateDeactivate">${data.status}</span>
              <button
                id="toggleActivation"
                class="inline-btn ${isActive ? "btn-deactivate" : "btn-activate"}"
                data-action="${isActive ? "deactivate" : "activate"}"
              >
                ${isActive ? "Deactivate" : "Activate"}
              </button>

            </div>
            <div><strong>Amount:</strong> $${data.amount}</div>
            <div>
              <strong>Gift Card:</strong>
              <span id="cardValue">${data.maskedCard}</span>
              <button id="toggleBtn" class="inline-btn">Show</button>
            </div>
            <div><strong>Balance:</strong> $${data.balance ?? "—"}</div>
            <div><strong>Activated At:</strong> ${displayTime}</div>
            <div><strong>Funding Status:</strong> ${data.fundingStatus}</div>
          </div>
        `;
    
      } catch {
        output.innerHTML = `<div class="result err">Lookup failed.</div>`;
      } finally {
        btn.disabled = false;
        btn.style.backgroundColor = "var(--primary)";
        btn.textContent = "Look Up";
      }
    }
    
    /* -------------------------------
       Event delegation for buttons
    -------------------------------- */
    const modal = document.getElementById("confirmModal");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalYes = document.getElementById("modalYes");
const modalNo = document.getElementById("modalNo");

document.getElementById("output").addEventListener("click", async (e) => {

// -------------------------
// ACTIVATE / DEACTIVATE
// -------------------------
if (e.target.id === "toggleActivation") {
  const action = e.target.dataset.action;

  modalTitle.textContent =
    action === "deactivate" ? "Deactivate Gift Card" : "Activate Gift Card";

  modalMessage.textContent =
    action === "deactivate"
      ? "Deactivating this card will also remove any remaining balance. Are you sure you want to continue?"
      : "Are you sure you want to activate this gift card?";

  modal.classList.remove("hidden");

  modalNo.onclick = () => {
    modal.classList.add("hidden");
  };

  modalYes.onclick = async () => {
    modal.classList.add("hidden"); // close confirm modal
    startProcessing();             // blur & lock page
    e.target.disabled = true;
  
    try {
      const res = await fetch("/admin/toggle-gift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: currentPhone, action })
      });
  
      const data = await res.json();
  
      stopProcessing(); // unblur BEFORE showing success
  
      modalTitle.textContent =
        action === "deactivate" ? "Gift Card Deactivated" : "Gift Card Activated";
  
      modalMessage.textContent = data.message || "Action completed successfully.";
  
      modalNo.classList.add("hidden");
      modalYes.textContent = "OK";
      modal.classList.remove("hidden");
  
      modalYes.onclick = () => {
        modal.classList.add("hidden");
        modalNo.classList.remove("hidden");
        modalYes.textContent = "Yes";
        lookup();
      };
  
    } catch {
      stopProcessing();
      alert("Action failed");
    } finally {
      e.target.disabled = false;
    }
  };
  

  return; // stop here, handled
}

// -------------------------
// MASK / UNMASK (SHOW)
// -------------------------
if (e.target.id === "toggleBtn") {
  const cardValueElem = document.getElementById("cardValue");
  const toggleBtn = e.target;

  if (isUnmasked) {
    cardValueElem.textContent = maskedCardCache;
    toggleBtn.textContent = "Show";
    isUnmasked = false;
  } else {
    openPinModal(currentPhone);
  }
}
});
  
    function handleToggle(phone) {
      openPinModal(phone);
    }
    
    function openPinModal(phone) {
      currentPhone = phone;
      document.getElementById("pinInput").value = "";
      document.getElementById("pinError").textContent = "";
      document.getElementById("pinModal").classList.remove("hidden");
    }
    
    function closePinModal() {
      document.getElementById("pinModal").classList.add("hidden");
    }
    
    async function confirmPin() {
      const pin = document.getElementById("pinInput").value;
      const err = document.getElementById("pinError");
    
      if (!pin) {
        err.textContent = "PIN required";
        return;
      }
    
      try {
        const res = await fetch("/admin/unmask-card", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: currentPhone, pin })
        });
    
        const data = await res.json();
    
        if (!res.ok) {
          err.textContent = data.error || "Invalid PIN";
          return;
        }
    
        document.getElementById("cardValue").textContent = data.fullCard;
        document.getElementById("toggleBtn").textContent = "Hide";
        isUnmasked = true;
        closePinModal();
    
      } catch {
        err.textContent = "Server error";
      }
    }

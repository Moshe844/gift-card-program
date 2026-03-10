/************************************************************
 * app.js (Admin Gift Lookup UI) — single OR multiple cards
 *
 * REQUIRED BACKEND CONTRACT (because phone is no longer unique):
 * 1) GET  /admin/gift-by-phone?phone=...
 *    - If 1 card: { found:true, phone:"...", card:{ id, maskedCard, amount, balance, status, fundingStatus, activatedAt } }
 *      OR return the card fields at top-level (we support both)
 *    - If multiple: { found:true, phone:"...", cards:[ {id,...}, {id,...} ] }
 *
 * 2) POST /admin/toggle-gift   body: { id:<giftRowId>, action:"activate"|"deactivate" }
 *
 * 3) POST /admin/unmask-card   body: { id:<giftRowId>, pin:"...." }  -> { fullCard:"...." }
 ************************************************************/

let currentPhone = null;

// per-card caches
const maskedCardById = {};   // { [id]: "6908********4875" }
const isUnmaskedById  = {};  // { [id]: true/false }
const fullCardById    = {};  // { [id]: "69081234..." } optional cache

const processingOverlay = document.getElementById("processingOverlay");

function goToGiftTools() {
  window.location.href = "/admin-import.html";
}

function startProcessing() {
  processingOverlay?.classList.remove("hidden");
}

function stopProcessing() {
  processingOverlay?.classList.add("hidden");
}

function showApp() {
  document.getElementById("loginContainer")?.classList.add("hidden");
  document.getElementById("appContainer")?.classList.remove("hidden");
  document.getElementById("topBar")?.classList.remove("hidden");
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
    if (typeof initInactivityLogout === "function") initInactivityLogout();

  } catch (e) {
    console.error("Login fetch failed:", e);
    err.textContent = "Unable to reach server";
  }
}

["loginUser", "loginPass"].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("keydown", e => {
    if (e.key === "Enter") signIn();
  });
});

function formatNY(dt) {
  if (!dt) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(dt));
}

function normalizeLookupResponse(data) {
  // Supports multiple shapes so you don’t have to perfectly match this today:
  // A) { found:true, phone, cards:[...] }
  // B) { found:true, phone, card:{...} }
  // C) { found:true, phone, ...cardFieldsAtTopLevel... }
  if (Array.isArray(data.cards)) return data.cards;

  if (data.card && typeof data.card === "object") return [data.card];

  // If it looks like a single-card object
  if (data.id || data.maskedCard || data.status || data.amount) return [data];

  return [];
}

function renderCardBlock(card, idx, total) {
  const id = Number(card.id);

  // REQUIRED for correct behavior (activate/deactivate/unmask must target a specific row)
  if (!id) {
    return `
      <div class="cardBlock">
        <div class="result err">
          Missing card id for this row. Backend must return "id".
        </div>
      </div>
    `;
  }

  const status = (card.status ?? "—");
  const fundingStatus = (card.fundingStatus ?? "UNKNOWN");
  const amount = (card.amount ?? "—");
  const balance = (card.balance ?? "—");
  const activatedAt = formatNY(card.activatedAt);

  const isActive = String(status).toUpperCase() === "ACTIVE";

  // cache masked
  if (typeof card.maskedCard === "string") {
    maskedCardById[id] = card.maskedCard;
  }

  const showingFull = !!isUnmaskedById[id];
  const cardShown = showingFull ? (fullCardById[id] || maskedCardById[id] || "********") : (maskedCardById[id] || "********");

  return `
    <div class="cardBlock" data-id="${id}">
      ${total > 1 ? `<div style="margin-bottom:6px;"><strong>Card ${idx + 1} of ${total}</strong></div>` : ""}

      <div>
        <strong>Status:</strong>
        <span class="statusText">${status}</span>

        <button
          class="inline-btn btn-toggle ${isActive ? "btn-deactivate" : "btn-activate"}"
          data-id="${id}"
          data-action="${isActive ? "deactivate" : "activate"}"
        >
          ${isActive ? "Deactivate" : "Activate"}
        </button>
      </div>

      <div><strong>Amount:</strong> $${amount}</div>

      <div>
        <strong>Gift Card:</strong>
        <span class="cardValue" id="cardValue-${id}">${cardShown}</span>

        <button
          class="inline-btn btn-showhide"
          data-id="${id}"
        >
          ${showingFull ? "Hide" : "Show"}
        </button>
      </div>

      <div><strong>Balance:</strong> $${balance}</div>
      <div><strong>Activated At:</strong> ${activatedAt}</div>
      <div><strong>Funding Status:</strong> ${fundingStatus}</div>
    </div>
  `;
}

async function lookup() {
  const phone = document.getElementById("phone").value.trim();
  const output = document.getElementById("output");
  const btn = document.getElementById("lookupBtn");

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
      output.innerHTML = `<div class="result err">${data.message || "Not found"}</div>`;
      return;
    }

    currentPhone = data.phone;

    const cards = normalizeLookupResponse(data);
    if (!cards.length) {
      output.innerHTML = `<div class="result err">No cards returned for this phone (backend response shape mismatch).</div>`;
      return;
    }

    let html = `<div class="result ok">`;

    // If multiple cards, show a header row
    if (cards.length > 1) {
      html += `
        <div style="margin-bottom:10px;">
          <strong>Phone:</strong> ${currentPhone}
          <span style="margin-left:12px;"><strong>Cards:</strong> ${cards.length}</span>
        </div>
      `;
    }

    cards.forEach((card, idx) => {
      html += renderCardBlock(card, idx, cards.length);
    });

    html += `</div>`;
    output.innerHTML = html;

  } catch (error) {
    console.error("Lookup error:", error);
    output.innerHTML = `<div class="result err">Lookup failed.</div>`;
  } finally {
    btn.disabled = false;
    btn.style.backgroundColor = "var(--primary)";
    btn.textContent = "Look Up";
  }
}

document.getElementById("phone").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    await lookup();
  }
});
/* -------------------------------
   Event delegation for buttons
-------------------------------- */
const modal = document.getElementById("confirmModal");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const modalYes = document.getElementById("modalYes");
const modalNo = document.getElementById("modalNo");

// PIN modal elements
const pinModal = document.getElementById("pinModal");
const pinInput = document.getElementById("pinInput");
const pinError = document.getElementById("pinError");

let pendingUnmaskId = null;

function openPinModalForId(id) {
  pendingUnmaskId = Number(id);
  pinInput.value = "";
  pinError.textContent = "";
  pinModal.classList.remove("hidden");
}

function closePinModal() {
  pinModal.classList.add("hidden");
  pendingUnmaskId = null;
}

async function confirmPin() {
  const pin = pinInput.value;
  if (!pin) {
    pinError.textContent = "PIN required";
    return;
  }
  if (!pendingUnmaskId) {
    pinError.textContent = "Missing card id";
    return;
  }

  try {
    const res = await fetch("/admin/unmask-card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: pendingUnmaskId, pin })
    });

    const data = await res.json();

    if (!res.ok) {
      pinError.textContent = data.error || "Invalid PIN";
      return;
    }

    fullCardById[pendingUnmaskId] = data.fullCard;
    isUnmaskedById[pendingUnmaskId] = true;

    const el = document.getElementById(`cardValue-${pendingUnmaskId}`);
    if (el) el.textContent = data.fullCard;

    const btn = document.querySelector(`button.btn-showhide[data-id="${pendingUnmaskId}"]`);
    if (btn) btn.textContent = "Hide";

    closePinModal();

  } catch (e) {
    console.error(e);
    pinError.textContent = "Server error";
  }
}

document.getElementById("pinInput").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    await confirmPin();
  }
});
document.getElementById("output").addEventListener("click", async (e) => {
  // ACTIVATE / DEACTIVATE (per card)
  const toggleBtn = e.target.closest("button.btn-toggle");
  if (toggleBtn) {
    const action = toggleBtn.dataset.action;
    const giftId = Number(toggleBtn.dataset.id);

    if (!giftId || !action) {
      alert("Missing card id/action on button. Please refresh.");
      return;
    }

    modalTitle.textContent =
      action === "deactivate" ? "Deactivate Gift Card" : "Activate Gift Card";

    modalMessage.textContent =
      action === "deactivate"
        ? "Deactivating this card will also remove any remaining balance. Are you sure you want to continue?"
        : "Are you sure you want to activate this gift card?";

    modal.classList.remove("hidden");

    // prevent stacking handlers
    modalNo.onclick = null;
    modalYes.onclick = null;

    modalNo.onclick = () => {
      modal.classList.add("hidden");
    };

    modalYes.onclick = async () => {
      modal.classList.add("hidden");
      startProcessing();
      toggleBtn.disabled = true;

      try {
        const res = await fetch("/admin/toggle-gift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: giftId, action })
        });

        const data = await res.json();

        stopProcessing();

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

      } catch (err) {
        console.error(err);
        stopProcessing();
        alert("Action failed");
      } finally {
        toggleBtn.disabled = false;
      }
    };

    return;
  }

  // SHOW / HIDE (per card)
  const showHideBtn = e.target.closest("button.btn-showhide");
  if (showHideBtn) {
    const giftId = Number(showHideBtn.dataset.id);
    if (!giftId) return;

    const el = document.getElementById(`cardValue-${giftId}`);

    // If currently showing full, hide immediately
    if (isUnmaskedById[giftId]) {
      isUnmaskedById[giftId] = false;
      if (el) el.textContent = maskedCardById[giftId] || "********";
      showHideBtn.textContent = "Show";
      return;
    }

    // Otherwise prompt for PIN and fetch full card
    openPinModalForId(giftId);
  }
});

// Expose these if your HTML uses onclick=""
window.lookup = lookup;
window.signIn = signIn;
window.signOut = signOut;
window.goToGiftTools = goToGiftTools;
window.startProcessing = startProcessing;
window.stopProcessing = stopProcessing;
window.closePinModal = closePinModal;
window.confirmPin = confirmPin;
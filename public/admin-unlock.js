async function unlockDevice() {
  const masterKey = prompt("Enter Master Unlock Key:");
  if (!masterKey) return;

  const targetIp = prompt("Enter IP to unlock:");
  if (!targetIp) return;

  const res = await fetch("/admin/unlock-ip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterKey, targetIp })
  });

  const data = await res.json();
  alert(data.message || data.error);
}

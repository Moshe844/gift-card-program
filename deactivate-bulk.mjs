const API_URL = "https://x1.cardknox.com/gatewayjson"
let deactivated = 0;
let alreadyInactive = 0;
let failed = 0;
const cards = [
 "6908955828256870",
"6908952043422528",
"6908950365555792",
"6908951546842653",
"6908957347473044",
"6908959200997341",
"6908951412387064",
"6908959040696632",
"6908957425649234"



  ];
  
 for (const card of cards) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      xKey: "theyadezerfund50c511d533c44ac6840208c005309d0",
      xVersion: "5.0.0",
      xSoftwareName: "IDTECH-TEST",
      xSoftwareVersion: "1.0",
      xCommand: "gift:activate",
      xCardNum: card
    })
  });

  const data = await res.json();

  if (data.xResult === "A") {
    deactivated++;
  } 
  else if (data.xError && data.xError.toLowerCase().includes("inactive")) {
    alreadyInactive++;
  } 
  else {
    failed++;
  }

  console.log(card, data.xStatus, data.xError);
}

console.log("------ SUMMARY ------");
console.log("Activated:", deactivated);
console.log("Already activated:", alreadyInactive);
console.log("Failed:", failed);
  
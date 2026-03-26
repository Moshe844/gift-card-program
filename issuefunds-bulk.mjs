const API_URL = "https://x1.cardknox.com/gatewayjson"
const API_KEY = "theyadezerfund50c511d533c44ac6840208c005309d0"

let issued = 0;
let failed = 0;

const cards = [
{ card: "6908955828256870", amount: "250.00" },
{ card: "6908952043422528", amount: "250.00" },
{ card: "6908950365555792", amount: "250.00" },
{ card: "6908951546842653", amount: "250.00" },
{ card: "6908957347473044", amount: "250.00" },
{ card: "6908959200997341", amount: "250.00" },
{ card: "6908951412387064", amount: "250.00" },
{ card: "6908959040696632", amount: "250.00" },
{ card: "6908957425649234", amount: "250.00" },
{ card: "6908950910980198", amount: "250.00" }
];

let checked = 0;
let zeroBalance = 0;

for (const item of cards) {

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      xKey: "theyadezerfund50c511d533c44ac6840208c005309d0",
      xVersion: "5.0.0",
      xSoftwareName: "IDTECH-TEST",
      xSoftwareVersion: "1.0",
      xCommand: "gift:issue",
      xCardNum: item.card,
      xAmount: item.amount
    })
  });

  const data = await res.json();

  if (data.xResult === "A") {
    issued++;
  } else {
    failed++;
  }

  console.log(item.card, item.amount, data.xStatus, data.xError);
}

console.log("------ SUMMARY ------");
console.log("Issued:", issued);
console.log("Failed:", failed);
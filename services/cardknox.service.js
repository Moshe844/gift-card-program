async function activateCard(cardNum) { 
    
        const r = await fetch("https://x1.cardknox.com/gatewayjson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            xCommand: "gift:activate",
            xVersion: "5.0.0",
            xSoftwareName: "SolaIVRGift",
            xSoftwareVersion: "1.0.0",
            xKey: process.env.CARDKNOX_KEY,
            xCardNum: cardNum
          })
        }).then(r => r.json());
      
        if (r.xResult !== "A") throw new Error(r.xError);
      }

async function issueFunds(cardNum, amount) { 
        const r = await fetch("https://x1.cardknox.com/gatewayjson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            xCommand: "gift:issue",
            xVersion: "5.0.0",
            xSoftwareName: "SolaIVRGift",
            xSoftwareVersion: "1.0.0",
            xKey: process.env.CARDKNOX_KEY,
            xAllowDuplicate: "TRUE",
            xCardNum: cardNum,
            xAmount: amount.toFixed(2)
          })
        }).then(r => r.json());
      
        if (r.xResult !== "A") {
          return {
            ok: false,
            fundingError: r.xError || "Funding failed",
            fundingErrorCode: r.xErrorCode || null
          };
          
        }
        
        const bal = await getGiftBalance(cardNum);
        return { ok: true, balance: Number(bal.xRemainingBalance) };
      } 

async function getGiftBalance(cardNum) { 
    const res = await fetch("https://x1.cardknox.com/gatewayjson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xCommand: "gift:balance",
          xVersion: "5.0.0",
          xSoftwareName: "SolaIVRGift",
          xSoftwareVersion: "1.0.0",
          xKey: process.env.CARDKNOX_KEY,
          xCardNum: cardNum
        
        })
      });
    
      const raw = await res.text();
      return JSON.parse(raw);
    
}
async function deactivateCard(cardNum) { 
        const res = await fetch("https://x1.cardknox.com/gatewayjson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            xCommand: "gift:deactivate",
            xVersion: "5.0.0",
            xSoftwareName: "SolaIVRGift",
            xSoftwareVersion: "1.0.0",
            xKey: process.env.CARDKNOX_KEY,
            xCardNum: cardNum
          })
        }).then(r => r.json());
      
        if (res.xResult !== "A") {
          throw new Error(res.xError || "Cardknox deactivate failed");
        }
      
        return true;
      } 

async function redeemGiftBalance(cardNum, amount) {
        const r = await fetch("https://x1.cardknox.com/gatewayjson", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            xCommand: "gift:redeem",
            xVersion: "5.0.0",
            xSoftwareName: "SolaIVRGift",
            xSoftwareVersion: "1.0.0",
            xKey: process.env.CARDKNOX_KEY,
            xCardNum: cardNum,
            xAmount: amount.toFixed(2)
          })
        }).then(r => r.json());
      
        if (r.xResult !== "A") {
          throw new Error(r.xError || "Redeem failed");
        }
      
        return true;
      }
      
     

module.exports = {
  activateCard,
  issueFunds,
  getGiftBalance,
  deactivateCard,
  redeemGiftBalance
};

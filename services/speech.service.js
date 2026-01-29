function twimlEscape(str = "") {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
  
  function splitAmount(amount) {
    const [dollars, cents] = Number(amount).toFixed(2).split(".");
    return { dollars, cents };
  }
  
  function numberToWords(num) {
    const ones = ["zero","one","two","three","four","five","six","seven","eight","nine"];
  const teens = ["ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

  if (num < 10) return ones[num];
  if (num >= 10 && num < 20) return teens[num-10];
  if (num < 100) {
    const t = Math.floor(num/10);
    const o = num % 10;
    return o === 0 ? tens[t] : `${tens[t]} ${ones[o]}`;
  }
  if (num < 1000) {
    const h = Math.floor(num/100);
    const remainder = num % 100;
    return remainder === 0 ? `${ones[h]} hundred` : `${ones[h]} hundred ${numberToWords(remainder)}`;
  }
  return num.toString(); // fallback for 1000+

  }
  
  function speakAmount(amount) {
    const { dollars, cents } = splitAmount(amount);

  // Convert number strings to integers
  const dollarNum = parseInt(dollars, 10);
  const centNum = parseInt(cents, 10);

  const spokenDollars = numberToWords(dollarNum);

  if (centNum === 0) {
    return `${spokenDollars} dollars`;
  }

  const spokenCents = numberToWords(centNum);
  return `${spokenDollars} dollars and ${spokenCents} cents`;
  }
  
  module.exports = {
    speakAmount,
    twimlEscape
  };
  
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true", // true for 465, false for 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendAdminLockoutEmail({ ip, username }) {
  const time = new Date().toISOString();

  await transporter.sendMail({
    from: `"Admin Security" <${process.env.SMTP_USER}>`,
    to: process.env.ALERT_EMAIL,
    subject: "🚨 ADMIN LOCKOUT ALERT",
    html: `
      <h2>Admin Lockout Triggered</h2>
      <p><strong>IP Address:</strong> ${ip}</p>
      <p><strong>Username Attempted:</strong> ${username}</p>
      <p><strong>Time:</strong> ${time}</p>
      <hr/>
      <p>This device has been locked after 3 failed login attempts.</p>
    `
  });
}

module.exports = { sendAdminLockoutEmail };

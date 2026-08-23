const express = require("express");
const path = require("path");
require("dotenv").config();

const ivrRoutes = require("./routes/ivr.routes");
const adminRoutes = require("./routes/admin.routes");
const bulkRoutes = require("./routes/bulk.routes");
const giftRoutes = require("./routes/gift.routes");
const { runMigration } = require("./scripts/migrate");

const app = express();
app.set("trust proxy", 1);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));

let activeRequests = 0;
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = Math.random().toString(36).slice(2, 10);
  activeRequests += 1;

  res.on("finish", () => {
    activeRequests -= 1;
    console.log(JSON.stringify({
      type: "request",
      reqId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      activeRequests
    }));
  });
  next();
});

app.use("/admin", adminRoutes);
app.use("/admin", bulkRoutes);
app.use("/", ivrRoutes);
app.use("/", giftRoutes);
app.use(express.static(path.join(__dirname, "public"), { etag: false, maxAge: 0 }));

app.use((error, _req, res, _next) => {
  console.error("Unhandled request error:", error.message);
  if (error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "CSV file is too large" });
  return res.status(500).json({ error: "Internal server error" });
});

function startServer(port = process.env.PORT || 3000) {
  return app.listen(port, () => {
    console.log(`Server running on ${port}`);
    if (process.env.NODE_ENV === "production" && !process.env.TWILIO_AUTH_TOKEN) {
      console.warn("TWILIO_AUTH_TOKEN is not set; webhook signature validation is disabled");
    }
  });
}

async function boot() {
  if (process.env.NODE_ENV === "production" && process.env.AUTO_MIGRATE !== "false") {
    console.log("Running production database integrity migration before startup...");
    await runMigration();
  }
  return startServer();
}

if (require.main === module) {
  boot().catch(error => {
    console.error("Server startup failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { app, startServer, boot };

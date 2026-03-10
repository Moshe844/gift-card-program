const express = require("express");
const path = require("path");
require("dotenv").config();

const ivrRoutes = require("./routes/ivr.routes");
const adminRoutes = require("./routes/admin.routes");
const bulkRoutes = require("./routes/bulk.routes");
const giftRoutes = require("./routes/gift.routes");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let activeRequests = 0;

app.use((req, res, next) => {
  const start = Date.now();
  activeRequests++;

  const reqId = Math.random().toString(36).slice(2, 10);

  console.log(JSON.stringify({
    type: "request_start",
    reqId,
    method: req.method,
    path: req.originalUrl,
    activeRequests
  }));

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    activeRequests--;

    console.log(JSON.stringify({
      type: "request_end",
      reqId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      activeRequests
    }));
  });

  next();
});

setInterval(() => {
  const mem = process.memoryUsage();

  console.log(JSON.stringify({
    type: "memory",
    rssMB: (mem.rss / 1024 / 1024).toFixed(1),
    heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(1),
    heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(1)
  }));
}, 60000);

app.use("/", ivrRoutes);
app.use("/admin", adminRoutes);
app.use("/admin", bulkRoutes);
app.use("/", giftRoutes);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

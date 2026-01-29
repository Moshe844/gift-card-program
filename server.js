const express = require("express");
const path = require("path");
require("dotenv").config();

const ivrRoutes = require("./routes/ivr.routes");
const adminRoutes = require("./routes/admin.routes");
const giftRoutes = require("./routes/gift.routes");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use("/", ivrRoutes);
app.use("/admin", adminRoutes);
app.use("/", giftRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

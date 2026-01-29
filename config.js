require("dotenv").config();

const BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://gift-card-program.onrender.com"
    : "http://localhost:3000";

module.exports = { BASE_URL };

const express = require("express");

const router = express.Router();

// Activation is intentionally no longer exposed as a public HTTP endpoint.
// The verified IVR calls the shared operation service directly, and admins use
// the authenticated /admin/activate-by-phone endpoint.
router.post("/activate-by-phone", (_req, res) => {
  return res.status(410).json({
    status: "DISABLED",
    message: "Use the verified IVR or authenticated admin API"
  });
});

module.exports = router;

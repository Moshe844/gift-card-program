console.error(
  "Direct bulk funding is disabled. Sign in to the admin site and use Bulk Activate & Fund, which verifies each database row and prevents duplicate funding."
);
process.exitCode = 1;

// Loads application/.env for database integration tests (Node >= 21.7).
try {
  process.loadEnvFile(".env");
} catch {
  // no .env: the tests skip themselves
}

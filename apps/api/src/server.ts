import "dotenv/config";
import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { loadEnv } from "./env.js";
import { createMailer } from "./mail/index.js";

async function main() {
  const env = loadEnv();
  const { db } = createDb(env.DATABASE_URL);
  const mailer = createMailer(env);
  const app = await buildApp({ db, mailer, env });

  await app.listen({ host: "0.0.0.0", port: env.PORT });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

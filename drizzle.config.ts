import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Drizzle Kit runs outside Next.js, so load the same local file explicitly.
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});

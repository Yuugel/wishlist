import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required before the Wishlist database client can be used.",
  );
}

type DatabaseGlobals = typeof globalThis & {
  wishlistPool?: Pool;
};

const databaseGlobals = globalThis as DatabaseGlobals;
const pool =
  databaseGlobals.wishlistPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  databaseGlobals.wishlistPool = pool;
}

export const db = drizzle({ client: pool });

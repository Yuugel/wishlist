import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type WishlistDatabase = ReturnType<typeof drizzle>;

type DatabaseGlobals = typeof globalThis & {
  wishlistPool?: Pool;
  wishlistDb?: WishlistDatabase;
};

const databaseGlobals = globalThis as DatabaseGlobals;

function getDatabase(): WishlistDatabase {
  if (databaseGlobals.wishlistDb) return databaseGlobals.wishlistDb;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required before the Wishlist database client can be used.",
    );
  }

  const pool =
    databaseGlobals.wishlistPool ??
    new Pool({
      connectionString: databaseUrl,
    });

  if (process.env.NODE_ENV !== "production") {
    databaseGlobals.wishlistPool = pool;
  }

  const database = drizzle({ client: pool });
  if (process.env.NODE_ENV !== "production") {
    databaseGlobals.wishlistDb = database;
  }

  return database;
}

/**
 * Keep importing server modules build-safe while still failing clearly when a
 * request actually tries to use the database without DATABASE_URL. The proxy
 * binds Drizzle methods to the lazily-created database instance.
 */
export const db = new Proxy({} as WishlistDatabase, {
  get(_target, property) {
    const database = getDatabase();
    const value = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

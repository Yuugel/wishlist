import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type WishlistDatabase = ReturnType<typeof drizzle>;

type DatabaseGlobals = typeof globalThis & {
  wishlistPool?: Pool;
  wishlistDb?: WishlistDatabase;
};

const databaseGlobals = globalThis as DatabaseGlobals;
let databaseInstance: WishlistDatabase | undefined;

function getDatabase(): WishlistDatabase {
  if (databaseInstance) return databaseInstance;
  if (databaseGlobals.wishlistDb) {
    databaseInstance = databaseGlobals.wishlistDb;
    return databaseInstance;
  }

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

  databaseInstance = drizzle({ client: pool });
  if (process.env.NODE_ENV !== "production") {
    databaseGlobals.wishlistDb = databaseInstance;
  }

  return databaseInstance;
}

/**
 * Keep route discovery and build-time imports free of a database connection.
 * The first actual query still fails clearly when DATABASE_URL is missing.
 */
export const db = new Proxy({} as WishlistDatabase, {
  get(_target, property) {
    const database = getDatabase();
    const value = Reflect.get(database, property);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

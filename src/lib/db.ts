import path from "node:path";
import { PrismaClient } from "@/generated/prisma/client";

function createClient() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

  if (url.startsWith("postgres")) {
    // Postgres path: also switch `provider` in prisma/schema.prisma and regenerate.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3");
  const file = url.replace(/^file:/, "");
  // turbopackIgnore keeps this dynamic path from forcing the entire project
  // (including public/) to be traced into the server bundle.
  const absolute = path.isAbsolute(file) ? file : path.join(/*turbopackIgnore: true*/ process.cwd(), file);
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${absolute}` }) });
}

// Bump when the schema changes. The dev singleton survives hot reloads, so
// without a versioned key it would keep using a client generated from the
// previous schema and reject the new columns.
const SCHEMA_VERSION = "20260917-source-commit";

type Client = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prismaClients?: Record<string, Client> };
const clients = globalForPrisma.prismaClients ?? (globalForPrisma.prismaClients = {});

export const db: Client = clients[SCHEMA_VERSION] ?? createClient();

if (process.env.NODE_ENV !== "production") clients[SCHEMA_VERSION] = db;

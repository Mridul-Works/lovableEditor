import "dotenv/config";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before seeding");
  }

  // Mirror src/lib/db.ts: the schema is Postgres-compatible, so seeding has to
  // work against Postgres too rather than hard-coding the SQLite adapter.
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const db = await (async () => {
    if (url.startsWith("postgres")) {
      const { PrismaPg } = await import("@prisma/adapter-pg");
      return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    }
    const file = url.replace(/^file:/, "");
    const absolute = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${absolute}` }) });
  })();

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await db.adminUser.upsert({
    where: { email },
    create: { email, passwordHash },
    update: { passwordHash },
  });
  console.log(`Seeded admin ${admin.email}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

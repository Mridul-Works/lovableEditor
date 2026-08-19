// Dev utility: delete all pages/fields/media rows (admin user is kept).
import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const file = url.replace(/^file:/, "");
  const absolute = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${absolute}` }) });
  const pages = await db.page.deleteMany();
  const media = await db.mediaAsset.deleteMany();
  console.log(`Deleted ${pages.count} pages, ${media.count} media assets`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

// E2E for the GitHub (Lovable) integration, against the mock GitHub API.
// Prereqs: mock-github.ts on :4599, app with GITHUB_API_BASE=http://127.0.0.1:4599
//   BASE=http://localhost:3005 npx tsx scripts/e2e-github.ts
import "dotenv/config";
import path from "node:path";
import { chromium } from "playwright";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const BASE = process.env.BASE ?? "http://localhost:3005";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin12345";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
}

function dbClient() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const file = url.replace(/^file:/, "");
  const absolute = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${absolute}` }) });
}

async function cleanup() {
  const db = dbClient();
  await db.page.deleteMany({ where: { route: "/estate" } });
  await db.setting.deleteMany({ where: { key: "github_token" } });
  await db.$disconnect();
}

async function main() {
  await cleanup(); // fresh start

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // login
  await page.goto(`${BASE}/admin/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/admin`);

  // 1. Projects page shows connect form when not connected
  await page.goto(`${BASE}/admin/projects`);
  check("connect form shown when disconnected", await page.locator('input[name="token"]').count() === 1);

  // 2. Bad token rejected
  await page.fill('input[name="token"]', "bad");
  await page.click('button:has-text("Connect GitHub")');
  await page.waitForSelector("text=/rejected the token|Bad credentials|401/i", { timeout: 20000 });
  check("bad token rejected", true);

  // 3. Good token connects and lists projects
  await page.fill('input[name="token"]', "test-token-123");
  await page.click('button:has-text("Connect GitHub")');
  await page.waitForSelector("text=estate-site", { timeout: 20000 });
  check("repo list shows the Lovable project", true);

  // 4. Repo detail lists page files with suggested route
  await page.click("text=estate-site");
  await page.waitForSelector("text=src/pages/Index.tsx", { timeout: 20000 });
  const routeInput = page.locator('input[name="route"]');
  check("route suggested from page filename", (await routeInput.inputValue()) === "/");

  // 5. Import to /estate
  await routeInput.fill("/estate");
  await page.click('button:has-text("Import")');
  await page.waitForSelector("text=/Imported → \\/estate/", { timeout: 60000 });
  const reportText = (await page.textContent("body")) ?? "";
  check("bundle report shows files bundled", /files bundled/.test(reportText));
  check("repo image asset uploaded", /1 assets uploaded/.test(reportText));

  // 6. Page renders with repo content, theme css, real image
  await page.goto(`${BASE}/estate`);
  const h1 = (await page.textContent("h1")) ?? "";
  check("imported page renders hero headline", h1.includes("Build wealth with premium real estate"), h1);
  const imgSrc = await page.evaluate(() => (document.querySelector("img[data-cms-field]") as HTMLImageElement)?.src ?? "");
  check("hero image is a real uploaded asset (not placeholder)", imgSrc.includes("/uploads/"), imgSrc);
  const primaryBg = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("section")).find((s) => s.className.includes("bg-primary"));
    return el ? getComputedStyle(el).backgroundColor : "none";
  });
  // src/index.css sets --primary to orange (24 95% 40%) inside @layer base —
  // verify the project theme beats the built-in defaults
  check("theme CSS from repo applied (orange primary)", /rgb\(199, 8[0-9], 5\)/.test(primaryBg), primaryBg);

  // tailwind.config.ts translation: custom gradient + shadow + color
  const heroStyles = await page.evaluate(() => {
    const hero = document.querySelector(".hero-section");
    const img = document.querySelector("img[data-cms-field]");
    const gold = document.querySelector(".text-gold");
    return {
      gradient: hero ? getComputedStyle(hero).backgroundImage : "none",
      shadow: img ? getComputedStyle(img).boxShadow : "none",
      goldColor: gold ? getComputedStyle(gold).color : "none",
    };
  });
  check("custom gradient from tailwind.config applied", heroStyles.gradient.includes("linear-gradient"), heroStyles.gradient);
  check("custom shadow from tailwind.config applied", heroStyles.shadow !== "none", heroStyles.shadow);
  check("custom color from tailwind.config applied", heroStyles.goldColor.startsWith("rgb("), heroStyles.goldColor);

  // shadcn Button defaults: variant classes come from our baked-in styles
  const buttonStyles = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const primary = buttons.find((b) => b.textContent?.includes("Start investing"));
    const outline = buttons.find((b) => b.textContent?.includes("Learn more"));
    return {
      primaryBg: primary ? getComputedStyle(primary).backgroundColor : "none",
      primaryPad: primary ? getComputedStyle(primary).paddingLeft : "0",
      outlineBorder: outline ? getComputedStyle(outline).borderTopWidth : "0",
    };
  });
  check("Button default variant styled (primary bg)", /rgb\(199, 8[0-9], 5\)/.test(buttonStyles.primaryBg), buttonStyles.primaryBg);
  check("Button size=lg padding applied", buttonStyles.primaryPad === "32px", buttonStyles.primaryPad);
  check("Button outline variant has border", buttonStyles.outlineBorder === "1px", buttonStyles.outlineBorder);

  // Google Fonts from index.html
  const hasFontImport = await page.evaluate(() =>
    Array.from(document.querySelectorAll("style")).some((s) => s.textContent?.includes("fonts.googleapis.com")),
  );
  check("google fonts import from index.html", hasFontImport);

  // 7. Edit a field, then Sync — edit must survive
  await page.goto(`${BASE}/admin`);
  await page.click("table >> text=Edit");
  await page.waitForSelector("text=SEO / Meta");
  const headline = page.locator('input[value*="Build wealth"]').last();
  await headline.fill("Edited before sync");
  await page.click("text=/Save all/");
  await page.waitForSelector("text=Saved — changes are live", { timeout: 20000 });

  await page.goto(`${BASE}/admin`);
  check("pages list shows GitHub badge", ((await page.textContent("table")) ?? "").includes("GitHub"));
  await page.click("table >> text=/^Sync$/");
  await page.waitForSelector("text=/Synced: kept/", { timeout: 60000 });
  check("sync reports kept fields", true);

  await page.goto(`${BASE}/estate`);
  const h1b = (await page.textContent("h1")) ?? "";
  check("edit survives GitHub sync", h1b.includes("Edited before sync"), h1b);

  await browser.close();
  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => undefined);
  process.exit(1);
});

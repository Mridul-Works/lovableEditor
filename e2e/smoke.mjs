// End-to-end smoke test. Covers the flows that unit tests cannot reach:
// session revocation (which spans the proxy, the layout and the database) and
// cache invalidation (which only misbehaves against a real Next server).
//
//   npm run test:e2e            # starts `next dev` itself
//   BASE_URL=... npm run test:e2e   # runs against a server you already started
//
// Requires a seeded admin (npm run db:seed) and at least one published page.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import "dotenv/config";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OWN_SERVER = !process.env.BASE_URL;

let failures = 0;
function check(name, pass, detail = "") {
  console.log(`${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`server at ${url} did not start within ${timeoutMs}ms`);
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // --- unauthenticated admin is redirected to the login screen -------------
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check("unauthenticated /admin redirects to login", page.url().includes("/admin/login"), page.url());

  // --- wrong credentials are rejected --------------------------------------
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', `${password}-wrong`);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  check("wrong password is rejected", page.url().includes("/admin/login"), page.url());

  // --- correct credentials sign in -----------------------------------------
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  check("correct password signs in", page.url().endsWith("/admin"), page.url());

  const cookie = (await ctx.cookies()).find((c) => c.name === "le_session");
  check("session cookie is httpOnly", Boolean(cookie?.httpOnly));
  const stolenToken = cookie?.value;

  // --- publishing state invalidates the public cache ------------------------
  const firstRoute = await page.evaluate(() => {
    const link = document.querySelector('a[href^="/"][target="_blank"]');
    return link ? link.getAttribute("href") : null;
  });

  if (firstRoute) {
    const publicLength = async () => {
      const anon = await browser.newContext();
      const p = await anon.newPage();
      await p.goto(BASE + firstRoute, { waitUntil: "networkidle" });
      const len = (await p.innerText("body")).length;
      await anon.close();
      return len;
    };

    const before = await publicLength();
    const row = page.locator("tr", { hasText: firstRoute }).first();
    await row.locator("text=Unpublish").first().click();
    await page.waitForTimeout(2500);
    const afterUnpublish = await publicLength();
    check(
      "unpublishing invalidates the public cache",
      afterUnpublish !== before,
      `${before} -> ${afterUnpublish} chars`,
    );

    await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    await page.locator("tr", { hasText: firstRoute }).first().locator("text=Publish").first().click();
    await page.waitForTimeout(2500);
    const afterPublish = await publicLength();
    check("republishing restores the page", afterPublish === before, `${afterPublish} chars`);
  } else {
    console.log("skip  cache invalidation — no published page to test against");
  }

  // --- signing out revokes the token, not just the cookie -------------------
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await page.click("text=Sign out");
  await page.waitForTimeout(2500);
  check("sign out returns to login", page.url().includes("/admin/login"), page.url());

  if (stolenToken) {
    const replay = await browser.newContext();
    await replay.addCookies([
      { name: "le_session", value: stolenToken, domain: new URL(BASE).hostname, path: "/" },
    ]);
    const replayPage = await replay.newPage();
    await replayPage.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
    check(
      "a token replayed after sign out is rejected",
      replayPage.url().includes("/admin/login"),
      replayPage.url(),
    );
    await replay.close();
  }

  await browser.close();
}

let server;
try {
  if (OWN_SERVER) {
    server = spawn("npm", ["run", "dev"], { stdio: "ignore", shell: true });
    await waitForServer(`${BASE}/admin/login`);
  }
  await main();
} catch (e) {
  console.error("e2e run failed:", e);
  failures++;
} finally {
  server?.kill();
}

console.log(failures === 0 ? "\nall e2e checks passed" : `\n${failures} e2e check(s) failed`);
process.exit(failures === 0 ? 0 : 1);

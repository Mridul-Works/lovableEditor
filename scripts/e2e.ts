// Acceptance test for LovableEditor. Drives the real app in a browser.
//   npx tsx scripts/e2e.ts
import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const BASE = "http://localhost:3000";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin12345";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
}

async function login(page: Page) {
  await page.goto(`${BASE}/admin/login`);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/admin`);
}

async function main() {
  const browser = await chromium.launch({ channel: "msedge", headless: true });

  // ---- Logged-out checks -------------------------------------------------
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();

  await anonPage.goto(`${BASE}/admin`);
  check("logged-out /admin redirects to login", anonPage.url().includes("/admin/login"));

  // ---- Login -------------------------------------------------------------
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page);
  check("admin login works", page.url() === `${BASE}/admin`);

  // ---- 1. Import the demo page to /demo ----------------------------------
  const source = readFileSync("fixtures/demo-page.tsx", "utf8");
  await page.goto(`${BASE}/admin/import`);
  await page.fill('input[name="route"]', "/demo");
  await page.fill('textarea[name="source"]', source);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Import complete", { timeout: 60000 });
  const reportText = await page.textContent("body");
  check("import report shows text/image fields", /Text fields/.test(reportText ?? ""));
  check("import report lists stripped handlers", /onClick/.test(reportText ?? ""));
  check("import report lists unknown components", /Button/.test(reportText ?? ""));

  // ---- 2. Renders at /demo (admin sees draft) -----------------------------
  await page.goto(`${BASE}/demo`);
  const h1 = await page.textContent("h1");
  check("hero headline renders", (h1 ?? "").includes("The trading desk your whole team will love"), `got: ${h1}`);
  check("draft banner shown to admin", (await page.textContent("body"))!.includes("Draft"));
  const svgCount = await page.locator("svg").count();
  check("lucide icons rendered as inline svg", svgCount >= 8, `got ${svgCount}`);
  const cardCount = await page.locator("text=Lightning fast").count();
  check("mapped feature cards expanded", cardCount === 1);
  const bgColor = await page.evaluate(() => {
    const el = document.querySelector("section.cta");
    return el ? getComputedStyle(el).backgroundColor : "none";
  });
  check("tailwind classes compiled (cta section has bg)", bgColor !== "none" && bgColor !== "rgba(0, 0, 0, 0)", bgColor);

  // ---- 6. Draft 404s publicly ---------------------------------------------
  const anonResp = await anonPage.goto(`${BASE}/demo`);
  check("draft page 404s for public", anonResp?.status() === 404, `got ${anonResp?.status()}`);

  // ---- Publish ------------------------------------------------------------
  await page.goto(`${BASE}/admin`);
  await page.click("text=Publish");
  await page.waitForSelector("text=Unpublish", { timeout: 15000 });
  const anonResp2 = await anonPage.goto(`${BASE}/demo`);
  check("published page 200 for public", anonResp2?.status() === 200, `got ${anonResp2?.status()}`);
  const anonH1 = await anonPage.textContent("h1");
  check("public sees headline", (anonH1 ?? "").includes("trading desk"));

  // ---- 3. Edit via admin editor: headline + hero image --------------------
  await page.goto(`${BASE}/admin`);
  await page.click("table >> text=Edit");
  await page.waitForSelector("text=SEO / Meta");
  // headline input: find the input whose value contains the headline
  const headlineInput = page.locator('input[value*="The trading desk"]').last();
  await headlineInput.fill("Edited headline from the CMS");
  // hero image: upload a PNG into the first IMAGE field ("Replace (upload)")
  const pngBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC",
    "base64",
  );
  const fileInputs = page.locator('section:has-text("Hero") input[type="file"]');
  await fileInputs.first().setInputFiles({ name: "hero-replacement.png", mimeType: "image/png", buffer: pngBuffer });
  await page.waitForFunction(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs.some((i) => i.src.includes("/uploads/"));
  }, undefined, { timeout: 20000 });
  await page.click("text=/Save all/");
  await page.waitForSelector("text=Saved — changes are live", { timeout: 20000 });

  const anonResp3 = await anonPage.goto(`${BASE}/demo`);
  check("edited page still 200", anonResp3?.status() === 200);
  const anonH1b = await anonPage.textContent("h1");
  check("headline edit live for public", (anonH1b ?? "").includes("Edited headline from the CMS"), `got: ${anonH1b}`);
  const heroImgSrc = await anonPage.evaluate(
    () => (document.querySelector("[data-cms-field^='hero-img'], section img") as HTMLImageElement)?.src ?? "",
  );
  check("hero image replaced and live", heroImgSrc.includes("/uploads/"), heroImgSrc);

  // ---- 4. Inline edit mode -------------------------------------------------
  await page.goto(`${BASE}/demo?edit=1`);
  await page.waitForSelector("text=Edit mode");
  const headlineEl = page.locator("h1[data-cms-field]");
  await headlineEl.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Inline edited headline");
  await page.locator("body").click({ position: { x: 5, y: 300 } }); // blur
  await page.waitForSelector("text=1 unsaved change");
  await page.click("text=Save all");
  await page.waitForURL(/\/demo\?edit=1/, { timeout: 20000 });
  const anonH1c = await (await anonPage.goto(`${BASE}/demo`), anonPage.textContent("h1"));
  check("inline edit live for public", (anonH1c ?? "").includes("Inline edited headline"), `got: ${anonH1c}`);

  // ---- edit=1 as logged-out does nothing ----------------------------------
  await anonPage.goto(`${BASE}/demo?edit=1`);
  const overlayCount = await anonPage.locator("text=Edit mode").count();
  check("edit=1 inert when logged out", overlayCount === 0);

  // ---- 5. Re-import modified version ---------------------------------------
  const modified = source
    .replace("Book a demo", "Talk to sales")                          // changed text → new field, old orphaned
    .replace(
      '<p className="mt-4 text-sm text-muted-foreground">No credit card required · Free 14-day trial</p>',
      "",                                                              // removed → orphaned
    )
    .replace(
      "Join 2,400+ teams already running their desk on TradeFlow.",
      "Join 2,400+ teams already running their desk on TradeFlow. SOC 2 compliant.", // changed → new + orphan
    );
  await page.goto(`${BASE}/admin/import`);
  await page.fill('input[name="route"]', "/demo");
  await page.fill('textarea[name="source"]', modified);
  await page.click('button[type="submit"]');
  await page.waitForSelector("text=Re-import complete", { timeout: 60000 });
  const reText = (await page.textContent("body")) ?? "";
  check("re-import report shows kept/added/orphaned", /Kept \(edits preserved\)/.test(reText));

  const anonH1d = await (await anonPage.goto(`${BASE}/demo`), anonPage.textContent("h1"));
  check("previous edits survive re-import", (anonH1d ?? "").includes("Inline edited headline"), `got: ${anonH1d}`);
  const bodyText = (await anonPage.textContent("body")) ?? "";
  check("new content appears after re-import", bodyText.includes("Talk to sales"));
  check("removed content gone after re-import", !bodyText.includes("No credit card required"));
  const heroStill = await anonPage.evaluate(
    () => (document.querySelector("img[data-cms-field]") as HTMLImageElement)?.src ?? "",
  );
  check("replaced hero image survives re-import", heroStill.includes("/uploads/"), heroStill);

  // orphaned flagged in editor
  await page.goto(`${BASE}/admin`);
  await page.click("table >> text=Edit");
  await page.waitForSelector("text=SEO / Meta");
  const editorText = (await page.textContent("body")) ?? "";
  check("orphaned fields flagged in editor", editorText.includes("Orphaned fields"));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

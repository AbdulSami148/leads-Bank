/**
 * One-off browser check for the "View activity" navigation bug.
 * Uses playwright-core with the system Edge binary (headless).
 */
const { chromium } = require("playwright-core");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.env.BASE_URL || "http://localhost:3000";

const ADMIN_EMAIL = process.argv[2];
const PASSWORD = process.argv[3];
const USER_ID = process.argv[4];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
  });

  // 1. log in as the admin
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000); // let React hydrate so onSubmit prevents the native GET submit
  await page.fill("#email", ADMIN_EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  try {
    await page.waitForURL("**/admin", { timeout: 20000 });
  } catch {
    // Show why: URL + any visible error text + console errors, then retry once.
    console.log("login did not reach /admin. URL:", page.url());
    console.log("body:", (await page.textContent("body"))?.slice(0, 400));
    console.log("console errors so far:", consoleErrors.length ? consoleErrors : "none");
    await page.waitForTimeout(2000);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await page.fill("#email", ADMIN_EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL("**/admin", { timeout: 20000 });
  }
  console.log("after login URL:", page.url());

  // 2. read the first "View activity" link target
  await page.waitForSelector("text=View activity", { timeout: 20000 });
  const href = await page.getAttribute("text=View activity >> nth=0", "href");
  console.log("view activity href:", href);

  // 3. click it and watch where we end up
  await page.click("text=View activity >> nth=0");
  await page.waitForTimeout(4000); // give the guard + fetch time to settle
  console.log("after click URL:", page.url());
  console.log(
    "activity page visible:",
    await page.isVisible("text=Daily history"),
    await page.isVisible("text=Recent jobs"),
  );

  // 4. direct navigation to the activity page for the known user id
  await page.goto(`${BASE}/admin/users/${USER_ID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  console.log("direct nav URL:", page.url());
  const body = await page.textContent("body");
  console.log(
    "direct nav shows status card:",
    body.includes("Daily quota") && body.includes("Used today") && body.includes("Remaining"),
  );
  console.log("direct nav shows history+jobs:", body.includes("Daily history"), body.includes("Recent jobs"));
  console.log("redirected to admin list:", page.url().endsWith("/admin"));

  console.log("console errors:", consoleErrors.length ? consoleErrors : "none");
  await browser.close();
})().catch((error) => {
  console.error("BROWSER CHECK FAILED:", error.message);
  process.exit(1);
});

// Run against a local QA service with synthetic analytics/admin environment values.
// Both Cloudflare endpoints are intercepted; this test sends no external analytics.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const origin = "http://127.0.0.1:10000";

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      httpCredentials: { username: "admin", password: process.env.ADMIN_PASSWORD, origin },
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const external = [];
    await context.route("https://static.cloudflareinsights.com/beacon.min.js", (route) => route.fulfill({
      contentType: "application/javascript",
      body: `window.qaBeacon = JSON.parse(document.querySelector('[data-cf-beacon]').dataset.cfBeacon);
        fetch('https://cloudflareinsights.com/cdn-cgi/rum', {method:'POST', body:'synthetic QA beacon'})
          .then(() => window.qaBeaconSent = true);`,
    }));
    await context.route("https://cloudflareinsights.com/cdn-cgi/rum", (route) => route.fulfill({
      status: 200, body: "", headers: { "Access-Control-Allow-Origin": "*" },
    }));
    context.on("request", (request) => {
      if (request.url().startsWith("http") && new URL(request.url()).origin !== origin &&
          !["https://static.cloudflareinsights.com/beacon.min.js", "https://cloudflareinsights.com/cdn-cgi/rum"].includes(request.url())) {
        external.push(request.url());
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.qaCspErrors = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        window.qaCspErrors.push(event.violatedDirective);
      });
    });
    for (const path of ["/", "/tools/rotate-pdf", "/about", "/terms-and-privacy", "/admin/stats", "/missing"]) {
      const response = await page.goto(origin + path);
      assert.equal(response.status(), path === "/missing" ? 404 : 200);
      await page.waitForFunction(() => window.qaBeaconSent);
      assert.equal(await page.locator("script[data-cf-beacon]").count(), 1);
      assert.equal(await page.evaluate(() => window.qaBeacon.token), process.env.CF_ANALYTICS_TOKEN);
      assert.deepEqual(await page.evaluate(() => window.qaCspErrors), []);
    }
    await page.goto(origin + "/admin/stats");
    const before = (await page.locator(".stats-summary dd").allTextContents()).map(Number);
    assert.equal(await page.locator("tbody tr").count(), 53);
    for (const viewport of [{width:375,height:812}, {width:1440,height:1000}]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    }
    await page.goto(origin + "/tools/rotate-pdf");
    await page.locator('main input[type="file"]').first().setInputFiles({
      name: "synthetic-private-name.pdf", mimeType: "application/pdf", buffer: Buffer.from("invalid synthetic PDF"),
    });
    const processed = page.waitForResponse((response) => response.request().method() === "POST" && response.url() === origin + "/tools/rotate-pdf");
    await page.getByRole("button", {name: /Execute Rotate PDF/}).click();
    assert.equal((await processed).status(), 422);
    await page.getByRole("alert").waitFor();
    await page.goto(origin + "/admin/stats");
    const after = (await page.locator(".stats-summary dd").allTextContents()).map(Number);
    assert.deepEqual(after, [before[0] + 1, before[1], before[2] + 1]);
    const unauthorized = await browser.newContext();
    const denied = await unauthorized.request.get(origin + "/admin/stats");
    assert.equal(denied.status(), 401);
    assert.ok(!(await denied.text()).includes("Total uses per tool"));
    await unauthorized.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log("PASS optional beacon on every page, script/connect CSP, private responsive stats and real failed-tool counting");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

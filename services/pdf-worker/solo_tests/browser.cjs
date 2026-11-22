// Run with playwright-core and Chromium in a separate Docker QA client sharing the trial instance's network.
const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const origin = "http://127.0.0.1:10000";
const fixture = fs.readFileSync("/qa/fixture.pdf");
const file = (name) => ({ name, mimeType: "application/pdf", buffer: fixture });

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const ctx = await browser.newContext({
      httpCredentials: {
        username: "owner",
        password: process.env.SOLO_TRIAL_PASSWORD,
      },
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== origin)
        external.push(new URL(r.url()).origin);
    });
    await page.goto(origin);
    await page.getByRole("heading", { name: "All 35 tools" }).waitFor();
    assert.equal(await page.locator('#tools a[href^="/tools/"]').count(), 24);
    assert.equal(
      await page.getByText("Coming soon", { exact: true }).count(),
      4,
    );
    assert.equal(
      await page.getByText("Unavailable", { exact: true }).count(),
      7,
    );
    assert.match(
      await page
        .getByRole("link", { name: "Source code for this version" })
        .getAttribute("href"),
      /solo-v1\.0\.0-rc\.3\.tar\.gz$/,
    );
    assert.equal(
      await page.locator('a[href^="mailto:"]').getAttribute("href"),
      "mailto:roughnarayana@gmail.com",
    );
    const routes = await page
      .locator('#tools a[href^="/tools/"]')
      .evaluateAll((links) => links.map((link) => link.pathname));
    for (const route of routes) {
      await page.goto(origin + route);
      await page
        .locator("main input[type=file]")
        .first()
        .waitFor({ state: "attached" });
      assert.ok(await page.getByRole("heading", { level: 1 }).innerText());
    }
    console.log(
      "PASS browser catalog, 24 forms, 11 disabled entries, source and privacy",
    );
    async function open(slug, files) {
      await page.goto(origin + "/tools/" + slug);
      await page.locator("main input[type=file]").first().setInputFiles(files);
    }
    async function run(button, ext) {
      const response = page.waitForResponse(
        (r) => r.request().method() === "POST",
      );
      await button.click();
      const emitted = await response;
      assert.equal(emitted.status(), 200, "conversion " + emitted.status());
      const link = page.getByRole("link", {
        name: "Download " + ext.toUpperCase(),
        exact: true,
      });
      await link.waitFor();
      const downloaded = page.waitForEvent("download");
      await link.click();
      const save = await downloaded;
      assert.ok(save.suggestedFilename().endsWith("." + ext));
      const data = fs.readFileSync(await save.path());
      assert.ok(
        ext === "zip"
          ? data.subarray(0, 2).toString() === "PK"
          : data.subarray(0, 5).toString() === "%PDF-",
      );
    }
    async function split() {
      await open("split-pdf", file("synthetic.pdf"));
      await page.waitForFunction(() =>
        document
          .querySelector('[data-testid="split-file-meta"]')
          ?.textContent.includes("8 pages"),
      );
      await page.getByTestId("page-thumb-1").locator("img").waitFor();
      await page.getByTestId("mode-ranges").locator("..").click();
    }
    await split();
    await page.getByTestId("split-ranges-list").fill("1-20");
    await page.getByRole("button", { name: "Use ranges" }).click();
    await page.getByRole("alert").waitFor();
    await page.getByTestId("split-ranges-list").fill("1-3, 4-8");
    await page.getByRole("button", { name: "Use ranges" }).click();
    assert.equal(await page.getByTestId("range-group-2").inputValue(), "4-8");
    await run(page.getByTestId("split-submit"), "zip");
    await split();
    await page.getByTestId("range-group-1").fill("2-4");
    await run(page.getByTestId("split-submit"), "pdf");
    await split();
    await page.getByTestId("chunk-size").fill("3");
    await page.getByTestId("chunk-apply").click();
    assert.equal(await page.getByTestId("range-group-3").inputValue(), "7-8");
    await run(page.getByTestId("split-submit"), "zip");
    await split();
    await page.getByTestId("mode-every").locator("..").click();
    await run(page.getByTestId("split-submit"), "zip");
    console.log(
      "PASS browser page count, thumbnails, custom ranges, single output, fixed groups, every page and downloads",
    );
    for (const [slug, prefix] of [
      ["delete-pdf-pages", "delete"],
      ["extract-pdf-pages", "extract"],
      ["reorder-pages", "reorder"],
      ["pdf-to-powerpoint", "ppt"],
      ["pdf-encryption", "encrypt"],
      ["bates-numbering", "bates"],
      ["redact-pdf", "redact"],
      ["sign-pdf", "sign"],
    ]) {
      await open(slug, file("workspace.pdf"));
      await page.waitForFunction(
        (id) =>
          document
            .querySelector('[data-testid="' + id + '-file-meta"]')
            ?.textContent.includes("8 pages"),
        prefix,
      );
    }
    console.log("PASS browser specialized workspace previews");
    await open("merge-pdf", [
      file("first.pdf"),
      file("second.pdf"),
      file("third.pdf"),
    ]);
    await page.getByTitle("Move Up").last().click();
    const order = await page.locator("main").innerText();
    assert.ok(order.indexOf("third.pdf") < order.indexOf("second.pdf"));
    await run(page.getByRole("button", { name: /Execute Merge/ }), "pdf");
    await open("compress-pdf", file("compress.pdf"));
    for (const label of ["Standard", "Recommended", "High", "Extreme"]) {
      const button = page.getByRole("button", {
        name: new RegExp("^" + label + " "),
      });
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true");
    }
    await open("compare-pdf", [file("original.pdf"), file("revised.pdf")]);
    await run(
      page.getByRole("button", { name: "Compare PDFs", exact: true }),
      "pdf",
    );
    await page.getByTestId("compare-summary").waitFor();
    console.log(
      "PASS browser merge order, compression selectors and comparison report",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await split();
    await page.getByTestId("split-submit-mobile").waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(
      "PASS mobile controls, browser error and external-request checks",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

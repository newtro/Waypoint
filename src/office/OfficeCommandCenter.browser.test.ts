import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer, browser: Browser, origin: string;

beforeAll(async () => {
  server = await createServer({
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "office-browser-test-page",
        configureServer(vite) {
          vite.middlewares.use("/office-browser-test", async (request, response) => {
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/html");
            response.end(
              await vite.transformIndexHtml(
                request.url ?? "/office-browser-test",
                '<!doctype html><html><body><div id="root"></div><script type="module" src="/scripts/fixtures/office-browser-fixture.tsx"></script></body></html>',
              ),
            );
          });
        },
      },
    ],
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0].replace(/\/$/, "");
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("Office Command Center browser interactions", () => {
  it("selects workers, hides stale errors, and dispatches only after review", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }),
      pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(2_000);
    await page.goto(`${origin}/office-browser-test`);
    await page.waitForTimeout(100);
    expect(pageErrors).toEqual([]);
    expect(await page.locator("body").innerText()).toContain("Browser proof");

    await page.getByRole("button", { name: /Select Existing worker/ }).click();
    await page.getByRole("heading", { name: "Existing worker" }).waitFor();
    await page.getByRole("button", { name: "Stop work" }).click();
    await page.getByRole("alert").waitFor();
    expect(await page.getByRole("alert").textContent()).toContain(
      "Cancel failed safely",
    );
    await page.getByRole("button", { name: "Select Office Manager" }).click();
    expect(await page.getByRole("alert").count()).toBe(0);

    await page.getByRole("button", { name: "Begin a task" }).click();
    expect(await page.locator("#dispatch-count").textContent()).toBe("0");
    await page.getByRole("button", { name: "Review work order" }).click();
    expect(await page.getByLabel("Objective").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(await page.getByLabel("Objective").getAttribute("aria-describedby")).toBe(
      "office-objective-error",
    );
    expect(
      await page.getByLabel("Objective").evaluate(
        (element) => element === document.activeElement,
      ),
    ).toBe(true);
    await page.getByLabel("Objective").fill("FAIL_DISPATCH");
    await page.getByLabel("Authority profile").selectOption("profile-bypass");
    await page.getByRole("button", { name: "Review work order" }).click();
    await page.getByText(/Nothing has started\./).waitFor();
    expect(await page.locator("#dispatch-count").textContent()).toBe("0");
    await page.getByRole("button", { name: "Edit" }).click();
    expect(await page.getByLabel("Objective").inputValue()).toBe(
      "FAIL_DISPATCH",
    );
    await page.getByRole("button", { name: "Cancel" }).click();
    expect(await page.locator("#dispatch-count").textContent()).toBe("0");

    await page.getByRole("button", { name: "Begin a task" }).click();
    await page.getByLabel("Objective").fill("FAIL_DISPATCH");
    await page.getByRole("button", { name: "Review work order" }).click();
    await page.getByRole("button", { name: "Confirm and dispatch" }).click();
    await page.locator("#authorization-count").waitFor();
    expect(await page.locator("#authorization-count").textContent()).toBe("1");
    expect(await page.locator("#dispatch-count").textContent()).toBe("0");
    expect(await page.getByRole("alert").textContent()).toContain(
      "selected authority profile was not enabled",
    );
    await page.getByRole("button", { name: "Confirm and dispatch" }).click();
    expect(await page.locator("#dispatch-attempts").textContent()).toBe("1");
    expect(await page.locator("#dispatch-count").textContent()).toBe("0");
    expect(await page.getByRole("alert").textContent()).toContain(
      "Fixture dispatch rejected safely",
    );
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Objective").fill("Build the mounted browser proof");
    await page.getByRole("button", { name: "Review work order" }).click();
    await page.evaluate(() => {
      const confirm = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Confirm and dispatch",
      );
      if (!(confirm instanceof HTMLButtonElement))
        throw new Error("Confirm button unavailable");
      confirm.click();
      confirm.click();
    });
    await page.waitForFunction(
      () => document.querySelector("#dispatch-count")?.textContent === "1",
    );
    expect(await page.locator("#dispatch-count").textContent()).toBe("1");
    expect(await page.locator("#dispatch-attempts").textContent()).toBe("2");
    expect(await page.locator("#authorization-count").textContent()).toBe("3");
    await page.getByRole("heading", { name: "Browser work order" }).waitFor();
    expect(
      await page.getByText("Build the mounted browser proof").count(),
    ).toBeGreaterThan(0);
    await page.close();
  }, 20_000);

  it("keeps semantic controls usable at narrow width and without the art asset", async () => {
    const page = await browser.newPage({ viewport: { width: 640, height: 820 } });
    page.setDefaultTimeout(2_000);
    await page.addInitScript(() =>
      localStorage.setItem("waypoint.appearance.v1", "light"),
    );
    await page.route("**/waypoint-office-floor*.png", (route) => route.abort());
    await page.goto(`${origin}/office-browser-test`);
    await page.getByRole("button", { name: "Select Office Manager" }).waitFor();
    expect(
      await page.locator(".office-command-layout").evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(1);
    expect(await page.locator("html").getAttribute("data-theme")).toBe("light");
    expect(await page.getByRole("button", { name: /Select Existing worker/ }).count()).toBe(1);
    expect(await page.getByRole("navigation", { name: "Office roster" }).count()).toBe(1);
    expect(await page.getByText("Meeting room").count()).toBeGreaterThan(0);
    await page.keyboard.press("Tab");
    expect(await page.locator(":focus").count()).toBe(1);
    await page.close();
  });

  it("keeps a successful delayed-refresh warning visible inside the Office", async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    await page.goto(`${origin}/office-browser-test`);
    await page.getByRole("button", { name: "Select Office Manager" }).click();
    await page.getByRole("button", { name: "Begin a task" }).click();
    await page.getByLabel("Objective").fill("DELAYED_REFRESH");
    await page.getByRole("button", { name: "Review work order" }).click();
    await page.getByRole("button", { name: "Confirm and dispatch" }).click();
    await page.getByRole("status").filter({ hasText: "Work started successfully" }).waitFor();
    expect(await page.getByRole("button", { name: "Confirm and dispatch" }).count()).toBe(0);
    await page.close();
  });
});

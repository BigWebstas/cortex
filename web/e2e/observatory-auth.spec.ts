import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const TOKEN = "observatory-fixture-token"

async function mock(page: Page, status = 200) {
  await page.route("**/api/agent-runs?*", (route) =>
    route.fulfill({
      json: {
        runs: [],
        pagination: { limit: 100, next_cursor: null, truncated: false },
        as_of: "2026-01-01T00:00:00Z",
        stream_cursor: "0",
      },
    }),
  )
  await page.route("**/api/repositories?*", async (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${TOKEN}`)
    await route.fulfill({
      status,
      json:
        status === 200
          ? {
              repositories: [],
              pagination: { limit: 1, next_cursor: null, truncated: false },
              as_of: "2026-01-01T00:00:00Z",
              stream_cursor: "0",
            }
          : { error: "unauthorized" },
    })
  })
}

async function connect(page: Page) {
  await page.getByLabel("Bearer token").fill(TOKEN)
  await page.getByRole("button", { name: "Connect", exact: true }).click()
}

async function expectNoTrace(page: Page) {
  expect(await page.content()).not.toContain(TOKEN)
  expect(page.url()).not.toContain(TOKEN)
  expect(
    await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
      cookies: document.cookie,
      inputs: [...document.querySelectorAll("input")].map((input) => input.value).join(""),
    })),
  ).toEqual({ local: 0, session: 0, cookies: "", inputs: "" })
}

test("holds the token in memory only and forgets it on clear and reload", async ({ page }) => {
  const logs: string[] = []
  page.on("console", (message) => logs.push(message.text()))
  await mock(page)
  await page.goto("/app/agents/")
  const state = page.locator("[data-connection-state]")

  await connect(page)
  await expect(state).toHaveText("Connected")
  await expectNoTrace(page)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await page.getByRole("button", { name: "Clear token" }).click()
  await expect(state).toHaveText("Disconnected")

  await connect(page)
  await expect(state).toHaveText("Connected")
  await page.reload()
  await expect(state).toHaveText("Disconnected")
  await expectNoTrace(page)
  expect(logs.join("\n")).not.toContain(TOKEN)
})

test("a rejected token is cleared and explained", async ({ page }) => {
  await mock(page, 401)
  await page.goto("/app/agents/")

  await connect(page)

  await expect(page.getByText("Token rejected")).toBeVisible()
  await expect(page.locator("[data-connection-state]")).toHaveText("Disconnected")
  await expectNoTrace(page)
})

test("makes no authenticated request before connecting", async ({ page }) => {
  const calls: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.url())
  })
  await page.goto("/app/agents/?token=ignored", { waitUntil: "networkidle" })
  expect(calls).toEqual([])
})

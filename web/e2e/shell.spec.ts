import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("renders with the vendored Aurora fonts and no external requests", async ({ page, baseURL }) => {
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await page.goto("/app/agents/", { waitUntil: "networkidle" })

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family)
  })
  expect(loaded).toContain("Inter")
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Inter/)
  expect(requests.some((url) => url.includes("/app/fonts/aurora/inter-var.woff2"))).toBe(true)
  expect(requests.filter((url) => !url.startsWith(baseURL!))).toEqual([])
})

// Served by the production Rust router, so this covers asset lookup and the
// script hashes in each page's Content-Security-Policy.
for (const route of ["/app/", "/app/investigate/", "/app/agents/"]) {
  test(`${route} loads without missing assets or CSP violations`, async ({ page }) => {
    const problems: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(message.text())
    })
    page.on("pageerror", (error) => problems.push(error.message))
    page.on("response", (response) => {
      if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`)
    })

    const response = await page.goto(route, { waitUntil: "networkidle" })
    const scriptPolicy = response!
      .headers()
      ["content-security-policy"].split(";")
      .find((directive) => directive.trim().startsWith("script-src"))!
    expect(scriptPolicy).not.toContain("unsafe-")
    expect(problems).toEqual([])
  })
}

for (const route of ["/app/", "/app/agents/"]) {
  test(`${route} has no accessibility violations with the Aurora palette`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" })
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
}

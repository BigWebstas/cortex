import { expect, test } from "@playwright/test"

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

import { expect, test, type Page } from "@playwright/test"

const hosts = [
  { hostname: "shared", aliases: ["shared"], source_kind: "host", host_id: "first" },
  { hostname: "shared", aliases: ["shared"], source_kind: "host", host_id: "second" },
  { hostname: "unique", aliases: ["unique"], source_kind: "host", host_id: "unique" },
]

const metadata = {
  degraded_reasons: [],
  truncated: false,
  truncation_reasons: [],
  partial: false,
  partial_reasons: [],
}

const emptyGraph = { focus: null, entities: [], relationships: [], evidence: [] }

function askEnvelope(claims: object[] = []) {
  return {
    metadata,
    result: {
      claims,
      logs: [],
      candidates: [],
      open_questions: [],
      next_queries: [],
      graph: emptyGraph,
    },
  }
}

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    expect(route.request().headers().authorization).toMatch(/^Bearer .+fixture-token$/)
    const responses: Record<string, object> = {
      "/api/v1/investigation/version": { ui_version: "investigation-v1" },
      "/api/version": { version: "browser-fixture", schema_version: 1 },
      "/api/stats": { total_logs: 3 },
      "/api/hosts": { hosts },
      "/api/tail": {
        logs: [
          { id: 1, hostname: "shared", message: "Ambiguous private log" },
          { id: 2, hostname: "unique", message: "Unique private log" },
        ],
      },
      "/api/v1/investigations/ask": askEnvelope(),
    }
    await route.fulfill({ json: responses[path] ?? {}, status: responses[path] ? 200 : 404 })
  })
}

async function connect(page: Page, token = "browser-fixture-token") {
  await page.getByLabel("Bearer token").fill(token)
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.locator("[data-log-status]")).toHaveText("Live")
}

async function selectNode(page: Page, hostId: string) {
  await page.locator("#quick-node-select").click()
  await page.locator(`[data-node-id="source:heartbeat:${hostId}"]`).click()
}

async function expectEmptyGraphSelector(page: Page) {
  const trigger = page.locator("#quick-node-select")
  await expect(trigger).toHaveAttribute("data-node-count", "0")
  await expect(trigger).toHaveAttribute("data-edge-count", "0")
  await expect(trigger).toBeDisabled()
}

async function ask(page: Page, prompt: string) {
  await page.getByLabel("Ask Cortex").fill(prompt)
  await page.getByRole("button", { name: "Ask", exact: true }).click()
}

test("inspector avoids ambiguous device evidence and clears on disconnect and reconnect", async ({
  page,
}) => {
  const evidence = page.locator("[data-evidence-list]")
  await mockApi(page)
  await page.goto("/app/investigate/")
  await connect(page)

  await selectNode(page, "first")
  await expect(evidence).toContainText("name matches multiple sources")
  await expect(evidence).not.toContainText("Ambiguous private log")

  await selectNode(page, "unique")
  await expect(evidence).toContainText("Unique private log")
  await expect(evidence).toContainText("device identity unverified")

  await page.getByRole("button", { name: "Clear", exact: true }).click()
  await expect(page.getByLabel("Bearer token")).toHaveValue("")
  await expect(page.locator("[data-selected-title]")).toHaveText("Nothing selected")
  await expect(page.locator("[data-log-status]")).toHaveText("Disconnected")
  await expect(evidence).not.toContainText("Unique private log")
  await expectEmptyGraphSelector(page)

  await connect(page)
  await selectNode(page, "unique")
  await expect(evidence).toContainText("Unique private log")
  await connect(page, "replacement-fixture-token")
  await expect(page.locator("[data-selected-title]")).toHaveText("Nothing selected")
  await expect(evidence).not.toContainText("Unique private log")
})

test("empty successful investigation has an explicit empty graph", async ({ page }) => {
  await mockApi(page)
  await page.goto("/app/investigate/")
  await connect(page)
  await ask(page, "An investigation with no graph evidence")

  await expect(page.locator("[data-answer-stack]")).toHaveAttribute("data-ask-state", "complete")
  await expect(page.locator("[data-evidence-list]")).toContainText("No graph entities returned")
  await expectEmptyGraphSelector(page)
})

for (const action of ["clear", "replace token"] as const) {
  test(`${action} invalidates a delayed authenticated response`, async ({ page }) => {
    await mockApi(page)
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route("**/api/v1/investigations/ask", async (route) => {
      await gate
      await route.fulfill({
        json: askEnvelope([
          {
            claim_type: "open_question",
            title: "Stale private answer",
            summary: "Must remain hidden",
            confidence: "low",
            relationship_ids: [],
            evidence_ids: [],
          },
        ]),
      })
    })
    await page.goto("/app/investigate/")
    await connect(page)
    const requested = page.waitForRequest("**/api/v1/investigations/ask")
    await ask(page, "Delayed evidence")
    await requested

    if (action === "clear") {
      await page.getByRole("button", { name: "Clear", exact: true }).click()
    } else {
      await connect(page, "replacement-fixture-token")
    }
    release?.()
    // The aborted request never reaches the page; give any stray continuation
    // two frames to run before asserting nothing was repopulated.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }),
    )

    await expect(page.locator("[data-answer-stack]")).toHaveAttribute("data-ask-state", "idle")
    await expect(page.locator("[data-answer-stack]")).not.toContainText("Stale private answer")
    await expect(page.locator("[data-log-status]")).toHaveText(
      action === "clear" ? "Disconnected" : "Live",
    )
  })
}

test("a graph response that arrives after disconnect is discarded", async ({ page }) => {
  await mockApi(page)
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route("**/api/v1/graph/explain?*", async (route) => {
    await gate
    await route.fulfill({
      json: {
        metadata,
        result: {
          ...emptyGraph,
          entities: [{ id: 7, entity_type: "host", key: "stale", label: "Stale private entity" }],
        },
      },
    })
  })
  await page.goto("/app/investigate/")
  await connect(page)
  await selectNode(page, "unique")
  const requested = page.waitForRequest("**/api/v1/graph/explain?*")
  await page.getByRole("button", { name: "Explain entity" }).click()
  await requested

  await page.getByRole("button", { name: "Clear", exact: true }).click()
  const responded = page.waitForResponse("**/api/v1/graph/explain?*")
  release?.()
  await (await responded).finished()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )

  await expectEmptyGraphSelector(page)
})

test("latest Ask wins even when an older Ask completes last", async ({ page }) => {
  await mockApi(page)
  let releaseOld: (() => void) | undefined
  const oldGate = new Promise<void>((resolve) => {
    releaseOld = resolve
  })
  let askCount = 0
  await page.route("**/api/v1/investigations/ask", async (route) => {
    askCount += 1
    if (askCount === 1) {
      await oldGate
      await route.fulfill({
        json: askEnvelope([
          {
            claim_type: "open_question",
            title: "OLD stale claim",
            summary: "Should be superseded",
            confidence: "low",
            relationship_ids: [],
            evidence_ids: [],
          },
        ]),
      })
      return
    }
    await route.fulfill({
      json: askEnvelope([
        {
          claim_type: "verified",
          title: "NEW latest claim",
          summary: "Current answer wins",
          confidence: "high",
          relationship_ids: [],
          evidence_ids: [],
        },
      ]),
    })
  })

  await page.goto("/app/investigate/")
  await connect(page)
  const firstReq = page.waitForRequest("**/api/v1/investigations/ask")
  await ask(page, "old question")
  await firstReq
  // Trigger a second concurrent Ask via host pivot in the timeline while the first is in flight.
  await page.locator("[data-timeline]").getByRole("button", { name: "unique" }).click()

  await expect(page.locator("[data-answer-stack]")).toHaveAttribute("data-ask-state", "complete")
  await expect(page.locator("[data-answer-stack]")).toContainText("NEW latest claim")

  releaseOld?.()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )

  await expect(page.locator("[data-answer-stack]")).toContainText("NEW latest claim")
  await expect(page.locator("[data-answer-stack]")).not.toContainText("OLD stale claim")
  await expect(page.locator("[data-answer-stack]")).toHaveAttribute("data-ask-state", "complete")
})

test("current Ask network failure replaces stale content with failed state", async ({ page }) => {
  await mockApi(page)
  await page.route("**/api/v1/investigations/ask", (route) => route.abort("failed"))

  await page.goto("/app/investigate/")
  await connect(page)
  await ask(page, "force api failure")

  await expect(page.locator("[data-answer-stack]")).toHaveAttribute("data-ask-state", "failed")
  await expect(page.locator("[data-answer-stack] h2")).toHaveText("Ask failed")
})

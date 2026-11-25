import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

test("loads the disconnected Investigation workspace accessibly", async ({ page }) => {
  await page.goto("/app/investigate/")

  await expect(page).toHaveTitle("Investigate | Cortex")
  await expect(page.getByRole("main")).toBeVisible()
  await expect(
    page.getByRole("heading", { level: 1, name: "Cortex investigation workspace" }),
  ).toBeVisible()
  await expect(page.locator("[data-clear-token]")).toBeVisible()

  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations).toEqual([])
})

test("connects, runs Ask + Explain, inspects evidence proof, and clears token without storage", async ({
  page,
}) => {
  await page.route("**/api/v1/investigation/version", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ui_version: "investigation-v1", schema_version: "investigation-v1" }),
    }),
  )
  await page.route("**/api/version", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ version: "3.18.1", schema_version: 47 }),
    }),
  )
  await page.route("**/api/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ total_logs: 4201 }),
    }),
  )
  await page.route("**/api/hosts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        hosts: [
          { hostname: "edgehost", host_id: "hb-edge-1", source_kind: "host", aliases: ["edgehost"] },
          { hostname: "agent-shared_bearer", source_kind: "forwarding_principal" },
        ],
      }),
    }),
  )
  await page.route("**/api/tail?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        logs: [
          {
            id: 99,
            timestamp: "2026-11-24T18:00:00Z",
            hostname: "edgehost",
            severity: "err",
            app_name: "kernel",
            message: "Out of memory: Killed process 4212 (nginx)",
          },
        ],
      }),
    }),
  )
  await page.route("**/api/v1/investigations/ask", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        metadata: {
          server_version: "3.18.1",
          schema_version: "investigation-v1",
          graph_projection_status: "ready",
          source_watermark: "2026-11-24T18:00:00Z",
          degraded_reasons: [],
          truncated: false,
          truncation_reasons: [],
          partial: false,
          partial_reasons: [],
          auth_state: "bearer",
          budget: {
            max_graph_calls: 3,
            max_log_rows: 25,
            max_evidence_rows: 12,
            max_candidate_explanations: 5,
            max_wall_time_ms: 2000,
            max_payload_bytes: 65536,
          },
          budget_used: {
            graph_calls: 1,
            log_rows: 1,
            evidence_rows: 1,
            candidate_explanations: 1,
            wall_time_ms: 14,
            payload_bytes: 1024,
          },
          payload_limit_bytes: 65536,
          version_skew: null,
        },
        result: {
          prompt: "Why did edgehost OOM?",
          resolved_entity: {
            id: 1,
            entity_type: "host",
            key: "edgehost",
            label: "edgehost",
            trust_level: "verified",
          },
          candidates: [],
          claims: [
            {
              claim_type: "supported_correlation",
              title: "Memory spike preceded nginx OOM kill",
              summary: "edgehost kernel logged an OOM kill for nginx right after memory pressure.",
              confidence: "high",
              relationship_ids: [10],
              evidence_ids: [501],
            },
          ],
          open_questions: ["Was a new nginx worker limit deployed?"],
          next_queries: ["Show nginx restarts on edgehost"],
          graph: {
            focus: {
              id: 1,
              entity_type: "host",
              key: "edgehost",
              label: "edgehost",
              trust_level: "verified",
            },
            entities: [
              { id: 1, entity_type: "host", key: "edgehost", label: "edgehost", trust_level: "verified" },
              { id: 2, entity_type: "service", key: "nginx", label: "nginx", trust_level: "claimed" },
            ],
            relationships: [
              {
                id: 10,
                source_entity_id: 1,
                target_entity_id: 2,
                relationship_type: "runs",
                reason_code: "oom_killer",
                trust_level: "verified",
                confidence: 0.91,
                evidence_count: 1,
              },
            ],
            evidence: [
              {
                id: 501,
                relationship_id: 10,
                source_kind: "syslog",
                source_log_id: 99,
                observed_at: "2026-11-24T18:00:00Z",
                reason_code: "oom_killer",
                reason_text: "Kernel OOM killer terminated nginx",
                confidence_delta: 0.4,
                trust_level: "verified",
                excerpt: "Out of memory: Killed process 4212 (nginx)",
                missing_source_reason: null,
              },
            ],
          },
          logs: [
            {
              id: 99,
              timestamp: "2026-11-24T18:00:00Z",
              hostname: "edgehost",
              severity: "err",
              app_name: "kernel",
              message: "Out of memory: Killed process 4212 (nginx)",
            },
          ],
        },
      }),
    }),
  )
  await page.route("**/api/v1/graph/evidence?evidence_id=501", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        metadata: {
          server_version: "3.18.1",
          schema_version: "investigation-v1",
          graph_projection_status: "ready",
          source_watermark: "2026-11-24T18:00:00Z",
          degraded_reasons: [],
          truncated: false,
          truncation_reasons: [],
          partial: false,
          partial_reasons: [],
          auth_state: "bearer",
          budget: {
            max_graph_calls: 1,
            max_log_rows: 0,
            max_evidence_rows: 1,
            max_candidate_explanations: 1,
            max_wall_time_ms: 2000,
            max_payload_bytes: 65536,
          },
          budget_used: {
            graph_calls: 1,
            log_rows: 0,
            evidence_rows: 1,
            candidate_explanations: 0,
            wall_time_ms: 4,
            payload_bytes: 512,
          },
          payload_limit_bytes: 65536,
          version_skew: null,
        },
        result: {
          evidence: {
            id: 501,
            relationship_id: 10,
            source_kind: "syslog",
            source_log_id: 99,
            observed_at: "2026-11-24T18:00:00Z",
            reason_code: "oom_killer",
            reason_text: "Kernel OOM killer terminated nginx",
            confidence_delta: 0.4,
            trust_level: "verified",
            excerpt: "Out of memory: Killed process 4212 (nginx)",
            missing_source_reason: null,
          },
          relationship: {
            id: 10,
            source_entity_id: 1,
            target_entity_id: 2,
            relationship_type: "runs",
            reason_code: "oom_killer",
            trust_level: "verified",
            confidence: 0.91,
            evidence_count: 1,
          },
          source_log_summary: {
            id: 99,
            timestamp: "2026-11-24T18:00:00Z",
            received_at: "2026-11-24T18:00:01Z",
            hostname: "edgehost",
            severity: "err",
            app_name: "kernel",
            message: "Out of memory: Killed process 4212 (nginx)",
            message_truncated: false,
          },
          missing_source_reason: null,
        },
      }),
    }),
  )

  await page.goto("/app/investigate/")
  await page.getByLabel("Bearer token").fill("test-secret-token")
  await page.getByRole("button", { name: "Connect" }).click()

  await expect(page.locator("[data-server-version]")).toHaveText("3.18.1")
  await expect(page.locator("[data-host-count]")).toHaveText("1")
  await expect(page.locator("[data-log-count]")).toHaveText("4201")
  await expect(page.locator("[data-v1-state]")).toContainText("Compatible")

  await page.getByLabel("Ask Cortex").fill("Why did edgehost OOM?")
  await page.getByRole("button", { name: "Ask" }).click()

  await expect(
    page.locator("[data-answer-stack]").getByText("Memory spike preceded nginx OOM kill"),
  ).toBeVisible()
  await expect(page.locator("[data-selected-title]")).toHaveText(
    "Memory spike preceded nginx OOM kill",
  )
  await expect(page.getByText("Was a new nginx worker limit deployed?")).toBeVisible()

  await page.getByRole("button", { name: "Inspect source proof" }).click()
  await expect(page.getByText("Source proof #501")).toBeVisible()

  const liveAxe = await new AxeBuilder({ page }).analyze()
  expect(liveAxe.violations).toEqual([])

  const storageState = await page.evaluate(() => ({
    localLen: window.localStorage.length,
    sessionLen: window.sessionStorage.length,
    cookies: document.cookie,
  }))
  expect(storageState).toEqual({ localLen: 0, sessionLen: 0, cookies: "" })

  await page.locator("[data-clear-token]").click()
  await expect(page.getByText("Bearer token cleared")).toBeVisible()
  await expect(page.locator("[data-server-version]")).toHaveText("--")
})

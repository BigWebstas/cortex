import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString()
const page_ = (next_cursor: string | null = null) => ({
  pagination: { limit: 100, next_cursor, truncated: Boolean(next_cursor) },
  as_of: at(0),
  stream_cursor: "1",
})

const repository = {
  id: "1", key: "repo", hostname: "devhost", primary_path: "/work/cortex", name: "cortex",
  first_seen_at: at(0), last_seen_at: at(0), removed_at: null, worktree_count: 1,
  active_run_count: 1,
}
const worktree = {
  id: "7", key: "wt", repository_id: "1", hostname: "devhost", path: "/work/cortex",
  branch_ref: "refs/heads/main", branch: "main", head_sha: "0123456789abcdef", upstream_ref: null,
  detached: false, bare: false, locked: false, lock_reason: null, prunable: false,
  prune_reason: null, dirty: true, staged: 1, unstaged: 0, untracked: 0, ahead: 2, behind: 0,
  first_seen_at: at(0), last_seen_at: at(0), removed_at: null,
}
const run = (index: number) => ({
  id: String(index), run_key: `v1|run:${index}`, native_session_id: `session-${index}`,
  tool: "codex", provider_tool: null, hostname: "devhost", parent_run_id: null,
  previous_run_id: null, status: "active", status_reason: "recent activity",
  status_observed_at: at(0), started_at: at(0), last_activity_at: at(0), ended_at: null,
  transcript_path: null, primary_worktree_id: "7", primary_branch: "main", start_head_sha: null,
  current_head_sha: null, event_count: 3, error_count: 0,
  freshness_json: '{"git":{"state":"fresh"}}',
})
const evidence = (detail: string) => ({
  kind: "cwd", source: "transcript", trust: "inferred", confidence: 0.5,
  first_seen_at: at(0), last_seen_at: at(1), detail,
})
const event = (index: number, extra: object = {}) => ({
  id: String(index), event_key: `e${index}`, run_key: "v1|run:1", actor_key: null,
  worktree_id: null, commit_sha: null, observed_at: at(index), ingested_at: at(index),
  kind: "transcript", source_kind: "logs", source_id: String(index), source_log_id: null,
  provider_sequence: null, trace_id: null, span_id: null, severity: "info",
  title: `Event ${index}`, summary: `Summary ${index}`, payload_json: null,
  content_scrubbed: true, ...extra,
})

interface Fixtures {
  runs?: object[]
  /** Newest first, as the server returns them. */
  events?: (cursor: string | null) => { events: object[]; next: string | null }
}

async function mock(page: Page, fixtures: Fixtures = {}) {
  const requests: URL[] = []
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const path = url.pathname
    let json: object | undefined
    if (path === "/api/repositories") json = { repositories: [repository], ...page_() }
    else if (path === "/api/repositories/1/worktrees") json = { worktrees: [worktree], ...page_() }
    else if (path === "/api/agent-runs") json = { runs: fixtures.runs ?? [run(1), run(2)], ...page_() }
    else if (path.endsWith("/events")) {
      const result = fixtures.events?.(url.searchParams.get("cursor")) ?? {
        events: [
          event(3, { summary: '<img src=x onerror="window.__xss=1">' }),
          event(2),
          event(1),
        ],
        next: null,
      }
      json = { run_key: "v1|run:1", events: result.events, ...page_(result.next) }
    } else if (path.startsWith("/api/agent-runs/")) {
      json = {
        run: run(1), actors: [], worktree_evidence: [evidence("/work/a"), evidence("/work/b")],
        available_event_kinds: ["command", "transcript"], commit_summary: null,
        latest_stream_cursor: "1",
      }
    }
    await route.fulfill(json ? { json } : { status: 404, json: { error: "not_found" } })
  })
  return requests
}

async function open(page: Page, search = "") {
  await page.goto(`/app/agents/${search}`)
  await page.getByLabel("Bearer token").fill("observatory-fixture-token")
  await page.getByRole("button", { name: "Connect", exact: true }).click()
  await expect(page.locator("[data-connection-state]")).toHaveText("Connected")
}

test("goes from repository to worktree to run to timeline with the keyboard", async ({
  page,
}, info) => {
  const requests = await mock(page)
  await open(page)
  if (info.project.name.includes("mobile")) {
    await page.getByRole("button", { name: "Repositories" }).press("Enter")
  }
  const repositoryButton = page.getByRole("button", { name: /cortex 1 active/ })
  await repositoryButton.press("Enter")
  const worktreeButton = page.getByRole("button", { name: /main 0123456/ })
  await expect(worktreeButton).toContainText("1 staged · 2 ahead")
  await repositoryButton.press("ArrowDown")
  await expect(worktreeButton).toBeFocused()
  await worktreeButton.press("Enter")
  await expect(page).toHaveURL(/repository=1&worktree=7/)
  if (info.project.name.includes("mobile")) await page.keyboard.press("Escape")

  await page.getByRole("button", { name: /codex · session-1/ }).press("Enter")
  await expect(page.getByText("Multiple possible worktrees")).toBeVisible()
  await expect(page.getByText("not established")).toBeVisible()
  await expect(page.getByText('<img src=x onerror="window.__xss=1">')).toBeVisible()
  expect(await page.evaluate(() => "__xss" in window)).toBe(false)
  const eventTitles = page.locator("[data-event-id]")
  await expect(eventTitles.first()).toContainText("Event 1")
  await expect(eventTitles.last()).toContainText("Event 3")

  await page.getByRole("button", { name: "Worktree evidence (2)" }).press("Enter")
  await expect(page.getByRole("dialog")).toContainText("/work/b")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Worktree evidence (2)" })).toBeFocused()

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  const runRequest = requests.findLast((url) => url.pathname === "/api/agent-runs")!
  expect(runRequest.searchParams.get("worktree_id")).toBe("7")
  expect(requests.map(String).join(" ")).not.toContain("fixture-token")
})

test("sends filters to the server and restores a shared address after sign-in", async ({
  page,
}) => {
  const requests = await mock(page)
  await open(page, "?status=idle&q=needle&run=v1%7Crun%3A1&kind=command")
  await expect(page.getByText("Multiple possible worktrees")).toBeVisible()
  const query = (path: string) => requests.findLast((url) => url.pathname.endsWith(path))!
  await expect.poll(() => query("/api/agent-runs")?.search).toContain("status=idle")
  expect(query("/api/agent-runs").searchParams.get("query")).toBe("needle")
  await expect.poll(() => query("/events")?.search).toContain("kind=command")

  await page.getByRole("button", { name: "command", exact: true }).click()
  await expect(page).not.toHaveURL(/kind=/)
  await page.goBack()
  await expect(page).toHaveURL(/kind=command/)
})

test("keeps the page bounded for thousands of runs and events", async ({ page }) => {
  await mock(page, {
    runs: Array.from({ length: 5_000 }, (_, index) => run(index + 1)),
    events: () => ({
      events: Array.from({ length: 10_000 }, (_, index) => event(10_000 - index)),
      next: null,
    }),
  })
  await open(page)
  await expect(page.locator("[data-run-row]").first()).toBeVisible()
  expect(await page.locator("[data-run-row]").count()).toBeLessThan(80)

  await page.getByRole("button", { name: /codex · session-1 / }).click()
  await expect(page.getByText("10000 events loaded")).toBeVisible()
  await expect(page.locator('[data-event-id="10000"]')).toBeVisible()
  expect(await page.locator("[data-event-id]").count()).toBeLessThanOrEqual(250)
})

test("keeps the reading position for older and newer events", async ({ page }) => {
  let newest = 60
  const range = (from: number, to: number) =>
    Array.from({ length: from - to + 1 }, (_, index) => event(from - index))
  await mock(page, {
    events: (cursor) =>
      cursor ? { events: range(20, 1), next: null } : { events: range(newest, 21), next: "older" },
  })
  await open(page, "?run=v1%7Crun%3A1")
  const scroller = page.locator("[data-timeline-scroller]")
  await expect(page.locator('[data-event-id="60"]')).toBeVisible()

  await scroller.evaluate((element) => element.scrollTo(0, 0))
  const anchor = page.locator('[data-event-id="21"]')
  await expect(anchor).toBeVisible()
  // Measured within the scroller, so scrolling the page does not count.
  const position = () =>
    scroller.evaluate((element) => {
      const row = element.querySelector('[data-event-id="21"]')
      return row ? row.getBoundingClientRect().top - element.getBoundingClientRect().top : NaN
    })
  const before = await position()
  await page.getByRole("button", { name: "Load older events" }).click()
  await expect(page.getByText("60 events loaded")).toBeVisible()
  // Let the correction settle before measuring.
  await page.waitForTimeout(500)
  expect(Math.abs((await position()) - before)).toBeLessThan(5)

  newest = 63
  await page.getByRole("button", { name: "Check for new events" }).click()
  const back = page.getByRole("button", { name: "Return to live (3 new)" })
  await expect(back).toBeVisible()
  await expect(anchor).toBeVisible()
  await back.click()
  await expect(page.locator('[data-event-id="63"]')).toBeVisible()
  await expect(back).toBeHidden()
})

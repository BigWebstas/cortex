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

const nano = (offset: bigint) => String(1_800_000_000_000_000_000n + offset)
const span = (span_id: string, parent_span_id: string | null, from: bigint, to: bigint) => ({
  id: span_id, trace_id: "t", span_id, parent_span_id, name: `span ${span_id}`, kind: 1,
  start_time_unix_nano: nano(from), end_time_unix_nano: nano(to),
  duration_nano: Number(to - from), status_code: 0, status_message: null,
  service_name: "agent", attributes_json: "{}",
})
const telemetry = [
  { items: [span("child", "root", 10n, 20n), span("root", null, 0n, 100n)], ...page_() },
  {
    items: [{
      id: "1", point_key: "p", metric_name: "tokens", description: "", unit: "1",
      instrument_kind: "sum", start_time_unix_nano: null, time_unix_nano: nano(5n),
      value_json: '{"type":"int","value":42}', attributes_json: "{}",
    }],
    ...page_(),
  },
]

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
    else if (path === "/api/repositories/1") json = repository
    else if (path === "/api/repositories/1/runs") json = { runs: [run(1)], ...page_() }
    else if (path.endsWith("/telemetry")) json = telemetry
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

for (const available of [true, false]) {
  test(`copies the run key, ${available ? "with" : "without"} clipboard access`, async ({ page }) => {
    await page.addInitScript((enabled) => {
      Object.defineProperty(navigator, "clipboard", {
        value: enabled
          ? { writeText: async (text: string) => void Object.assign(window, { __copied: text }) }
          : undefined,
      })
    }, available)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await mock(page)
    await open(page, "?run=v1%7Crun%3A1")

    await page.getByRole("button", { name: "Copy run key" }).click()

    if (available) {
      await expect(page.getByRole("button", { name: "Run key copied" })).toBeVisible()
      expect(await page.evaluate(() => (window as { __copied?: string }).__copied)).toBe("v1|run:1")
    } else {
      const field = page.getByLabel(/Copying is unavailable/)
      await expect(field).toHaveValue("v1|run:1")
      await expect(field).toBeFocused()
      expect(
        await field.evaluate((element: HTMLInputElement) =>
          element.value.slice(element.selectionStart ?? 0, element.selectionEnd ?? 0),
        ),
      ).toBe("v1|run:1")
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    }
    expect(errors).toEqual([])
  })
}

test("shows the transcript with recorded speakers, search and tool folding", async ({ page }) => {
  const message = (index: number, event_kind: string, text: string) =>
    event(index, {
      payload_json: JSON.stringify({ message: text, metadata: { event_kind } }),
    })
  const requests = await mock(page, {
    events: () => ({
      events: [
        message(3, "tool", "tool output"),
        message(2, "assistant", "<b>not markup</b>"),
        message(1, "user", "please run the tests"),
      ],
      next: null,
    }),
  })
  await open(page, "?run=v1%7Crun%3A1")
  await page.getByRole("tab", { name: "Transcript" }).click()
  await expect(page).toHaveURL(/tab=transcript/)

  const messages = page.locator("[data-speaker]")
  await expect(messages).toHaveCount(3)
  await expect(messages.first()).toContainText("please run the tests")
  await expect(messages.nth(1)).toContainText("<b>not markup</b>")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.getByRole("button", { name: "Hide tool messages" }).click()
  await expect(messages).toHaveCount(2)
  await expect(page.getByText("1 tool messages hidden")).toBeVisible()

  await page.getByLabel("Search this transcript").fill("tests")
  await page.getByLabel("Search this transcript").press("Enter")
  await expect
    .poll(() => requests.findLast((url) => url.pathname.endsWith("/events"))?.searchParams.get("query"))
    .toBe("tests")
  const sent = requests.findLast((url) => url.pathname.endsWith("/events"))!
  expect(sent.searchParams.getAll("kind")).toEqual(["transcript", "provider_event"])
  expect(sent.searchParams.get("include")).toBe("payload")
})

test("lists commands, filters the loaded ones and shows their detail", async ({ page }) => {
  const command = (index: number, text: string, exit_status: number, duration_ms: number) =>
    event(index, {
      kind: "command",
      payload_json: JSON.stringify({
        command: text, cwd: "/work/cortex", exit_status, duration_ms,
      }),
    })
  await mock(page, {
    events: () => ({
      events: [command(2, "git push", 1, 45_000), command(1, "cargo build", 0, 900)],
      next: "older",
    }),
  })
  await open(page, "?run=v1%7Crun%3A1&tab=commands")
  const rows = page.locator("[data-command-row]")
  await expect(rows).toHaveCount(2)
  await expect(page.getByText("2 of 2 loaded commands shown; older commands are not loaded")).toBeVisible()

  await page.getByRole("button", { name: "Failed", exact: true }).click()
  await expect(rows).toHaveCount(1)
  await rows.getByRole("button").click()
  const detail = page.getByRole("dialog")
  await expect(detail).toContainText("/work/cortex")
  await expect(detail).toContainText("45.0 s")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test("shows Git history without presenting an inferred commit as exact", async ({ page }) => {
  await mock(page, {
    events: () => ({
      events: [
        event(1, {
          kind: "git_head",
          payload_json: JSON.stringify({
            association: { trust: "correlated" },
            source: { observation: { kind: "head", old_head_sha: "aaaaaaaaaa",
              new_head_sha: "bbbbbbbbbb", payload: { fast_forward: false } } },
          }),
        }),
      ],
      next: null,
    }),
  })
  await open(page, "?run=v1%7Crun%3A1&tab=git")
  await expect(page.locator("[data-git-entry]")).toContainText("HEAD aaaaaaa → bbbbbbb")
  await expect(page.locator("[data-git-entry]")).toContainText("history rewritten")
  await expect(page.locator("[data-git-entry]")).toContainText("correlated")
  await expect(page.getByText("No commit has been related to this run.")).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test("filters activity by kind on the server and shows safe detail", async ({ page }) => {
  const requests = await mock(page, {
    events: () => ({
      events: [
        event(1, { kind: "mcp", payload_json: JSON.stringify({ mcp_server: "cortex",
          mcp_tool: "search", is_error: true, arguments: { q: "<img src=x>" } }) }),
      ],
      next: null,
    }),
  })
  await open(page, "?run=v1%7Crun%3A1&tab=activity")
  const row = page.locator("[data-activity-row]")
  await expect(row).toContainText("cortex · search")
  await expect(row).toContainText("failed")
  await row.getByRole("button").click()
  await expect(page.getByRole("dialog")).toContainText("<img src=x>")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Hooks", exact: true }).click()
  await expect
    .poll(() => requests.findLast((url) => url.pathname.endsWith("/events"))!.searchParams.getAll("kind"))
    .toEqual(["hook"])
})

test("nests spans and tabulates metrics", async ({ page }) => {
  await mock(page)
  await open(page, "?run=v1%7Crun%3A1&tab=telemetry")
  const spans = page.locator("[data-span-row]")
  await expect(spans).toHaveCount(2)
  await expect(spans.first()).toHaveAttribute("data-depth", "0")
  await expect(spans.first()).toContainText("span root")
  await expect(spans.last()).toHaveAttribute("data-depth", "1")
  await expect(page.getByRole("cell", { name: "tokens" })).toBeVisible()
  await expect(page.getByRole("cell", { name: "42" })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test("lists evidence for a run and an overview for a repository", async ({ page }) => {
  await mock(page)
  await open(page, "?repository=1&run=v1%7Crun%3A1&tab=evidence")
  await expect(page.getByRole("cell", { name: "/work/b" })).toBeVisible()
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

  await open(page, "?repository=1")
  const overview = page.getByRole("region", { name: "Repository overview" })
  if (await overview.isHidden()) return // Narrow screens show the run list instead.
  await expect(overview.locator("[data-overview-worktree]")).toContainText("Active: codex session-1")
  await expect(overview).toContainText("1 with uncommitted changes")
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test("every run view fits the width of the screen", async ({ page }) => {
  await mock(page)
  await open(page, "?run=v1%7Crun%3A1")
  for (const name of [
    "Timeline", "Transcript", "Commands", "Git", "Activity", "Telemetry", "Evidence",
  ]) {
    await page.getByRole("tab", { name }).click()
    await expect(page.getByRole("tabpanel")).toBeVisible()
    await page.waitForLoadState("networkidle")
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, name).toBeLessThanOrEqual(0)
    expect(await page.evaluate(() => window.innerWidth), name).toBe(page.viewportSize()!.width)
  }
})

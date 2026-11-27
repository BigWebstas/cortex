import { describe, expect, it } from "vitest"

import type { AgentRunEvent } from "../../docs/contracts/agent-observatory-types"
import type { TelemetryMetricRow, TelemetrySpanRow } from "../src/lib/observatory/api"
import { activityEntry, gitEntry } from "../src/lib/observatory/activity"
import { formatNanos, metricSummaries, spanTree } from "../src/lib/observatory/telemetry"

const event = (kind: string, payload: unknown) =>
  ({
    id: "1",
    kind,
    title: "title",
    summary: "summary",
    severity: "info",
    payload_json: payload === null ? null : JSON.stringify(payload),
  }) as AgentRunEvent

describe("Git observations", () => {
  const head = {
    association: { trust: "correlated", confidence: 0.6 },
    source: {
      observation: {
        kind: "head",
        old_head_sha: "aaaaaaaaaa",
        new_head_sha: "bbbbbbbbbb",
        worktree_path: "/work/a",
        payload: {
          transition_kind: "rewrite",
          fast_forward: false,
          new_commit_shas: ["bbbbbbbbbb"],
          displaced_commit_shas: ["cccccccccc", 4],
        },
      },
    },
  }

  it("keeps rewritten history and the inferred trust of the relation", () => {
    expect(gitEntry(event("git_head", head))).toMatchObject({
      observation: "head",
      from: "aaaaaaa",
      to: "bbbbbbb",
      worktree: "/work/a",
      trust: "correlated",
      transition: "rewrite",
      fastForward: false,
      added: ["bbbbbbb"],
      displaced: ["ccccccc"],
    })
  })

  it("reports missing details as unknown", () => {
    expect(gitEntry(event("git_status", null))).toMatchObject({
      observation: "summary",
      trust: "unknown",
      from: null,
      fastForward: null,
      added: [],
    })
  })
})

describe("tool, hook, skill and model activity", () => {
  it.each([
    ["mcp", { mcp_server: "s", mcp_tool: "t", is_error: true, duration_ms: 5, arguments: { a: 1 }, output_preview: "out" }, "s · t", "failed", 5],
    ["hook", { hook_event: "Stop", hook_name: "lint", exit_code: 0, hook_command: "just lint" }, "Stop · lint", "exit 0", null],
    ["skill", { skill_name: "review", skill_plugin: "core", event_kind: "load" }, "core · review", "load", null],
    ["llm", { provider: "p", model: "m", action: "assess", status: "ok", duration_ms: 9 }, "p · m", "ok", 9],
  ])("summarises %s rows", (kind, payload, name, result, durationMs) => {
    expect(activityEntry(event(kind, payload))).toMatchObject({ kind, name, result, durationMs })
  })

  it("keeps inputs and outputs as bounded text", () => {
    const entry = activityEntry(event("mcp", { arguments: { html: "<img>" }, output_preview: "x".repeat(9000) }))
    expect(entry.details).toContainEqual(["Arguments", '{\n  "html": "<img>"\n}'])
    const output = entry.details.find(([label]) => label === "Output")![1]
    expect(output.length).toBeLessThan(4100)
    expect(output.endsWith("(shortened)")).toBe(true)
  })

  it("marks a payload that was dropped for size", () => {
    expect(activityEntry(event("mcp", { payload_truncated: true })).truncated).toBe(true)
    expect(activityEntry(event("mcp", {})).result).toBe("unknown")
  })
})

describe("telemetry", () => {
  const span = (span_id: string, parent_span_id: string | null, start: bigint, end: bigint) =>
    ({
      id: span_id,
      trace_id: "t",
      span_id,
      parent_span_id,
      name: span_id,
      start_time_unix_nano: String(start),
      end_time_unix_nano: String(end),
      duration_nano: Number(end - start),
      status_code: 0,
    }) as TelemetrySpanRow
  // Beyond double precision, so rounding would reorder or flatten these.
  const base = 1_800_000_000_000_000_000n

  it("nests children under parents in start order with exact offsets", () => {
    const rows = spanTree([
      span("late", "root", base + 600n, base + 1000n),
      span("root", null, base, base + 1000n),
      span("early", "root", base + 1n, base + 501n),
      span("orphan", "missing", base + 2n, base + 3n),
    ])
    expect(rows.map((row) => [row.span.span_id, row.depth])).toEqual([
      ["root", 0],
      ["early", 1],
      ["late", 1],
      ["orphan", 0],
    ])
    expect(rows[1]).toMatchObject({ offsetPercent: 0.1, widthPercent: 50 })
  })

  it("lists every span once even when parents form a cycle", () => {
    const rows = spanTree([span("a", "b", base, base + 1n), span("b", "a", base, base + 1n)])
    expect(rows.map((row) => row.span.span_id).sort()).toEqual(["a", "b"])
  })

  it("summarises the newest point of each metric", () => {
    const point = (metric_name: string, time: bigint, value: unknown) =>
      ({
        metric_name,
        unit: "ms",
        instrument_kind: "gauge",
        time_unix_nano: String(time),
        value_json: JSON.stringify(value),
      }) as TelemetryMetricRow
    expect(
      metricSummaries([
        point("latency", base + 1n, { type: "double", value: 1.5 }),
        point("latency", base + 2n, { type: "double", value: 2.5 }),
        point("histogram", base, { count: 3 }),
      ]),
    ).toEqual([
      { name: "histogram", unit: "ms", kind: "gauge", points: 1, latest: '{"count":3}' },
      { name: "latency", unit: "ms", kind: "gauge", points: 2, latest: "2.5" },
    ])
  })

  it("formats durations", () => {
    expect([formatNanos(500), formatNanos(2_500_000), formatNanos(3_200_000_000)]).toEqual([
      "500 ns",
      "2.5 ms",
      "3.20 s",
    ])
  })
})

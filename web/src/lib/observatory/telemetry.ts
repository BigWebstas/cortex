// Span nesting and metric summaries. Nanosecond timestamps arrive as strings
// and are compared as integers, because they exceed double precision.

import type { TelemetryMetricRow, TelemetrySpanRow } from "./api"

export interface SpanRow {
  span: TelemetrySpanRow
  depth: number
  /** Position within its trace, as percentages of the trace's length. */
  offsetPercent: number
  widthPercent: number
}

const nanos = (value: string) => (/^[0-9]+$/.test(value) ? BigInt(value) : 0n)
const compare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)
const percent = (part: bigint, whole: bigint) => Number((part * 100_000n) / whole) / 1000

export function spanTree(spans: TelemetrySpanRow[]): SpanRow[] {
  const traces = new Map<string, TelemetrySpanRow[]>()
  for (const span of spans) {
    const items = traces.get(span.trace_id) ?? []
    items.push(span)
    traces.set(span.trace_id, items)
  }
  return [...traces.values()].flatMap((trace) => {
    const ordered = [...trace].sort((a, b) =>
      compare(nanos(a.start_time_unix_nano), nanos(b.start_time_unix_nano)),
    )
    const start = nanos(ordered[0].start_time_unix_nano)
    const end = ordered.reduce((latest, span) => {
      const value = nanos(span.end_time_unix_nano)
      return value > latest ? value : latest
    }, start)
    const length = end > start ? end - start : 1n
    const known = new Set(ordered.map((span) => span.span_id))
    const children = new Map<string, TelemetrySpanRow[]>()
    for (const span of ordered) {
      const parent = span.parent_span_id
      if (!parent || !known.has(parent)) continue
      children.set(parent, [...(children.get(parent) ?? []), span])
    }
    const seen = new Set<string>()
    const rows: SpanRow[] = []
    const visit = (span: TelemetrySpanRow, depth: number) => {
      if (seen.has(span.span_id)) return
      seen.add(span.span_id)
      const from = nanos(span.start_time_unix_nano)
      const to = nanos(span.end_time_unix_nano)
      rows.push({
        span,
        depth,
        offsetPercent: percent(from - start, length),
        widthPercent: percent(to > from ? to - from : 0n, length),
      })
      for (const child of children.get(span.span_id) ?? []) visit(child, depth + 1)
    }
    for (const span of ordered) {
      if (!span.parent_span_id || !known.has(span.parent_span_id)) visit(span, 0)
    }
    // Members of a parent cycle have no root; show them rather than drop them.
    for (const span of ordered) visit(span, 0)
    return rows
  })
}

export interface MetricSummary {
  name: string
  unit: string
  kind: string
  points: number
  latest: string
}

function metricValue(json: string): string {
  try {
    const value = JSON.parse(json) as { value?: unknown } | null
    if (typeof value?.value === "number" || typeof value?.value === "string") {
      return String(value.value)
    }
    return JSON.stringify(value).slice(0, 200)
  } catch {
    return "unreadable"
  }
}

export function metricSummaries(points: TelemetryMetricRow[]): MetricSummary[] {
  const groups = new Map<string, TelemetryMetricRow[]>()
  for (const point of points) {
    groups.set(point.metric_name, [...(groups.get(point.metric_name) ?? []), point])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => {
      const latest = items.reduce((best, item) =>
        nanos(item.time_unix_nano) > nanos(best.time_unix_nano) ? item : best,
      )
      return {
        name,
        unit: latest.unit,
        kind: latest.instrument_kind,
        points: items.length,
        latest: metricValue(latest.value_json),
      }
    })
}

export function formatNanos(value: number): string {
  if (value < 1000) return `${value} ns`
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)} µs`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} ms`
  return `${(value / 1_000_000_000).toFixed(2)} s`
}

// Shareable selection and filters in the URL. Only the names listed here are
// read or written, so a token can never survive a round trip.

import type { AgentEventKind, RunStatus } from "../../../../docs/contracts/agent-observatory-types"

export const TABS = [
  "timeline",
  "transcript",
  "commands",
  "git",
  "telemetry",
  "activity",
  "evidence",
] as const
export type Tab = (typeof TABS)[number]

const KINDS: readonly AgentEventKind[] = [
  "lifecycle", "transcript", "command", "shell_history", "git_status", "git_head", "git_commit",
  "file_operation", "mcp", "hook", "skill", "llm", "otlp_log", "otlp_span", "otlp_metric",
  "heartbeat", "error", "provider_event",
]
const STATUSES: readonly RunStatus[] = [
  "starting", "active", "waiting", "idle", "stale", "completed", "failed", "abandoned",
]
// The server's limits for one filter value and one list.
const MAX_TEXT = 512
const MAX_RUN_KEY = 1024
const MAX_VALUES = 32

export interface Route {
  repository: string | null
  worktree: string | null
  run: string | null
  tab: Tab
  kinds: AgentEventKind[]
  statuses: RunStatus[]
  tools: string[]
  host: string | null
  query: string | null
  activeOnly: boolean
}

export const DEFAULT_ROUTE: Route = {
  repository: null,
  worktree: null,
  run: null,
  tab: "timeline",
  kinds: [],
  statuses: [],
  tools: [],
  host: null,
  query: null,
  activeOnly: false,
}

const id = (value: string | null) => (value && /^[1-9][0-9]{0,18}$/.test(value) ? value : null)
const text = (value: string | null, maximum = MAX_TEXT) =>
  value && value.length <= maximum ? value : null
const list = <T extends string>(values: string[], allowed?: readonly T[]): T[] =>
  [...new Set(values)]
    .filter((value) =>
      allowed ? (allowed as readonly string[]).includes(value) : text(value) !== null,
    )
    .sort()
    .slice(0, MAX_VALUES) as T[]

export function parseRoute(search: string): Route {
  const params = new URLSearchParams(search)
  const tab = params.get("tab")
  return {
    repository: id(params.get("repository")),
    worktree: id(params.get("worktree")),
    run: text(params.get("run"), MAX_RUN_KEY),
    tab: TABS.find((value) => value === tab) ?? DEFAULT_ROUTE.tab,
    kinds: list(params.getAll("kind"), KINDS),
    statuses: list(params.getAll("status"), STATUSES),
    tools: list(params.getAll("tool")),
    host: text(params.get("host")),
    query: text(params.get("q")),
    activeOnly: params.get("active") === "true",
  }
}

/** Canonical form: fixed order, sorted lists, defaults omitted. */
export function serializeRoute(route: Route): string {
  const params = new URLSearchParams()
  if (route.repository) params.set("repository", route.repository)
  if (route.worktree) params.set("worktree", route.worktree)
  if (route.run) params.set("run", route.run)
  if (route.tab !== DEFAULT_ROUTE.tab) params.set("tab", route.tab)
  for (const kind of [...route.kinds].sort()) params.append("kind", kind)
  for (const status of [...route.statuses].sort()) params.append("status", status)
  for (const tool of [...route.tools].sort()) params.append("tool", tool)
  if (route.host) params.set("host", route.host)
  if (route.query) params.set("q", route.query)
  if (route.activeOnly) params.set("active", "true")
  const result = params.toString()
  return result ? `?${result}` : ""
}

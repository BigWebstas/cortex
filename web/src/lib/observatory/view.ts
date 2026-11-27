// Pure presentation rules for the Observatory screens.

import type {
  AgentRunEvent,
  Evidence,
  RepositorySummary,
  RunStatus,
  WorktreeSummary,
} from "../../../../docs/contracts/agent-observatory-types"

export function groupByHost(
  repositories: RepositorySummary[],
): Array<[string, RepositorySummary[]]> {
  const hosts = new Map<string, RepositorySummary[]>()
  for (const repository of repositories) {
    const items = hosts.get(repository.hostname) ?? []
    items.push(repository)
    hosts.set(repository.hostname, items)
  }
  return [...hosts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([host, items]) => [host, items.sort((a, b) => a.name.localeCompare(b.name))])
}

export function worktreeState(worktree: WorktreeSummary) {
  const counts: Array<[number | null, string]> = [
    [worktree.staged, "staged"],
    [worktree.unstaged, "unstaged"],
    [worktree.untracked, "untracked"],
    [worktree.ahead, "ahead"],
    [worktree.behind, "behind"],
  ]
  const facts = counts.filter(([count]) => count).map(([count, label]) => `${count} ${label}`)
  if (!worktree.dirty) facts.unshift("clean")
  if (worktree.locked) facts.push("locked")
  if (worktree.prunable) facts.push("prunable")
  if (worktree.removed_at) facts.push("removed")
  return {
    title: worktree.detached ? "Detached HEAD" : (worktree.branch ?? "No branch"),
    head: worktree.head_sha?.slice(0, 7) ?? null,
    facts,
  }
}

export type Attribution =
  | { state: "none" | "ambiguous"; path: null }
  | { state: "verified" | "unverified"; path: string }

/** A weak or contested relation is never presented as the run's worktree. */
export function attribution(evidence: Evidence[]): Attribution {
  const held = evidence.filter((item) => item.trust !== "refuted" && item.detail)
  const paths = (items: Evidence[]) => [...new Set(items.map((item) => item.detail as string))]
  const verified = paths(held.filter((item) => item.trust === "verified"))
  if (verified.length === 1) return { state: "verified", path: verified[0] }
  const all = paths(held)
  if (all.length === 0) return { state: "none", path: null }
  if (all.length > 1) return { state: "ambiguous", path: null }
  return { state: "unverified", path: all[0] }
}

function compareEvents(a: AgentRunEvent, b: AgentRunEvent): number {
  const byTime = a.observed_at.localeCompare(b.observed_at)
  if (byTime) return byTime
  const difference = BigInt(a.id) - BigInt(b.id)
  return difference > 0n ? 1 : difference < 0n ? -1 : 0
}

/** Union by ID, oldest first. Returns `current` itself when nothing is new. */
export function mergeEvents(current: AgentRunEvent[], incoming: AgentRunEvent[]): AgentRunEvent[] {
  const seen = new Set(current.map((item) => item.id))
  const added = incoming.filter((item) => !seen.has(item.id))
  return added.length ? [...current, ...added].sort(compareEvents) : current
}

export function relativeTime(timestamp: string, now: number): string {
  const then = Date.parse(timestamp)
  if (Number.isNaN(then)) return "unknown"
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

export function parseFreshness(json: string): Array<[string, string]> {
  try {
    return Object.entries(JSON.parse(json) as Record<string, { state?: unknown } | null>).flatMap(
      ([lane, value]) =>
        typeof value?.state === "string" ? [[lane, value.state] as [string, string]] : [],
    )
  } catch {
    return []
  }
}

export const STATUS_TONES: Record<RunStatus, "online" | "syncing" | "queued" | "degraded" | "offline" | "error"> = {
  starting: "syncing",
  active: "online",
  waiting: "queued",
  idle: "queued",
  stale: "degraded",
  completed: "offline",
  failed: "error",
  abandoned: "offline",
}

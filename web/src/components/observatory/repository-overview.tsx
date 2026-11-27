"use client"

import { Badge } from "@/components/ui/aurora/badge"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { getRepository, listRepositoryRuns, listWorktrees } from "../../lib/observatory/api"
import { usePagedList } from "../../lib/observatory/hooks"
import { worktreeState } from "../../lib/observatory/view"
import { inventoryOrRuns } from "../../lib/observatory/live-context"
import { LoadError } from "./shared"

const ACTIVE = ["starting", "active", "waiting", "idle"]

/** Shown when a repository is selected but no run is. */
export function RepositoryOverview({ repositoryId }: { repositoryId: string }) {
  const whole = { next_cursor: null, limit: 1, truncated: false }
  const repository = usePagedList(`overview:${repositoryId}`, () => async (token, options) => ({
    items: [await getRepository(token, repositoryId, options)],
    pagination: whole,
  }), inventoryOrRuns)
  const worktrees = usePagedList(`overview-worktrees:${repositoryId}`, () => async (token, options) => {
    const page = await listWorktrees(token, repositoryId, { limit: 200 }, options)
    return { items: page.worktrees, pagination: page.pagination }
  }, inventoryOrRuns)
  const runs = usePagedList(`overview-runs:${repositoryId}`, () => async (token, options) => {
    const page = await listRepositoryRuns(
      token,
      repositoryId,
      { active_only: true, limit: 200 },
      options,
    )
    return { items: page.runs, pagination: page.pagination }
  }, inventoryOrRuns)
  const error = repository.error ?? worktrees.error ?? runs.error

  if (error) {
    return (
      <LoadError
        message={error}
        onRetry={() => {
          repository.reload()
          worktrees.reload()
          runs.reload()
        }}
      />
    )
  }
  const summary = repository.items[0]
  if (!summary || worktrees.loading || runs.loading) return <Skeleton className="h-40" />
  const active = runs.items.filter((run) => ACTIVE.includes(run.status))

  return (
    <section className="grid gap-3" aria-label="Repository overview">
      <h2 className="aurora-text-section m-0 break-all">{summary.name}</h2>
      <p className="m-0 break-all text-sm text-[var(--aurora-text-muted)]">
        {summary.hostname} · {summary.primary_path}
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">{summary.worktree_count} worktrees</Badge>
        <Badge tone={summary.active_run_count ? "success" : "neutral"}>
          {summary.active_run_count} active runs
        </Badge>
        <Badge tone="neutral">
          {worktrees.items.filter((worktree) => worktree.dirty).length} with uncommitted changes
          {worktrees.hasMore && " (first 200)"}
        </Badge>
      </div>
      <ul className="m-0 grid list-none gap-2 p-0" aria-label="Worktree activity">
        {worktrees.items.map((worktree) => {
          const state = worktreeState(worktree)
          const here = active.filter((run) => run.primary_worktree_id === worktree.id)
          return (
            <li
              key={worktree.id}
              data-overview-worktree
              className="rounded-lg border border-[var(--aurora-border-default)] p-2 text-sm"
            >
              <span className="block break-all font-semibold">{state.title}</span>
              <span className="block break-all text-xs text-[var(--aurora-text-muted)]">
                {[state.head, ...state.facts].filter(Boolean).join(" · ")}
              </span>
              <span className="block text-xs">
                {here.length
                  ? `Active: ${here.map((run) => `${run.tool} ${run.native_session_id}`).join(", ")}`
                  : "No active run"}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

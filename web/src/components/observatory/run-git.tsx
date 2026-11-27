"use client"

import { Badge } from "@/components/ui/aurora/badge"
import { Button } from "@/components/ui/aurora/button"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import { Timeline, TimelineItem } from "@/components/ui/aurora/timeline"
import type { AgentRunDetail } from "../../../../docs/contracts/agent-observatory-types"
import { gitEntry } from "../../lib/observatory/activity"
import { listEvents } from "../../lib/observatory/api"
import { usePagedList } from "../../lib/observatory/hooks"
import { thisRun } from "../../lib/observatory/live-context"
import { LoadError, When } from "./shared"

function LatestCommit({ commit }: { commit: NonNullable<AgentRunDetail["commit_summary"]> }) {
  const exact = commit.evidence.some((item) => item.trust === "verified")
  return (
    <section className="grid gap-2" aria-label="Latest related commit">
      <h3 className="aurora-text-eyebrow m-0">Latest related commit</h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="aurora-mono">{commit.sha.slice(0, 7)}</span>
        <span className="break-words text-sm font-semibold">{commit.subject}</span>
        <Badge tone={exact ? "success" : "warn"}>
          {exact ? "Verified attribution" : "Inferred attribution"}
        </Badge>
        {!commit.reachable && <Badge tone="warn">No longer reachable</Badge>}
      </div>
      <p className="m-0 text-xs text-[var(--aurora-text-muted)]">
        {commit.author_name ?? "author not recorded"}
        {commit.committed_at && (
          <>
            {" · "}
            <When value={commit.committed_at} />
          </>
        )}
        {commit.changed_files !== null && ` · ${commit.changed_files} files`}
        {commit.insertions !== null && ` · +${commit.insertions}`}
        {commit.deletions !== null && ` −${commit.deletions}`}
      </p>
      <ul className="m-0 grid list-none gap-1 p-0 text-xs" aria-label="Commit evidence">
        {commit.evidence.map((item, index) => (
          <li key={index}>
            {item.trust} · confidence {Math.round(item.confidence * 100)}% · {item.kind} from{" "}
            {item.source}
          </li>
        ))}
      </ul>
      {commit.changed_paths.length > 0 && (
        <ul className="aurora-mono m-0 max-h-40 list-none overflow-y-auto p-0 text-xs" aria-label="Changed paths" tabIndex={0}>
          {commit.changed_paths.map((path) => (
            <li key={path} className="break-all">
              {path}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function RunGit({ detail }: { detail: AgentRunDetail }) {
  const runKey = detail.run.run_key
  const list = usePagedList(`git:${runKey}`, (cursor) => async (token, options) => {
    const page = await listEvents(
      token,
      runKey,
      { cursor, limit: 100, kind: ["git_head", "git_status", "git_commit"], include: "payload" },
      options,
    )
    return { items: page.events, pagination: page.pagination }
  }, thisRun(runKey))

  return (
    <div className="grid gap-4">
      {detail.commit_summary ? (
        <LatestCommit commit={detail.commit_summary} />
      ) : (
        <p className="m-0 text-sm">No commit has been related to this run.</p>
      )}
      <section className="grid gap-2" aria-label="Git history">
        <div className="flex items-center justify-between gap-2">
          <h3 className="aurora-text-eyebrow m-0">Observed history, newest first</h3>
          <Button type="button" size="sm" onClick={list.reload}>
            Refresh
          </Button>
        </div>
        {list.loading && <Skeleton className="h-24" />}
        {list.error && <LoadError message={list.error} onRetry={list.reload} />}
        {!list.loading && !list.error && list.items.length === 0 && (
          <EmptyState
            title="No Git observations"
            description="The Git observer has not related anything to this run."
          />
        )}
        <Timeline className="m-0 list-none p-0">
          {list.items.map((event) => {
            const entry = gitEntry(event)
            return (
              <TimelineItem
                key={event.id}
                data-git-entry
                tone={entry.fastForward === false ? "degraded" : "queued"}
                title={
                  entry.from && entry.to
                    ? `HEAD ${entry.from} → ${entry.to}`
                    : entry.to
                      ? `HEAD ${entry.to}`
                      : event.title
                }
                meta={
                  <>
                    {entry.trust} · <When value={event.observed_at} />
                  </>
                }
              >
                <span className="block break-words">
                  {event.summary}
                  {entry.transition && ` · ${entry.transition}`}
                  {entry.fastForward === false && " · history rewritten"}
                </span>
                {entry.added.length > 0 && (
                  <span className="aurora-mono block">added {entry.added.join(" ")}</span>
                )}
                {entry.displaced.length > 0 && (
                  <span className="aurora-mono block">displaced {entry.displaced.join(" ")}</span>
                )}
                {entry.worktree && <span className="block break-all">{entry.worktree}</span>}
              </TimelineItem>
            )
          })}
        </Timeline>
        {list.hasMore && (
          <Button type="button" size="sm" onClick={list.loadMore} loading={list.loadingMore}>
            Load older observations
          </Button>
        )}
      </section>
    </div>
  )
}

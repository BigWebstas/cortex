"use client"

import { type KeyboardEvent, useState } from "react"

import { Badge } from "@/components/ui/aurora/badge"
import { Button } from "@/components/ui/aurora/button"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import type { RepositorySummary } from "../../../../docs/contracts/agent-observatory-types"
import { listRepositories, listWorktrees } from "../../lib/observatory/api"
import { usePagedList, useRoute } from "../../lib/observatory/hooks"
import { groupByHost, worktreeState } from "../../lib/observatory/view"
import { LoadError, Toggle } from "./shared"

const ROW = "w-full justify-start rounded-lg px-2 py-1.5 text-left"

/** Up and Down move between the navigator's entries. */
function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
  const entries = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-nav-entry]")]
  const at = entries.indexOf(document.activeElement as HTMLElement)
  const next = entries[at + (event.key === "ArrowDown" ? 1 : -1)]
  if (at < 0 || !next) return
  event.preventDefault()
  next.focus()
}

function Worktrees({ repositoryId, showRemoved }: { repositoryId: string; showRemoved: boolean }) {
  const { route, navigate } = useRoute()
  const list = usePagedList(`worktrees:${repositoryId}:${showRemoved}`, (cursor) => async (token, options) => {
    const page = await listWorktrees(
      token,
      repositoryId,
      { cursor, include_removed: showRemoved },
      options,
    )
    return { items: page.worktrees, pagination: page.pagination }
  })

  if (list.loading) return <Skeleton className="ml-4 h-10" />
  if (list.error) return <LoadError message={list.error} onRetry={list.reload} />
  return (
    <ul className="ml-4 grid gap-1" aria-label="Worktrees">
      {list.items.length === 0 && <li className="px-2 text-xs">No worktrees observed.</li>}
      {list.items.map((worktree) => {
        const state = worktreeState(worktree)
        const selected = route.worktree === worktree.id
        return (
          <li key={worktree.id}>
            <Button
              type="button"
              variant="plain"
              size="unstyled"
              className={`${ROW} block`}
              data-nav-entry
              aria-current={selected ? "true" : undefined}
              style={selected ? { background: "var(--aurora-hover-bg)" } : undefined}
              title={worktree.path}
              onClick={() =>
                navigate({ repository: repositoryId, worktree: worktree.id, run: null })
              }
            >
              <span className="block truncate text-[13px] font-semibold">{state.title}</span>
              <span className="block truncate text-xs text-[var(--aurora-text-muted)]">
                {[state.head, ...state.facts].filter(Boolean).join(" · ")}
              </span>
            </Button>
          </li>
        )
      })}
      {list.hasMore && (
        <li>
          <Button type="button" size="sm" onClick={list.loadMore} loading={list.loadingMore}>
            More worktrees
          </Button>
        </li>
      )}
    </ul>
  )
}

export function RepositoryNavigator() {
  const { route, navigate } = useRoute()
  const [showRemoved, setShowRemoved] = useState(false)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const list = usePagedList(`repositories:${showRemoved}`, (cursor) => async (token, options) => {
    const page = await listRepositories(
      token,
      { cursor, limit: 100, include_removed: showRemoved },
      options,
    )
    return { items: page.repositories, pagination: page.pagination }
  })
  const isOpen = (repository: RepositorySummary) =>
    opened[repository.id] ?? route.repository === repository.id

  return (
    <nav className="grid gap-2" aria-label="Repositories" onKeyDown={moveFocus}>
      <div className="flex flex-wrap gap-2">
        <Toggle
          pressed={!route.repository && !route.worktree}
          onToggle={() => navigate({ repository: null, worktree: null, run: null })}
        >
          All runs
        </Toggle>
        <Toggle pressed={showRemoved} onToggle={() => setShowRemoved((value) => !value)}>
          Show removed
        </Toggle>
      </div>
      {list.loading && <Skeleton className="h-24" />}
      {list.error && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.loading && !list.error && list.items.length === 0 && (
        <EmptyState
          title="No repositories"
          description="Cortex has not observed a Git repository yet."
        />
      )}
      {groupByHost(list.items).map(([host, repositories]) => (
        <section key={host} className="grid gap-1" aria-label={`Host ${host}`}>
          <span className="aurora-text-eyebrow">{host}</span>
          <ul className="grid gap-1">
            {repositories.map((repository) => (
              <li key={repository.id} className="grid gap-1">
                <Button
                  type="button"
                  variant="plain"
                  size="unstyled"
                  className={`${ROW} flex items-center gap-2`}
                  data-nav-entry
                  aria-expanded={isOpen(repository)}
                  aria-current={
                    route.repository === repository.id && !route.worktree ? "true" : undefined
                  }
                  title={repository.primary_path}
                  onKeyDown={(event: KeyboardEvent) => {
                    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
                    event.preventDefault()
                    setOpened({ ...opened, [repository.id]: event.key === "ArrowRight" })
                  }}
                  onClick={() => {
                    setOpened({ ...opened, [repository.id]: !isOpen(repository) })
                    navigate({ repository: repository.id, worktree: null, run: null })
                  }}
                >
                  <span aria-hidden="true">{isOpen(repository) ? "▾" : "▸"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {repository.name}
                  </span>
                  <Badge tone={repository.active_run_count ? "success" : "neutral"}>
                    {repository.active_run_count} active
                  </Badge>
                  {repository.removed_at && <Badge tone="warn">removed</Badge>}
                </Button>
                {isOpen(repository) && (
                  <Worktrees repositoryId={repository.id} showRemoved={showRemoved} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {list.hasMore && (
        <Button type="button" size="sm" onClick={list.loadMore} loading={list.loadingMore}>
          More repositories
        </Button>
      )}
    </nav>
  )
}

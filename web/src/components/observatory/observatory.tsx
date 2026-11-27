"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/aurora/button"
import { EmptyState } from "@/components/ui/aurora/empty-state"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/aurora/sheet"
import { Skeleton } from "@/components/ui/aurora/skeleton"
import type { AgentRunDetail } from "../../../../docs/contracts/agent-observatory-types"
import { getRun } from "../../lib/observatory/api"
import { AuthProvider, useAuth } from "../../lib/observatory/auth-context"
import { errorText, useAuthorizedCall, useRoute } from "../../lib/observatory/hooks"
import { ConnectionCard } from "./connection-card"
import { RepositoryNavigator } from "./repository-navigator"
import { RunHeader } from "./run-header"
import { RunList } from "./run-list"
import { RunTimeline, TimelineFilters } from "./run-timeline"
import { LoadError } from "./shared"

function SelectedRun({ runKey }: { runKey: string }) {
  const { route } = useRoute()
  const call = useAuthorizedCall()
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ detail?: AgentRunDetail; error?: string } | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    call((token, options) => getRun(token, runKey, options), abort.signal)
      .then((detail) => setResult({ detail }))
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setResult({ error: errorText(error) })
      })
    return () => abort.abort()
  }, [call, runKey, attempt])

  if (!result) return <Skeleton className="h-60" />
  if (!result.detail) {
    return (
      <LoadError
        message={result.error ?? "Request failed"}
        onRetry={() => {
          setResult(null)
          setAttempt((value) => value + 1)
        }}
      />
    )
  }
  return (
    <div className="grid gap-4">
      <RunHeader detail={result.detail} />
      <TimelineFilters available={result.detail.available_event_kinds} />
      <RunTimeline key={route.kinds.join(",")} runKey={runKey} kinds={route.kinds} />
    </div>
  )
}

function Workspace() {
  const { route, navigate } = useRoute()
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] xl:grid-cols-[280px_360px_minmax(0,1fr)]">
      <div className="xl:hidden md:col-span-2">
        <Sheet>
          <SheetTrigger asChild>
            <Button type="button">Repositories</Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Repositories</SheetTitle>
              <SheetDescription>Choose a repository or worktree.</SheetDescription>
            </SheetHeader>
            <SheetBody className="overflow-y-auto">
              <RepositoryNavigator />
            </SheetBody>
          </SheetContent>
        </Sheet>
      </div>
      <div className="hidden min-w-0 xl:block">
        <RepositoryNavigator />
      </div>
      {/* On a narrow screen a selected run replaces the list. */}
      <div className={`min-w-0 ${route.run ? "hidden md:block" : ""}`}>
        <RunList />
      </div>
      <div className={`min-w-0 ${route.run ? "" : "hidden md:block"}`}>
        {route.run ? (
          <div className="grid gap-3">
            <Button type="button" className="justify-self-start md:hidden" onClick={() => navigate({ run: null })}>
              Back to runs
            </Button>
            <SelectedRun key={route.run} runKey={route.run} />
          </div>
        ) : (
          <EmptyState
            title="No run selected"
            description="Pick a repository, then a run. Press / to search runs."
          />
        )}
      </div>
    </div>
  )
}

function ConnectedWorkspace() {
  const { snapshot } = useAuth()
  // A new token starts every list again.
  return snapshot.status === "connected" ? <Workspace key={snapshot.epoch} /> : null
}

export function Observatory() {
  return (
    <AuthProvider>
      <div className="grid gap-3">
        <ConnectionCard />
        <ConnectedWorkspace />
      </div>
    </AuthProvider>
  )
}

"use client"

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@/components/ui/aurora/badge"
import { Banner } from "@/components/ui/aurora/banner"
import { Button } from "@/components/ui/aurora/button"
import { Card, CardContent } from "@/components/ui/aurora/card"
import { Input } from "@/components/ui/aurora/input"
import {
  type AppEntitySummary,
  type AppGraphEvidenceResponse,
  type AppGraphResponse,
  type AppLogSummary,
  type HostSourceInput,
  INVESTIGATION_UI_VERSION,
  type InvestigationClaim,
  type InvestigationMetadata,
} from "../../contracts/investigation"
import {
  type GraphElements,
  EMPTY_GRAPH,
  type GraphNodeData,
  SEED_GRAPH,
  graphFromHosts,
  graphFromInvestigation,
  mergeAppGraphs,
  normalizeHostSources,
} from "../../lib/host-sources"
import {
  CortexApiError,
  askInvestigation,
  explainGraphEntity,
  getGraphAround,
  getGraphEvidence,
  getHosts,
  getInvestigationVersion,
  getRecentLogs,
  getServerStats,
  getServerVersion,
} from "../../lib/investigation-api"
import { AuthProvider, useAuth } from "../../lib/observatory/auth-context"
import { AskPanel, type StatusCardMessage } from "./ask-panel"
import { EvidencePanel, type InspectorSelection } from "./evidence-panel"
import { GraphCanvas } from "./graph-canvas"
import { TimelinePanel } from "./timeline-panel"

interface V1Status {
  title: string
  detail: string
  tone: "ok" | "warn"
}

const INITIAL_STATUS_CARD: StatusCardMessage = {
  tone: "cyan",
  badge: "Ready",
  title: "Enter a token to load live evidence.",
  body: "The app keeps the bearer token in memory only. It is never embedded in the HTML or written to local storage.",
}

function linkAbortSignal(parent: AbortSignal): { controller: AbortController; detach: () => void } {
  const controller = new AbortController()
  if (parent.aborted) {
    controller.abort()
    return { controller, detach: () => {} }
  }
  const onAbort = () => controller.abort()
  parent.addEventListener("abort", onAbort, { once: true })
  return { controller, detach: () => parent.removeEventListener("abort", onAbort) }
}

function InvestigationWorkspaceInner() {
  const { session, snapshot } = useAuth()
  const connected = snapshot.status === "connected"

  const [serverVersion, setServerVersion] = useState("Unknown")
  const [schemaVersion, setSchemaVersion] = useState("Waiting for token")
  const [hostCount, setHostCount] = useState("--")
  const [logCount, setLogCount] = useState("--")
  const [v1Status, setV1Status] = useState<V1Status>({
    title: "Disconnected",
    detail: "Enter a bearer token to check /api/v1",
    tone: "warn",
  })

  const [latestHosts, setLatestHosts] = useState<HostSourceInput[]>([])
  const [latestLogs, setLatestLogs] = useState<AppLogSummary[]>([])
  const [logStatus, setLogStatus] = useState<{
    label: string
    tone: "neutral" | "success" | "warn" | "error"
  }>({ label: "Preview", tone: "neutral" })

  const [prompt, setPrompt] = useState("")
  const [hostHint, setHostHint] = useState("")
  const [sinceHint, setSinceHint] = useState("")
  const [askState, setAskState] = useState<"idle" | "pending" | "complete" | "failed">("idle")
  const [statusCard, setStatusCard] = useState<StatusCardMessage | null>(INITIAL_STATUS_CARD)

  const [claims, setClaims] = useState<InvestigationClaim[]>([])
  const [activeClaimIndex, setActiveClaimIndex] = useState<number | null>(null)
  const [openQuestions, setOpenQuestions] = useState<string[]>([])
  const [nextQueries, setNextQueries] = useState<string[]>([])
  const [candidates, setCandidates] = useState<AppEntitySummary[]>([])
  const [metadata, setMetadata] = useState<InvestigationMetadata | null>(null)

  const [activeAppGraph, setActiveAppGraph] = useState<AppGraphResponse | null>(null)
  const [graphElements, setGraphElements] = useState<GraphElements>(SEED_GRAPH)
  const [selection, setSelection] = useState<InspectorSelection>({ kind: "none" })

  const [selectedProof, setSelectedProof] = useState<AppGraphEvidenceResponse | null>(null)
  const [proofLoadingId, setProofLoadingId] = useState<number | null>(null)
  const [proofError, setProofError] = useState<string | null>(null)
  const [isGraphBusy, setIsGraphBusy] = useState(false)

  const tokenFormRef = useRef<HTMLFormElement | null>(null)
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const detachSignalRef = useRef<(() => void) | null>(null)

  const beginRequest = useCallback((sessionSignal: AbortSignal) => {
    abortRef.current?.abort()
    detachSignalRef.current?.()
    const { controller, detach } = linkAbortSignal(sessionSignal)
    abortRef.current = controller
    detachSignalRef.current = detach
    const generation = ++generationRef.current
    return { generation, signal: controller.signal }
  }, [])

  const resetEvidenceInspector = useCallback(() => {
    setSelection({ kind: "none" })
    setSelectedProof(null)
    setProofError(null)
    setProofLoadingId(null)
    setIsGraphBusy(false)
  }, [])

  // Drops everything loaded with the current token and invalidates in-flight requests.
  const resetSessionData = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    detachSignalRef.current?.()
    detachSignalRef.current = null
    ++generationRef.current
    setServerVersion("--")
    setSchemaVersion("Schema --")
    setHostCount("--")
    setLogCount("--")
    setV1Status({
      title: "Disconnected",
      detail: "Enter a bearer token to check /api/v1",
      tone: "warn",
    })
    setLatestHosts([])
    setLatestLogs([])
    setActiveAppGraph(null)
    setGraphElements(EMPTY_GRAPH)
    setClaims([])
    setActiveClaimIndex(null)
    setOpenQuestions([])
    setNextQueries([])
    setCandidates([])
    setMetadata(null)
    resetEvidenceInspector()
    setAskState("idle")
    setLogStatus({ label: "Disconnected", tone: "neutral" })
  }, [resetEvidenceInspector])

  const clearSessionState = useCallback(
    (reasonCard: StatusCardMessage, mode: "clear" | "unauthorized" = "clear", epoch?: number) => {
      tokenFormRef.current?.reset()
      resetSessionData()
      if (mode === "unauthorized") {
        session.unauthorized(epoch)
      } else {
        session.clear()
      }
      setStatusCard(reasonCard)
    },
    [resetSessionData, session],
  )

  const handleUnauthorizedIfNeeded = useCallback(
    (error: unknown, epoch: number): boolean => {
      if (error instanceof CortexApiError && (error.status === 401 || error.status === 403)) {
        clearSessionState(
          {
            tone: "error",
            badge: "Unauthorized",
            title: "Authentication rejected (401)",
            body: "The bearer token was cleared from memory. Enter a valid CORTEX_API_TOKEN to reconnect.",
          },
          "unauthorized",
          epoch,
        )
        return true
      }
      return false
    },
    [clearSessionState],
  )

  const refreshWithToken = useCallback(
    async (token: string, epoch: number, sessionSignal: AbortSignal) => {
      const { generation, signal } = beginRequest(sessionSignal)
      setAskState("idle")
      resetEvidenceInspector()
      if (!token) {
        setStatusCard({
          tone: "warn",
          badge: "Token required",
          title: "Bearer token required",
          body: "Enter CORTEX_API_TOKEN to load live API data.",
        })
        return
      }

      try {
        try {
          const v1 = await getInvestigationVersion(token, signal)
          if (generation !== generationRef.current || signal.aborted) return
          if (v1.ui_version && v1.ui_version !== INVESTIGATION_UI_VERSION) {
            setV1Status({
              title: "Version skew",
              detail: `Server expects ${v1.ui_version}`,
              tone: "warn",
            })
          } else {
            setV1Status({
              title: "Compatible",
              detail: "Investigation API v1 is available",
              tone: "ok",
            })
          }
        } catch (v1Error) {
          if (generation !== generationRef.current || signal.aborted) return
          if (handleUnauthorizedIfNeeded(v1Error, epoch)) return
          setV1Status({
            title: "Unavailable",
            detail: "/api/v1 is not mounted; Ask + Explain is disabled",
            tone: "warn",
          })
        }

        const [version, stats, hosts, tail] = await Promise.all([
          getServerVersion(token, signal),
          getServerStats(token, signal),
          getHosts(token, signal),
          getRecentLogs(token, 25, signal),
        ])
        if (generation !== generationRef.current || signal.aborted) return

        const hostItems = hosts.hosts ?? hosts.items ?? []
        const logItems = tail.logs ?? tail.entries ?? tail.items ?? []
        setLatestHosts(hostItems)
        setLatestLogs(logItems)
        setServerVersion(version.version || "Unknown")
        setSchemaVersion(`Schema ${version.schema_version ?? "--"}`)
        setHostCount(
          String(
            normalizeHostSources(hostItems).filter((source) => source.source_kind === "host").length,
          ),
        )
        setLogCount(String(stats.total_logs ?? stats.total ?? "--"))
        setLogStatus({ label: "Live", tone: "success" })
        setActiveAppGraph(null)
        setGraphElements(graphFromHosts(hostItems))
        setClaims([])
        setActiveClaimIndex(null)
        setOpenQuestions([])
        setNextQueries([])
        setCandidates([])
        setMetadata(null)
        resetEvidenceInspector()
        setStatusCard({
          tone: "success",
          badge: "Connected",
          title: "Live workspace connected",
          body: "Cortex returned version, stats, hosts, and recent log evidence. Ask a question or select a host to explore the graph.",
        })
      } catch (error) {
        if (generation !== generationRef.current || signal.aborted) return
        if (error instanceof DOMException && error.name === "AbortError") return
        if (handleUnauthorizedIfNeeded(error, epoch)) return
        setLogStatus({ label: "Error", tone: "error" })
        setStatusCard({
          tone: "error",
          badge: "Error",
          title: "Backend unavailable",
          body: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [beginRequest, handleUnauthorizedIfNeeded, resetEvidenceInspector],
  )

  useEffect(
    () => () => {
      abortRef.current?.abort()
      detachSignalRef.current?.()
    },
    [],
  )

  const runAsk = useCallback(
    async (queryText: string, overrideHost?: string) => {
      const trimmed = queryText.trim()
      if (!trimmed) return
      const token = session.getToken()
      if (!token || snapshot.status !== "connected") {
        setStatusCard({
          tone: "warn",
          badge: "Token required",
          title: "Bearer token required",
          body: "Connect with CORTEX_API_TOKEN before asking Cortex for live evidence.",
        })
        return
      }

      const epoch = snapshot.epoch
      const { generation, signal } = beginRequest(snapshot.signal)
      setAskState("pending")
      resetEvidenceInspector()
      try {
        const envelope = await askInvestigation(
          token,
          {
            prompt: trimmed,
            host: overrideHost ?? hostHint,
            since: sinceHint || undefined,
          },
          signal,
        )
        if (generation !== generationRef.current || signal.aborted) return

        resetEvidenceInspector()
        const { result, metadata: envMeta } = envelope
        setMetadata(envMeta)
        setLatestLogs(result.logs ?? [])
        setClaims(result.claims ?? [])
        setOpenQuestions(result.open_questions ?? [])
        setNextQueries(result.next_queries ?? [])
        setCandidates(result.candidates ?? [])
        setActiveAppGraph(result.graph)
        setGraphElements(graphFromInvestigation(result.graph))

        if (result.claims.length > 0) {
          setActiveClaimIndex(0)
          setSelection({ kind: "claim", claim: result.claims[0] })
          setStatusCard(null)
        } else {
          setActiveClaimIndex(null)
          setSelection({ kind: "none" })
          setStatusCard({
            tone: "warn",
            badge: "Open question",
            title: trimmed,
            body: "Cortex returned no claims for this investigation.",
          })
        }

        if (envMeta.partial || envMeta.truncated) {
          setLogStatus({ label: "Partial", tone: "warn" })
        } else {
          setLogStatus({ label: "Explained", tone: "success" })
        }
        setAskState("complete")
      } catch (error) {
        if (generation !== generationRef.current || signal.aborted) return
        if (error instanceof DOMException && error.name === "AbortError") return
        if (handleUnauthorizedIfNeeded(error, epoch)) return
        setAskState("failed")
        setClaims([])
        setActiveClaimIndex(null)
        setStatusCard({
          tone: "error",
          badge: "Error",
          title: "Ask failed",
          body: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [
      beginRequest,
      handleUnauthorizedIfNeeded,
      hostHint,
      resetEvidenceInspector,
      session,
      sinceHint,
      snapshot,
    ],
  )

  const handleTokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const raw = new FormData(form).get("token")
    const nextToken = typeof raw === "string" ? raw.trim() : ""
    // Empty the input immediately so the secret never remains in the DOM.
    form.reset()
    resetSessionData()
    if (!nextToken) {
      session.clear()
      setStatusCard({
        tone: "warn",
        badge: "Token required",
        title: "Bearer token required",
        body: "Enter CORTEX_API_TOKEN to load live API data.",
      })
      return
    }
    session.connect(nextToken)
    const next = session.getSnapshot()
    void refreshWithToken(nextToken, next.epoch, next.signal)
  }

  const handleAskSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runAsk(prompt)
  }

  const handleExpandNode = useCallback(
    async (node: GraphNodeData) => {
      const token = session.getToken()
      if (!token || snapshot.status !== "connected") return
      const query = node.entity_id
        ? { entity_id: node.entity_id }
        : node.entity_type && node.entity_key
          ? { entity_type: node.entity_type, key: node.entity_key }
          : null
      if (!query) return

      setIsGraphBusy(true)
      setProofError(null)
      const epoch = snapshot.epoch
      const generation = generationRef.current
      try {
        const envelope = await getGraphAround(token, query)
        if (generation !== generationRef.current) return
        setMetadata(envelope.metadata)
        setActiveAppGraph((prev) => {
          const merged = mergeAppGraphs(prev, envelope.result)
          setGraphElements(graphFromInvestigation(merged))
          return merged
        })
      } catch (error) {
        if (generation !== generationRef.current) return
        if (!handleUnauthorizedIfNeeded(error, epoch)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setIsGraphBusy(false)
      }
    },
    [handleUnauthorizedIfNeeded, session, snapshot],
  )

  const handleExplainNode = useCallback(
    async (node: GraphNodeData) => {
      const token = session.getToken()
      if (!token || snapshot.status !== "connected") return
      const query = node.entity_id
        ? { entity_id: node.entity_id }
        : node.entity_type && node.entity_key
          ? { entity_type: node.entity_type, key: node.entity_key }
          : null
      if (!query) return

      setIsGraphBusy(true)
      setProofError(null)
      const epoch = snapshot.epoch
      const generation = generationRef.current
      try {
        const envelope = await explainGraphEntity(token, query)
        if (generation !== generationRef.current) return
        setMetadata(envelope.metadata)
        setActiveAppGraph(envelope.result)
        setGraphElements(graphFromInvestigation(envelope.result))
      } catch (error) {
        if (generation !== generationRef.current) return
        if (!handleUnauthorizedIfNeeded(error, epoch)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setIsGraphBusy(false)
      }
    },
    [handleUnauthorizedIfNeeded, session, snapshot],
  )

  const handleSelectCandidate = useCallback(
    async (candidate: AppEntitySummary) => {
      const token = session.getToken()
      if (!token || snapshot.status !== "connected") return
      setIsGraphBusy(true)
      setProofError(null)
      const epoch = snapshot.epoch
      const generation = generationRef.current
      try {
        const envelope = await explainGraphEntity(token, { entity_id: candidate.id })
        if (generation !== generationRef.current) return
        setMetadata(envelope.metadata)
        setActiveAppGraph(envelope.result)
        setGraphElements(graphFromInvestigation(envelope.result))
        setSelection({
          kind: "node",
          node: {
            id: `entity:${candidate.id}`,
            label: candidate.label || candidate.key,
            kind: candidate.entity_type,
            entity_id: candidate.id,
            entity_type: candidate.entity_type,
            entity_key: candidate.key,
            status: candidate.trust_level === "verified" ? "online" : "observed",
            trust_level: candidate.trust_level,
          },
        })
      } catch (error) {
        if (generation !== generationRef.current) return
        if (!handleUnauthorizedIfNeeded(error, epoch)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setIsGraphBusy(false)
      }
    },
    [handleUnauthorizedIfNeeded, session, snapshot],
  )

  const handleInspectEvidence = useCallback(
    async (evidenceId: number) => {
      const token = session.getToken()
      if (!token || snapshot.status !== "connected") return
      setProofLoadingId(evidenceId)
      setProofError(null)
      const epoch = snapshot.epoch
      const generation = generationRef.current
      try {
        const envelope = await getGraphEvidence(token, evidenceId)
        if (generation !== generationRef.current) return
        setSelectedProof(envelope.result)
      } catch (error) {
        if (generation !== generationRef.current) return
        if (!handleUnauthorizedIfNeeded(error, epoch)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setProofLoadingId(null)
      }
    },
    [handleUnauthorizedIfNeeded, session, snapshot],
  )

  const knownHostNames = useMemo(
    () =>
      normalizeHostSources(latestHosts)
        .filter((item) => item.source_kind === "host")
        .map((item) => item.hostname),
    [latestHosts],
  )

  const highlightedRelationshipIds = useMemo(() => {
    if (selection.kind === "claim") return selection.claim.relationship_ids
    if (selection.kind === "edge" && selection.edge.relationship_id) {
      return [selection.edge.relationship_id]
    }
    return []
  }, [selection])

  const highlightedEntityIds = useMemo(() => {
    if (!activeAppGraph || highlightedRelationshipIds.length === 0) return []
    const relSet = new Set(highlightedRelationshipIds)
    const ids = new Set<number>()
    for (const rel of activeAppGraph.relationships) {
      if (relSet.has(rel.id)) {
        ids.add(rel.source_entity_id)
        ids.add(rel.target_entity_id)
      }
    }
    return Array.from(ids)
  }, [activeAppGraph, highlightedRelationshipIds])

  const selectedNode = selection.kind === "node" ? selection.node : null
  const canDrillDown = Boolean(
    connected && selectedNode && (selectedNode.entity_id || selectedNode.entity_key),
  )

  return (
    <div className="grid gap-3.5">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <header>
            <h1 className="m-0 text-2xl font-extrabold tracking-tight">
              Cortex investigation workspace
            </h1>
            <p className="mt-1 mb-0 text-[13px] text-[var(--aurora-text-muted)]">
              Graph, evidence, timeline, and log context for the homelab fleet.
            </p>
          </header>

          <form
            ref={tokenFormRef}
            className="grid gap-1.5 w-full lg:w-[min(440px,42vw)]"
            data-token-form
            onSubmit={handleTokenSubmit}
          >
            <label className="aurora-meta-label" htmlFor="api-token">
              Bearer token {connected ? "(connected in memory)" : ""}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                id="api-token"
                name="token"
                type="password"
                autoComplete="off"
                placeholder={connected ? "Token stored in memory" : "CORTEX_API_TOKEN"}
              />
              <Button type="submit" variant="aurora">
                Connect
              </Button>
              <Button
                type="button"
                variant="neutral"
                data-clear-token
                onClick={() =>
                  clearSessionState({
                    tone: "warn",
                    badge: "Disconnected",
                    title: "Bearer token cleared",
                    body: "The token was removed from memory.",
                  })
                }
              >
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Runtime status"
      >
        <Card elevated={false}>
          <CardContent className="p-3.5 grid gap-1.5 content-start min-h-[92px]">
            <span className="aurora-meta-label">Server</span>
            <strong className="text-2xl font-extrabold leading-none" data-server-version>
              {serverVersion}
            </strong>
            <small className="text-xs text-[var(--aurora-text-muted)]" data-schema-version>
              {schemaVersion}
            </small>
          </CardContent>
        </Card>
        <Card elevated={false}>
          <CardContent className="p-3.5 grid gap-1.5 content-start min-h-[92px]">
            <span className="aurora-meta-label">Fleet</span>
            <strong className="text-2xl font-extrabold leading-none" data-host-count>
              {hostCount}
            </strong>
            <small className="text-xs text-[var(--aurora-text-muted)]">Known hosts</small>
          </CardContent>
        </Card>
        <Card elevated={false}>
          <CardContent className="p-3.5 grid gap-1.5 content-start min-h-[92px]">
            <span className="aurora-meta-label">Ingest</span>
            <strong className="text-2xl font-extrabold leading-none" data-log-count>
              {logCount}
            </strong>
            <small className="text-xs text-[var(--aurora-text-muted)]">Total rows</small>
          </CardContent>
        </Card>
        <Card
          elevated={false}
          className={
            v1Status.tone === "warn"
              ? "!border-[color-mix(in_srgb,var(--aurora-warn)_50%,var(--aurora-border-strong))]"
              : undefined
          }
          data-v1-state
        >
          <CardContent className="p-3.5 grid gap-1.5 content-start min-h-[92px]">
            <span className="aurora-meta-label">Investigation API</span>
            <strong className="text-2xl font-extrabold leading-none">{v1Status.title}</strong>
            <small className="text-xs text-[var(--aurora-text-muted)]">{v1Status.detail}</small>
          </CardContent>
        </Card>
      </section>

      {metadata &&
        (metadata.degraded_reasons.length > 0 ||
          metadata.truncated ||
          metadata.partial ||
          metadata.version_skew) && (
          <section className="grid gap-2" aria-label="Investigation diagnostics">
            {metadata.degraded_reasons.length > 0 && (
              <Banner variant="error" kind="tag">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong className="text-[var(--aurora-text-primary)]">
                      Graph projection degraded:
                    </strong>{" "}
                    {metadata.degraded_reasons.join("; ")}
                  </span>
                  {metadata.graph_projection_status && (
                    <Badge tone="error">{metadata.graph_projection_status}</Badge>
                  )}
                </span>
              </Banner>
            )}
            {(metadata.truncated || metadata.partial) && (
              <Banner variant="warn" kind="tag">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong className="text-[var(--aurora-text-primary)]">
                      Partial or truncated result:
                    </strong>{" "}
                    {[...metadata.truncation_reasons, ...metadata.partial_reasons]
                      .filter(Boolean)
                      .join(", ") || "bounded by server budget"}
                  </span>
                  <span className="aurora-mono text-xs text-[var(--aurora-text-muted)]">
                    {metadata.budget_used.graph_calls}/{metadata.budget.max_graph_calls} graph ·{" "}
                    {metadata.budget_used.log_rows}/{metadata.budget.max_log_rows} logs ·{" "}
                    {metadata.budget_used.wall_time_ms}ms
                  </span>
                </span>
              </Banner>
            )}
            {metadata.version_skew && (
              <Banner variant="warn" kind="tag">
                <strong className="text-[var(--aurora-text-primary)]">
                  Client/server version skew:
                </strong>{" "}
                {metadata.version_skew}
              </Banner>
            )}
          </section>
        )}

      <AskPanel
        prompt={prompt}
        hostHint={hostHint}
        sinceHint={sinceHint}
        knownHosts={knownHostNames}
        askState={askState}
        claims={claims}
        activeClaimIndex={activeClaimIndex}
        openQuestions={openQuestions}
        nextQueries={nextQueries}
        candidates={candidates}
        statusMessage={statusCard}
        onPromptChange={setPrompt}
        onHostHintChange={setHostHint}
        onSinceHintChange={setSinceHint}
        onSubmit={handleAskSubmit}
        onSelectClaim={(claim, index) => {
          setActiveClaimIndex(index)
          setSelection({ kind: "claim", claim })
          setSelectedProof(null)
        }}
        onRunSuggestedQuery={(suggestion) => {
          setPrompt(suggestion)
          void runAsk(suggestion)
        }}
        onSelectCandidate={(candidate) => {
          void handleSelectCandidate(candidate)
        }}
      />

      <section
        className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]"
        aria-label="Graph and evidence workspace"
      >
        <GraphCanvas
          elements={graphElements}
          highlightedRelationshipIds={highlightedRelationshipIds}
          highlightedEntityIds={highlightedEntityIds}
          selectedNodeId={selection.kind === "node" ? selection.node.id : null}
          selectedEdgeId={selection.kind === "edge" ? selection.edge.id : null}
          canDrillDown={canDrillDown}
          isBusy={isGraphBusy}
          onSelectNode={(node) => {
            setSelection({ kind: "node", node })
            setSelectedProof(null)
            setProofError(null)
          }}
          onSelectEdge={(edge) => {
            setSelection({ kind: "edge", edge })
            setSelectedProof(null)
            setProofError(null)
          }}
          onExpandSelected={() => {
            if (selectedNode) void handleExpandNode(selectedNode)
          }}
          onExplainSelected={() => {
            if (selectedNode) void handleExplainNode(selectedNode)
          }}
          onResetFleet={() => {
            setActiveAppGraph(null)
            setGraphElements(latestHosts.length ? graphFromHosts(latestHosts) : EMPTY_GRAPH)
            setSelection({ kind: "none" })
            setSelectedProof(null)
          }}
          onRefresh={() => {
            const token = session.getToken() ?? ""
            void refreshWithToken(token, snapshot.epoch, snapshot.signal)
          }}
        />

        <EvidencePanel
          selection={selection}
          evidenceItems={activeAppGraph?.evidence ?? []}
          latestLogs={latestLogs}
          latestHosts={latestHosts}
          emptyGraph={activeAppGraph !== null && activeAppGraph.entities.length === 0}
          selectedProof={selectedProof}
          proofLoadingId={proofLoadingId}
          proofError={proofError}
          connected={connected}
          isBusy={isGraphBusy}
          onInspectEvidence={(evidenceId) => {
            void handleInspectEvidence(evidenceId)
          }}
          onExpandNode={(node) => {
            void handleExpandNode(node)
          }}
          onExplainNode={(node) => {
            void handleExplainNode(node)
          }}
          onAskAboutHost={(hostname) => {
            const nextPrompt = `What is happening on ${hostname}?`
            setHostHint(hostname)
            setPrompt(nextPrompt)
            void runAsk(nextPrompt, hostname)
          }}
        />
      </section>

      <TimelinePanel
        logs={latestLogs}
        statusLabel={logStatus.label}
        statusTone={logStatus.tone}
        connected={connected}
        onPivotHost={(hostname) => {
          const nextPrompt = `Why did ${hostname} log recent errors?`
          setHostHint(hostname)
          setPrompt(nextPrompt)
          void runAsk(nextPrompt, hostname)
        }}
      />
    </div>
  )
}

export function InvestigationWorkspace() {
  return (
    <AuthProvider>
      <InvestigationWorkspaceInner />
    </AuthProvider>
  )
}

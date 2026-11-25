"use client"

import { type FormEvent, useCallback, useMemo, useRef, useState } from "react"

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
  tone: "violet",
  badge: "Ready",
  title: "Enter a token to load live evidence.",
  body: "The app keeps the bearer token in memory only. It is never embedded in the HTML or written to local storage.",
}

export function InvestigationWorkspace() {
  // Bearer token lives in React memory state only; never persisted to storage or URL.
  const [bearerToken, setBearerToken] = useState("")
  const [tokenInput, setTokenInput] = useState("")

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

  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const beginRequest = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
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
    (reasonCard: StatusCardMessage) => {
      resetSessionData()
      setBearerToken("")
      setTokenInput("")
      setStatusCard(reasonCard)
    },
    [resetSessionData],
  )

  const handleUnauthorizedIfNeeded = useCallback(
    (error: unknown): boolean => {
      if (error instanceof CortexApiError && error.status === 401) {
        clearSessionState({
          tone: "error",
          badge: "Unauthorized",
          title: "Authentication rejected (401)",
          body: "The bearer token was cleared from memory. Enter a valid CORTEX_API_TOKEN to reconnect.",
        })
        return true
      }
      return false
    },
    [clearSessionState],
  )

  const refreshWithToken = useCallback(
    async (token: string) => {
      const { generation, signal } = beginRequest()
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
          if (generation !== generationRef.current) return
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
          if (generation !== generationRef.current) return
          if (handleUnauthorizedIfNeeded(v1Error)) return
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
        if (generation !== generationRef.current) return

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
        if (generation !== generationRef.current) return
        if (error instanceof DOMException && error.name === "AbortError") return
        if (handleUnauthorizedIfNeeded(error)) return
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

  const runAsk = useCallback(
    async (queryText: string, overrideHost?: string) => {
      const trimmed = queryText.trim()
      if (!trimmed) return
      if (!bearerToken) {
        setStatusCard({
          tone: "warn",
          badge: "Token required",
          title: "Bearer token required",
          body: "Connect with CORTEX_API_TOKEN before asking Cortex for live evidence.",
        })
        return
      }

      const { generation, signal } = beginRequest()
      setAskState("pending")
      resetEvidenceInspector()
      try {
        const envelope = await askInvestigation(
          bearerToken,
          {
            prompt: trimmed,
            host: overrideHost ?? hostHint,
            since: sinceHint || undefined,
          },
          signal,
        )
        if (generation !== generationRef.current) return

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
        if (generation !== generationRef.current) return
        if (error instanceof DOMException && error.name === "AbortError") return
        if (handleUnauthorizedIfNeeded(error)) return
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
      bearerToken,
      beginRequest,
      handleUnauthorizedIfNeeded,
      hostHint,
      resetEvidenceInspector,
      sinceHint,
    ],
  )

  const handleTokenSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextToken = tokenInput.trim()
    setBearerToken(nextToken)
    setTokenInput("")
    resetSessionData()
    void refreshWithToken(nextToken)
  }

  const handleAskSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runAsk(prompt)
  }

  const handleExpandNode = useCallback(
    async (node: GraphNodeData) => {
      if (!bearerToken) return
      const query = node.entity_id
        ? { entity_id: node.entity_id }
        : node.entity_type && node.entity_key
          ? { entity_type: node.entity_type, key: node.entity_key }
          : null
      if (!query) return

      setIsGraphBusy(true)
      setProofError(null)
      const generation = generationRef.current
      try {
        const envelope = await getGraphAround(bearerToken, query)
        if (generation !== generationRef.current) return
        setMetadata(envelope.metadata)
        setActiveAppGraph((prev) => {
          const merged = mergeAppGraphs(prev, envelope.result)
          setGraphElements(graphFromInvestigation(merged))
          return merged
        })
      } catch (error) {
        if (generation !== generationRef.current) return
        if (!handleUnauthorizedIfNeeded(error)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setIsGraphBusy(false)
      }
    },
    [bearerToken, handleUnauthorizedIfNeeded],
  )

  const handleExplainNode = useCallback(
    async (node: GraphNodeData) => {
      if (!bearerToken) return
      const query = node.entity_id
        ? { entity_id: node.entity_id }
        : node.entity_type && node.entity_key
          ? { entity_type: node.entity_type, key: node.entity_key }
          : null
      if (!query) return

      setIsGraphBusy(true)
      setProofError(null)
      const generation = generationRef.current
      try {
        const envelope = await explainGraphEntity(bearerToken, query)
        if (generation !== generationRef.current) return
        setMetadata(envelope.metadata)
        setActiveAppGraph(envelope.result)
        setGraphElements(graphFromInvestigation(envelope.result))
      } catch (error) {
        if (generation !== generationRef.current) return
        if (!handleUnauthorizedIfNeeded(error)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setIsGraphBusy(false)
      }
    },
    [bearerToken, handleUnauthorizedIfNeeded],
  )

  const handleSelectCandidate = useCallback(
    async (candidate: AppEntitySummary) => {
      if (!bearerToken) return
      setIsGraphBusy(true)
      setProofError(null)
      const generation = generationRef.current
      try {
        const envelope = await explainGraphEntity(bearerToken, { entity_id: candidate.id })
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
        if (!handleUnauthorizedIfNeeded(error)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setIsGraphBusy(false)
      }
    },
    [bearerToken, handleUnauthorizedIfNeeded],
  )

  const handleInspectEvidence = useCallback(
    async (evidenceId: number) => {
      if (!bearerToken) return
      setProofLoadingId(evidenceId)
      setProofError(null)
      const generation = generationRef.current
      try {
        const envelope = await getGraphEvidence(bearerToken, evidenceId)
        if (generation !== generationRef.current) return
        setSelectedProof(envelope.result)
      } catch (error) {
        if (generation !== generationRef.current) return
        if (!handleUnauthorizedIfNeeded(error)) {
          setProofError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (generation === generationRef.current) setProofLoadingId(null)
      }
    },
    [bearerToken, handleUnauthorizedIfNeeded],
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
    bearerToken && selectedNode && (selectedNode.entity_id || selectedNode.entity_key),
  )

  return (
    <div className="grid gap-3.5">
      <header className="aurora-surface flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="m-0 text-2xl font-extrabold tracking-tight">
            Cortex investigation workspace
          </h1>
          <p className="mt-1 mb-0 text-[13px] text-[var(--aurora-text-muted)]">
            Graph, evidence, timeline, and log context for the homelab fleet.
          </p>
        </div>

        <form className="grid gap-1.5 w-full lg:w-[min(440px,42vw)]" data-token-form onSubmit={handleTokenSubmit}>
          <label className="aurora-meta-label" htmlFor="api-token">
            Bearer token {bearerToken ? "(connected in memory)" : ""}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="api-token"
              name="token"
              type="password"
              autoComplete="off"
              className="aurora-input"
              placeholder={bearerToken ? "Token stored in memory" : "CORTEX_API_TOKEN"}
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
            />
            <button type="submit" className="aurora-btn-primary">
              Connect
            </button>
            <button
              type="button"
              className="aurora-btn-secondary"
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
            </button>
          </div>
        </form>
      </header>

      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Runtime status"
      >
        <article className="aurora-surface p-3.5 grid gap-1.5 content-start min-h-[92px]">
          <span className="aurora-meta-label">Server</span>
          <strong className="text-2xl font-extrabold leading-none" data-server-version>
            {serverVersion}
          </strong>
          <small className="text-xs text-[var(--aurora-text-muted)]" data-schema-version>
            {schemaVersion}
          </small>
        </article>
        <article className="aurora-surface p-3.5 grid gap-1.5 content-start min-h-[92px]">
          <span className="aurora-meta-label">Fleet</span>
          <strong className="text-2xl font-extrabold leading-none" data-host-count>
            {hostCount}
          </strong>
          <small className="text-xs text-[var(--aurora-text-muted)]">Known hosts</small>
        </article>
        <article className="aurora-surface p-3.5 grid gap-1.5 content-start min-h-[92px]">
          <span className="aurora-meta-label">Ingest</span>
          <strong className="text-2xl font-extrabold leading-none" data-log-count>
            {logCount}
          </strong>
          <small className="text-xs text-[var(--aurora-text-muted)]">Total rows</small>
        </article>
        <article
          className={`aurora-surface p-3.5 grid gap-1.5 content-start min-h-[92px] ${
            v1Status.tone === "warn" ? "!border-[color-mix(in_srgb,var(--aurora-warn)_50%,var(--aurora-border-strong))]" : ""
          }`}
          data-v1-state
        >
          <span className="aurora-meta-label">Investigation API</span>
          <strong className="text-2xl font-extrabold leading-none">{v1Status.title}</strong>
          <small className="text-xs text-[var(--aurora-text-muted)]">{v1Status.detail}</small>
        </article>
      </section>

      {metadata &&
        (metadata.degraded_reasons.length > 0 ||
          metadata.truncated ||
          metadata.partial ||
          metadata.version_skew) && (
          <section className="grid gap-2" aria-label="Investigation diagnostics">
            {metadata.degraded_reasons.length > 0 && (
              <div className="aurora-banner aurora-banner-error">
                <span>
                  <strong>Graph projection degraded:</strong> {metadata.degraded_reasons.join("; ")}
                </span>
                {metadata.graph_projection_status && (
                  <span className="aurora-badge aurora-badge-error">
                    {metadata.graph_projection_status}
                  </span>
                )}
              </div>
            )}
            {(metadata.truncated || metadata.partial) && (
              <div className="aurora-banner aurora-banner-warn">
                <span>
                  <strong>Partial or truncated result:</strong>{" "}
                  {[...metadata.truncation_reasons, ...metadata.partial_reasons]
                    .filter(Boolean)
                    .join(", ") || "bounded by server budget"}
                </span>
                <span className="aurora-mono text-xs text-[var(--aurora-text-muted)]">
                  {metadata.budget_used.graph_calls}/{metadata.budget.max_graph_calls} graph ·{" "}
                  {metadata.budget_used.log_rows}/{metadata.budget.max_log_rows} logs ·{" "}
                  {metadata.budget_used.wall_time_ms}ms
                </span>
              </div>
            )}
            {metadata.version_skew && (
              <div className="aurora-banner aurora-banner-warn">
                <span>
                  <strong>Client/server version skew:</strong> {metadata.version_skew}
                </span>
              </div>
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
            void refreshWithToken(bearerToken)
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
          connected={Boolean(bearerToken)}
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
        connected={Boolean(bearerToken)}
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

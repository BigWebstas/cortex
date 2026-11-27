"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/aurora/button"
import { Card, CardFooter, CardHeader } from "@/components/ui/aurora/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/aurora/select"
import type { GraphEdgeData, GraphElements, GraphNodeData } from "../../lib/host-sources"

type LayoutName = "cose" | "concentric" | "breadthfirst"

interface CytoscapeInstance {
  elements: () => { remove: () => void; removeClass: (name: string) => void }
  getElementById: (id: string) => { addClass: (name: string) => void; length: number }
  add: (elements: GraphElements) => void
  layout: (options: Record<string, unknown>) => { run: () => void }
  fit: (eles?: unknown, padding?: number) => void
  on: (
    event: string,
    selector: string,
    handler: (event: { target: { data: () => unknown } }) => void,
  ) => void
  destroy: () => void
}

declare global {
  interface Window {
    cytoscape?: (options: Record<string, unknown>) => CytoscapeInstance
  }
}

export interface GraphCanvasProps {
  elements: GraphElements
  highlightedRelationshipIds: number[]
  highlightedEntityIds: number[]
  selectedNodeId: string | null
  selectedEdgeId: string | null
  canDrillDown: boolean
  isBusy: boolean
  onSelectNode: (node: GraphNodeData) => void
  onSelectEdge: (edge: GraphEdgeData) => void
  onExpandSelected: () => void
  onExplainSelected: () => void
  onResetFleet: () => void
  onRefresh: () => void
}

function readThemeColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function loadVendoredCytoscape(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false)
  if (window.cytoscape) return Promise.resolve(true)
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-cortex-cytoscape="true"]',
    )
    if (existing) {
      if (window.cytoscape) {
        resolve(true)
        return
      }
      existing.addEventListener("load", () => resolve(Boolean(window.cytoscape)), { once: true })
      existing.addEventListener("error", () => resolve(false), { once: true })
      return
    }
    const script = document.createElement("script")
    script.src = "/app/assets/cytoscape-3.34.0.min.js"
    script.defer = true
    script.dataset.cortexCytoscape = "true"
    script.addEventListener("load", () => resolve(Boolean(window.cytoscape)), { once: true })
    script.addEventListener("error", () => resolve(false), { once: true })
    document.head.appendChild(script)
  })
}

export function GraphCanvas({
  elements,
  highlightedRelationshipIds,
  highlightedEntityIds,
  selectedNodeId,
  selectedEdgeId,
  canDrillDown,
  isBusy,
  onSelectNode,
  onSelectEdge,
  onExpandSelected,
  onExplainSelected,
  onResetFleet,
  onRefresh,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<CytoscapeInstance | null>(null)
  const [layout, setLayout] = useState<LayoutName>("cose")
  const [libraryState, setLibraryState] = useState<"loading" | "ready" | "error">("loading")

  const onSelectNodeRef = useRef(onSelectNode)
  const onSelectEdgeRef = useRef(onSelectEdge)
  useEffect(() => {
    onSelectNodeRef.current = onSelectNode
    onSelectEdgeRef.current = onSelectEdge
  }, [onSelectNode, onSelectEdge])

  useEffect(() => {
    let cancelled = false

    async function mount() {
      const loaded = await loadVendoredCytoscape()
      if (cancelled) return
      if (!loaded || !window.cytoscape || !containerRef.current) {
        setLibraryState("error")
        return
      }

      const theme = {
        page: readThemeColor("--aurora-page-bg", "#07131c"),
        border: readThemeColor("--aurora-border-strong", "#2b5870"),
        text: readThemeColor("--aurora-text-primary", "#e6f4fb"),
        muted: readThemeColor("--aurora-text-muted", "#a7bcc9"),
        accent: readThemeColor("--aurora-accent-primary", "#29b6f6"),
        accentStrong: readThemeColor("--aurora-accent-strong", "#67cbfa"),
        rose: readThemeColor("--aurora-accent-pink", "#f9a8c4"),
        violet: readThemeColor("--aurora-accent-violet", "#b69dfc"),
        warn: readThemeColor("--aurora-warn", "#e0b872"),
        success: readThemeColor("--aurora-success", "#7dd3c7"),
      }

      const instance = window.cytoscape({
        container: containerRef.current,
        elements,
        boxSelectionEnabled: true,
        style: [
          {
            selector: "node",
            style: {
              "background-color": theme.accent,
              "border-color": theme.accentStrong,
              "border-width": 2,
              color: theme.text,
              "font-family": "Inter, sans-serif",
              "font-size": 12,
              "font-weight": 600,
              label: "data(label)",
              "text-outline-color": theme.page,
              "text-outline-width": 3,
              "text-valign": "bottom",
              "text-margin-y": 8,
              width: 42,
              height: 42,
            },
          },
          {
            selector: 'node[kind = "host"]',
            style: { "background-color": theme.rose, "border-color": theme.rose },
          },
          {
            selector: 'node[kind = "claimed_host"]',
            style: {
              "background-color": theme.warn,
              "border-color": theme.warn,
              "border-style": "dashed",
            },
          },
          {
            selector: 'node[kind = "forwarding_principal"], node[kind = "unattributed"]',
            style: {
              shape: "diamond",
              "background-color": theme.muted,
              "border-color": theme.border,
            },
          },
          {
            selector: 'node[kind = "store"]',
            style: {
              shape: "round-rectangle",
              "background-color": theme.violet,
              "border-color": theme.violet,
            },
          },
          {
            selector: 'node[trust_level = "verified"]',
            style: { "border-color": theme.success, "border-width": 3 },
          },
          {
            selector: 'node[trust_level = "inferred"], node[trust_level = "weak"]',
            style: { "border-style": "dotted" },
          },
          {
            selector: 'node[status = "degraded"]',
            style: { "border-color": theme.warn, "border-width": 4 },
          },
          {
            selector: "node[?is_focus]",
            style: {
              width: 52,
              height: 52,
              "border-width": 4,
              "border-color": theme.accentStrong,
            },
          },
          {
            selector: "edge",
            style: {
              "curve-style": "bezier",
              "line-color": theme.border,
              "target-arrow-color": theme.border,
              "target-arrow-shape": "triangle",
              width: 2,
              label: "data(label)",
              "font-family": "JetBrains Mono, monospace",
              "font-size": 9,
              color: theme.muted,
              "text-background-color": theme.page,
              "text-background-opacity": 0.85,
              "text-background-padding": 2,
            },
          },
          {
            selector: 'edge[trust_level = "verified"]',
            style: {
              "line-color": theme.success,
              "target-arrow-color": theme.success,
              width: 2.5,
            },
          },
          {
            selector: 'edge[trust_level = "claimed"]',
            style: {
              "line-style": "dashed",
              "line-color": theme.warn,
              "target-arrow-color": theme.warn,
            },
          },
          {
            selector: 'edge[trust_level = "inferred"], edge[trust_level = "weak"]',
            style: { "line-style": "dotted" },
          },
          {
            selector: ".claim-highlight",
            style: {
              "border-color": theme.violet,
              "border-width": 5,
              "line-color": theme.violet,
              "target-arrow-color": theme.violet,
              width: 4,
            },
          },
          {
            selector: ":selected",
            style: {
              "border-color": theme.accentStrong,
              "border-width": 5,
              "line-color": theme.accentStrong,
              "target-arrow-color": theme.accentStrong,
            },
          },
        ],
        layout: { name: "cose", animate: false, padding: 38 },
      })

      instance.on("tap", "node", (event) => {
        onSelectNodeRef.current(event.target.data() as GraphNodeData)
      })
      instance.on("tap", "edge", (event) => {
        onSelectEdgeRef.current(event.target.data() as GraphEdgeData)
      })

      cyRef.current = instance
      setLibraryState("ready")
    }

    void mount()
    return () => {
      cancelled = true
      cyRef.current?.destroy()
      cyRef.current = null
    }
    // Initial Cytoscape setup happens once on mount; subsequent element updates run in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().remove()
    cy.add(elements)
    cy.layout({ name: layout, animate: false, padding: 38 }).run()
  }, [elements, layout, libraryState])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass("claim-highlight")
    for (const relId of highlightedRelationshipIds) {
      cy.getElementById(`rel:${relId}`).addClass("claim-highlight")
    }
    for (const entityId of highlightedEntityIds) {
      cy.getElementById(`entity:${entityId}`).addClass("claim-highlight")
    }
  }, [highlightedRelationshipIds, highlightedEntityIds, elements, libraryState])

  const hasElements = elements.nodes.length > 0 || elements.edges.length > 0

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2.5 bg-[var(--aurora-panel-medium)]">
        <div>
          <span className="aurora-meta-label">Graph canvas</span>
          <h2 className="m-0 text-[15px] font-bold">
            Fleet &amp; investigation topology{" "}
            <span className="aurora-mono text-[var(--aurora-text-muted)] font-normal">
              ({elements.nodes.length} nodes · {elements.edges.length} edges)
            </span>
          </h2>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Graph controls"
        >
          <Select value={layout} onValueChange={(value) => setLayout(value as LayoutName)}>
            <SelectTrigger
              id="graph-layout-select"
              aria-label="Graph layout"
              className="h-8 w-auto min-w-[130px] text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cose">Force (COSE)</SelectItem>
              <SelectItem value="concentric">Concentric</SelectItem>
              <SelectItem value="breadthfirst">Hierarchy</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="neutral"
            data-fit-graph
            onClick={() => cyRef.current?.fit(undefined, 36)}
          >
            Fit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="neutral"
            disabled={!canDrillDown || isBusy}
            onClick={onExpandSelected}
          >
            Expand
          </Button>
          <Button
            type="button"
            size="sm"
            variant="neutral"
            disabled={!canDrillDown || isBusy}
            onClick={onExplainSelected}
          >
            Explain node
          </Button>
          <Button type="button" size="sm" variant="neutral" onClick={onResetFleet}>
            Fleet view
          </Button>
          <Button type="button" size="sm" variant="neutral" data-refresh onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </CardHeader>

      <div className="relative">
        <div
          id="graph-canvas"
          ref={containerRef}
          className="aurora-graph-canvas"
          role="img"
          aria-label="Interactive investigation graph"
        />
        {libraryState === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[var(--aurora-page-bg)]/90 p-4 text-center">
            <p className="text-sm text-[var(--aurora-warn)]">
              Vendored graph renderer (/app/assets/cytoscape-3.34.0.min.js) could not load. Use the
              entity selector below to inspect nodes and edges.
            </p>
          </div>
        )}
      </div>

      <CardFooter className="bg-[var(--aurora-panel-medium)] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--aurora-text-muted)] w-full">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              <strong className="text-[var(--aurora-success)]">Solid green</strong> verified
            </span>
            <span>
              <strong className="text-[var(--aurora-warn)]">Dashed amber</strong> claimed
            </span>
            <span>
              <strong className="text-[var(--aurora-text-muted)]">Dotted</strong> inferred/weak
            </span>
            <span>
              <strong className="text-[var(--aurora-accent-violet)]">Violet</strong> active claim
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor="quick-node-select" className="aurora-meta-label">
              Inspect:
            </label>
            <Select
              value={selectedNodeId ?? selectedEdgeId ?? ""}
              disabled={!hasElements}
              onValueChange={(value) => {
                const node = elements.nodes.find((item) => item.data.id === value)
                if (node) {
                  onSelectNode(node.data)
                  return
                }
                const edge = elements.edges.find((item) => item.data.id === value)
                if (edge) onSelectEdge(edge.data)
              }}
            >
              <SelectTrigger
                id="quick-node-select"
                aria-label="Inspect node or edge"
                data-node-count={elements.nodes.length}
                data-edge-count={elements.edges.length}
                className="h-8 w-auto min-w-[180px] max-w-[240px] text-xs"
              >
                <SelectValue placeholder="Select node or edge..." />
              </SelectTrigger>
              <SelectContent>
                {elements.nodes.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Nodes</SelectLabel>
                    {elements.nodes.map((node) => (
                      <SelectItem
                        key={node.data.id}
                        value={node.data.id}
                        data-node-id={node.data.id}
                      >
                        {node.data.label} ({node.data.kind})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {elements.edges.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Relationships</SelectLabel>
                    {elements.edges.map((edge) => (
                      <SelectItem
                        key={edge.data.id}
                        value={edge.data.id}
                        data-edge-id={edge.data.id}
                      >
                        {edge.data.label}: {edge.data.source} → {edge.data.target}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardFooter>
    </Card>
  )
}

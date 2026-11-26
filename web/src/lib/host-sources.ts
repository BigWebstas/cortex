import type {
  AppEntitySummary,
  AppEvidenceSummary,
  AppGraphResponse,
  AppLogSummary,
  AppRelationshipSummary,
  HostSourceInput,
} from "../contracts/investigation"

export interface NormalizedHostSource {
  hostname: string
  host_id: string | null
  source_kind: string
  node_id: string
  aliases: string[]
}

export interface GraphNodeData {
  id: string
  label: string
  kind: string
  status: string
  trust_level?: string
  entity_id?: number
  entity_type?: string
  entity_key?: string
  host_id?: string | null
  aliases?: string[]
  is_focus?: boolean
}

export interface GraphEdgeData {
  id: string
  source: string
  target: string
  label: string
  relationship_id?: number
  relationship_type?: string
  reason_code?: string
  trust_level?: string
  confidence?: number
  evidence_count?: number
}

export interface GraphElements {
  nodes: Array<{ data: GraphNodeData }>
  edges: Array<{ data: GraphEdgeData }>
}

export const EMPTY_GRAPH: GraphElements = { nodes: [], edges: [] }

export const SEED_GRAPH: GraphElements = {
  nodes: [
    { data: { id: "cortex", label: "cortex", kind: "service", status: "degraded", trust_level: "claimed" } },
    { data: { id: "devhost", label: "devhost", kind: "host", status: "unknown", trust_level: "claimed" } },
    { data: { id: "edgehost", label: "edgehost", kind: "host", status: "unknown", trust_level: "claimed" } },
    { data: { id: "nashost", label: "nashost", kind: "host", status: "unknown", trust_level: "claimed" } },
    { data: { id: "sqlite", label: "SQLite WAL", kind: "store", status: "unknown", trust_level: "verified" } },
  ],
  edges: [
    { data: { id: "devhost-cortex", source: "devhost", target: "cortex", label: "serves", trust_level: "claimed" } },
    { data: { id: "edgehost-cortex", source: "edgehost", target: "cortex", label: "forwards", trust_level: "claimed" } },
    { data: { id: "nashost-cortex", source: "nashost", target: "cortex", label: "forwards", trust_level: "claimed" } },
    { data: { id: "cortex-sqlite", source: "cortex", target: "sqlite", label: "stores", trust_level: "verified" } },
  ],
}

export function normalizeHostSources(hosts: HostSourceInput[]): NormalizedHostSource[] {
  const sources = new Map<string, NormalizedHostSource>()
  for (const item of hosts) {
    const host = typeof item === "string" ? item : item?.hostname
    if (typeof host !== "string" || !host.trim()) continue
    const name = host.trim()
    const sourceKind =
      (typeof item === "object" && item?.source_kind) ||
      (/^(agent-(shared_bearer|loopback)$|bearer-shared-)/i.test(name)
        ? "forwarding_principal"
        : /^(localhost|unresolved-host\.invalid)$/i.test(name)
          ? "unattributed"
          : "host")
    const rawHostId = typeof item === "object" ? item?.host_id : null
    const hostId =
      sourceKind === "host" && typeof rawHostId === "string" && rawHostId.trim()
        ? rawHostId
        : null
    const key = JSON.stringify(hostId ? ["host_id", hostId] : ["source", sourceKind, name])
    const rawAliases = typeof item === "object" && Array.isArray(item?.aliases) ? item.aliases : []
    const aliases = [name, ...rawAliases].filter(
      (alias): alias is string => typeof alias === "string" && alias.trim().length > 0,
    )
    if (!sources.has(key)) {
      sources.set(key, {
        hostname: name,
        host_id: hostId,
        source_kind: sourceKind,
        node_id: hostId
          ? `source:heartbeat:${encodeURIComponent(hostId)}`
          : `source:name:${encodeURIComponent(sourceKind)}:${encodeURIComponent(name)}`,
        aliases: [],
      })
    }
    const source = sources.get(key)!
    source.aliases = Array.from(new Set([...source.aliases, ...aliases]))
  }
  return Array.from(sources.values())
}

export function graphFromHosts(hosts: HostSourceInput[]): GraphElements {
  const sources = normalizeHostSources(hosts).slice(0, 36)
  const nodes: Array<{ data: GraphNodeData }> = [
    { data: { id: "cortex", label: "cortex", kind: "service", status: "online", trust_level: "verified" } },
    ...sources.map((source) => ({
      data: {
        id: source.node_id,
        label: source.hostname,
        host_id: source.host_id,
        kind: source.source_kind,
        entity_type: source.source_kind === "host" ? "host" : undefined,
        entity_key: source.source_kind === "host" ? source.hostname : undefined,
        aliases: source.aliases,
        status: "observed",
        trust_level: source.host_id ? "verified" : source.source_kind === "claimed_host" ? "claimed" : "inferred",
      },
    })),
    { data: { id: "sqlite", label: "SQLite WAL", kind: "store", status: "online", trust_level: "verified" } },
  ]
  const edges: Array<{ data: GraphEdgeData }> = sources.map((source) => ({
    data: {
      id: `${source.node_id}->cortex`,
      source: source.node_id,
      target: "cortex",
      label: "ingests",
      trust_level: source.host_id ? "verified" : "claimed",
    },
  }))
  edges.push({
    data: {
      id: "cortex->sqlite",
      source: "cortex",
      target: "sqlite",
      label: "writes",
      trust_level: "verified",
    },
  })
  return { nodes, edges }
}

export function graphFromInvestigation(graph: AppGraphResponse | null | undefined): GraphElements {
  const focusId = graph?.focus?.id ?? null
  const nodes: Array<{ data: GraphNodeData }> = (graph?.entities ?? []).slice(0, 80).map((entity) => ({
    data: {
      id: `entity:${entity.id}`,
      label: entity.label || entity.key || String(entity.id),
      kind: entity.entity_type || "entity",
      entity_id: entity.id,
      entity_type: entity.entity_type,
      entity_key: entity.key,
      aliases: [entity.label, entity.key].filter(Boolean),
      status: entity.trust_level === "verified" ? "online" : "observed",
      trust_level: entity.trust_level || "unknown",
      is_focus: focusId === entity.id,
    },
  }))
  const seen = new Set(nodes.map((node) => node.data.id))
  const edges: Array<{ data: GraphEdgeData }> = (graph?.relationships ?? []).slice(0, 120).flatMap((rel) => {
    const source = `entity:${rel.source_entity_id}`
    const target = `entity:${rel.target_entity_id}`
    if (!seen.has(source) || !seen.has(target)) return []
    return [
      {
        data: {
          id: `rel:${rel.id}`,
          source,
          target,
          label: rel.relationship_type || rel.reason_code || "related",
          relationship_id: rel.id,
          relationship_type: rel.relationship_type,
          reason_code: rel.reason_code,
          trust_level: rel.trust_level,
          confidence: rel.confidence,
          evidence_count: rel.evidence_count,
        },
      },
    ]
  })
  return { nodes, edges }
}

/**
 * Log rows that can be attributed to a graph node. A row carrying a host ID
 * belongs only to that device. A hostname-only row is omitted when the name is
 * shared by several sources, because it cannot be tied to one of them.
 */
export function relatedLogsForNode(
  node: GraphNodeData,
  logs: AppLogSummary[],
  hosts: HostSourceInput[],
): { rows: AppLogSummary[]; ambiguousCount: number } {
  const aliases = Array.isArray(node.aliases) ? node.aliases : [node.label]
  const sources = normalizeHostSources(hosts)
  let ambiguousCount = 0
  const rows = logs.filter((row) => {
    if (row.host_id) return row.host_id === node.host_id
    const name = String(row.hostname || row.host || "")
    if (!aliases.includes(name)) return false
    if (sources.filter((source) => source.aliases.includes(name)).length > 1) {
      ambiguousCount += 1
      return false
    }
    return true
  })
  return { rows, ambiguousCount }
}

export function mergeAppGraphs(
  current: AppGraphResponse | null,
  incoming: AppGraphResponse,
): AppGraphResponse {
  if (!current) return incoming
  const entities = new Map<number, AppEntitySummary>()
  for (const entity of current.entities) entities.set(entity.id, entity)
  for (const entity of incoming.entities) entities.set(entity.id, entity)

  const relationships = new Map<number, AppRelationshipSummary>()
  for (const rel of current.relationships) relationships.set(rel.id, rel)
  for (const rel of incoming.relationships) relationships.set(rel.id, rel)

  const evidence = new Map<number, AppEvidenceSummary>()
  for (const ev of current.evidence) evidence.set(ev.id, ev)
  for (const ev of incoming.evidence) evidence.set(ev.id, ev)

  return {
    focus: incoming.focus ?? current.focus,
    entities: Array.from(entities.values()),
    relationships: Array.from(relationships.values()),
    evidence: Array.from(evidence.values()),
  }
}

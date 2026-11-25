import { describe, expect, it } from "vitest"

import {
  graphFromHosts,
  graphFromInvestigation,
  mergeAppGraphs,
  normalizeHostSources,
} from "../src/lib/host-sources"

describe("host source graph", () => {
  it("preserves real API hostnames, aliases, and separate principal sources", () => {
    const hosts = [
      { hostname: "devhost", aliases: ["devhost", "devhost.local"], source_kind: "host" },
      { hostname: "agent-shared_bearer", source_kind: "forwarding_principal" },
      { hostname: "bearer-shared-Mac", source_kind: "forwarding_principal" },
      { hostname: "bearer-shared-mac", source_kind: "forwarding_principal" },
      { hostname: "devhost" },
      {},
      null,
    ]
    const graph = graphFromHosts(hosts)
    const nodes = graph.nodes.filter((node) => node.data.id.startsWith("source:"))
    expect(nodes.map((node) => node.data.label)).toEqual([
      "devhost",
      "agent-shared_bearer",
      "bearer-shared-Mac",
      "bearer-shared-mac",
    ])
    expect(nodes[0].data.aliases).toEqual(["devhost", "devhost.local"])
    expect(nodes[1].data.kind).toBe("forwarding_principal")
    expect(nodes.every((node) => node.data.status === "observed")).toBe(true)
    expect(
      normalizeHostSources(hosts).filter((host) => host.source_kind === "host"),
    ).toHaveLength(1)
  })

  it("supports legacy hostname strings without attributing shared credentials to a device", () => {
    expect(
      normalizeHostSources([
        "serverhost",
        "edgehost",
        "agent-shared_bearer",
        "bearer-shared-one",
        "localhost",
      ]).map((host) => host.source_kind),
    ).toEqual(["host", "host", "forwarding_principal", "forwarding_principal", "unattributed"])
  })

  it("keeps claimed device names separate from heartbeat identities", () => {
    const sources = normalizeHostSources([
      { hostname: "edge-node-a", source_kind: "claimed_host", host_id: "stable-edge-node-a" },
      { hostname: "edge-node-a", source_kind: "host", host_id: "stable-edge-node-a" },
    ])
    expect(sources).toHaveLength(2)
    expect(sources[0].host_id).toBeNull()
    expect(sources[0].node_id).toBe("source:name:claimed_host:edge-node-a")
    expect(sources[1].host_id).toBe("stable-edge-node-a")
  })

  it("deduplicates physical nodes and counts using stable heartbeat IDs and merges their aliases", () => {
    const hosts = [
      {
        hostname: "serverhost",
        host_id: "device-1",
        source_kind: "host",
        aliases: ["SERVERHOST", "serverhost.local"],
      },
      {
        hostname: "serverhost.example.ts.net",
        host_id: "device-1",
        source_kind: "host",
        aliases: ["serverhost.local", "", null],
      },
      { hostname: "edgehost", host_id: "device-2", source_kind: "host" },
      { hostname: "agent-shared_bearer", host_id: "device-1", source_kind: "forwarding_principal" },
    ]
    const sources = normalizeHostSources(hosts)
    expect(sources.filter((host) => host.source_kind === "host")).toHaveLength(2)
    expect(sources[0].aliases).toEqual([
      "serverhost",
      "SERVERHOST",
      "serverhost.local",
      "serverhost.example.ts.net",
    ])
    const graph = graphFromHosts(hosts)
    const device = graph.nodes.find((node) => node.data.host_id === "device-1")
    expect(device?.data.id).toBe("source:heartbeat:device-1")
    expect(graph.edges.some((edge) => edge.data.source === device?.data.id)).toBe(true)
    expect(
      sources.find((host) => host.source_kind === "forwarding_principal")?.host_id,
    ).toBeNull()
    expect(
      graphFromHosts([hosts[1]]).nodes.find((node) => node.data.host_id === "device-1")?.data.id,
    ).toBe(device?.data.id)
  })

  it("retains ambiguous same-name devices and legacy rows without inventing identity", () => {
    const hosts = [
      { hostname: "same-name", host_id: "device-1", source_kind: "host" },
      { hostname: "same-name", host_id: "device-2", source_kind: "host" },
      { hostname: "same-name", host_id: null, source_kind: "host", aliases: ["legacy-alias"] },
      { hostname: "same-name", host_id: " ", source_kind: "host" },
      { hostname: "same-name", source_kind: "forwarding_principal" },
      "edgehost",
      "10.1.0.8",
    ]
    const sources = normalizeHostSources(hosts)
    expect(sources).toHaveLength(6)
    expect(sources.filter((host) => host.hostname === "same-name")).toHaveLength(4)
    expect(
      sources.find((host) => !host.host_id && host.source_kind === "host")?.aliases,
    ).toEqual(["same-name", "legacy-alias"])
    const graph = graphFromHosts(hosts)
    expect(new Set(graph.nodes.map((node) => node.data.id)).size).toBe(graph.nodes.length)
  })

  it("maps investigation entities, trust levels, and merges neighborhood expansions", () => {
    const initial = {
      focus: { id: 1, entity_type: "host", key: "edgehost", label: "edgehost", trust_level: "verified" },
      entities: [
        { id: 1, entity_type: "host", key: "edgehost", label: "edgehost", trust_level: "verified" },
        { id: 2, entity_type: "service", key: "nginx", label: "nginx", trust_level: "claimed" },
      ],
      relationships: [
        {
          id: 10,
          source_entity_id: 1,
          target_entity_id: 2,
          relationship_type: "runs",
          reason_code: "systemd_unit",
          trust_level: "verified",
          confidence: 0.92,
          evidence_count: 3,
        },
      ],
      evidence: [],
    }
    const elements = graphFromInvestigation(initial)
    expect(elements.nodes[0].data.is_focus).toBe(true)
    expect(elements.edges[0].data.relationship_id).toBe(10)
    expect(elements.edges[0].data.confidence).toBe(0.92)

    const expanded = mergeAppGraphs(initial, {
      focus: null,
      entities: [
        { id: 3, entity_type: "container", key: "proxy", label: "proxy", trust_level: "inferred" },
      ],
      relationships: [
        {
          id: 11,
          source_entity_id: 2,
          target_entity_id: 3,
          relationship_type: "forwards_to",
          reason_code: "co_occurrence",
          trust_level: "inferred",
          confidence: 0.55,
          evidence_count: 1,
        },
      ],
      evidence: [],
    })
    expect(expanded.entities).toHaveLength(3)
    expect(expanded.relationships).toHaveLength(2)
    expect(expanded.focus?.id).toBe(1)
  })
})

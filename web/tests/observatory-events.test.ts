import { describe, expect, it } from "vitest"

import type { AgentRunEvent } from "../../docs/contracts/agent-observatory-types"
import { commandEntry, matchesCommandFilter, transcriptEntry } from "../src/lib/observatory/events"

const event = (payload: unknown, extra: Partial<AgentRunEvent> = {}) =>
  ({
    id: "1",
    kind: "command",
    title: "agent command",
    summary: "summary text",
    actor_key: null,
    content_scrubbed: true,
    payload_json: payload === null ? null : JSON.stringify(payload),
    ...extra,
  }) as AgentRunEvent

describe("transcript entries", () => {
  it.each([
    ["user", "user"],
    ["assistant", "assistant"],
    ["tool", "tool"],
    ["reasoning", "reasoning"],
    ["unknown", "unknown"],
    ["something-new", "unknown"],
  ])("maps the recorded speaker %s to %s", (recorded, role) => {
    const entry = transcriptEntry(event({ message: "hi", metadata: { event_kind: recorded } }))
    expect(entry.role).toBe(role)
    expect(entry.text).toBe("hi")
  })

  it("never guesses a speaker and falls back to the summary", () => {
    expect(transcriptEntry(event(null))).toMatchObject({
      role: "unknown",
      text: "summary text",
      partial: true,
    })
    expect(transcriptEntry(event({ message: "cut", message_truncated: true })).partial).toBe(true)
    expect(transcriptEntry(event({ message: 7 })).text).toBe("summary text")
  })

  it("labels provider events", () => {
    expect(transcriptEntry(event({}, { kind: "provider_event" })).role).toBe("provider")
  })
})

describe("command entries", () => {
  const payload = {
    command: "git push",
    cwd: "/work/cortex",
    duration_ms: 45_000,
    exit_status: 1,
    command_truncated: false,
    content_scrubbed: true,
  }

  it("reads the recorded details", () => {
    expect(commandEntry(event(payload, { kind: "shell_history" }))).toMatchObject({
      command: "git push",
      cwd: "/work/cortex",
      durationMs: 45_000,
      exitStatus: 1,
      source: "shell history",
      scrubbed: true,
    })
  })

  it("keeps missing values unknown rather than successful", () => {
    const entry = commandEntry(event({}))
    expect(entry).toMatchObject({ command: "summary text", exitStatus: null, durationMs: null })
    expect(matchesCommandFilter(entry, "failed")).toBe(false)
  })

  it("filters failed, long-running and Git commands", () => {
    const entry = commandEntry(event(payload))
    expect(matchesCommandFilter(entry, "failed")).toBe(true)
    expect(matchesCommandFilter(entry, "long")).toBe(true)
    expect(matchesCommandFilter(entry, "git")).toBe(true)
    const quick = commandEntry(event({ command: "ls .git", duration_ms: 5, exit_status: 0 }))
    expect(["failed", "long", "git"].map((filter) => matchesCommandFilter(quick, filter as "git"))).toEqual([false, false, false])
  })
})

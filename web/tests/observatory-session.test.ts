import { describe, expect, it, vi } from "vitest"

import { createSession } from "../src/lib/observatory/session"

describe("observatory session", () => {
  it("keeps the token out of the observable snapshot", () => {
    const session = createSession()
    const listener = vi.fn()
    session.subscribe(listener)

    session.connect("  secret-token  ")

    expect(session.getToken()).toBe("secret-token")
    expect(session.getSnapshot().status).toBe("connected")
    expect(JSON.stringify(session.getSnapshot())).not.toContain("secret-token")
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("ignores a blank token", () => {
    const session = createSession()
    session.connect("   ")
    expect(session.getSnapshot().status).toBe("disconnected")
  })

  it.each([
    ["clear", "disconnected"],
    ["unauthorized", "unauthorized"],
  ] as const)("%s forgets the token and aborts requests", (action, status) => {
    const session = createSession()
    session.connect("secret-token")
    const { signal } = session.getSnapshot()

    session[action]()

    expect(session.getToken()).toBeNull()
    expect(session.getSnapshot().status).toBe(status)
    expect(signal.aborted).toBe(true)
  })

  it("starts a new epoch and aborts the old one when the token is replaced", () => {
    const session = createSession()
    session.connect("first")
    const first = session.getSnapshot()

    session.connect("second")

    expect(first.signal.aborted).toBe(true)
    expect(session.getSnapshot().signal.aborted).toBe(false)
    expect(session.getSnapshot().epoch).toBeGreaterThan(first.epoch)
  })

  it("ignores an unauthorized report from an earlier token", () => {
    const session = createSession()
    session.connect("first")
    const stale = session.getSnapshot().epoch
    session.connect("second")

    session.unauthorized(stale)

    expect(session.getToken()).toBe("second")
  })
})

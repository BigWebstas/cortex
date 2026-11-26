import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { auditComponents, auditLock } from "../scripts/audit-aurora.mjs"

describe("Aurora component audit", () => {
  let root: string
  const lock = { files: [{ path: "components/ui/aurora/button.tsx" }] }
  const write = (path: string, source: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "aurora-components-"))
    write("components/ui/aurora/button.tsx", "export function Button() { return <button /> }\n")
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("accepts features that use vendored Aurora primitives", () => {
    write(
      "src/panel.tsx",
      'import { Button } from "@/components/ui/aurora/button"\nexport const Panel = () => <Button />\n',
    )
    expect(auditComponents(lock, root, [])).toEqual([])
  })

  it("rejects a local Button imported from outside Aurora", () => {
    write("src/button.tsx", "export const Button = () => null\n")
    write("app/page.tsx", 'import { Button } from "../src/button"\nexport default Button\n')
    expect(auditComponents(lock, root, [])).toEqual([
      "app/page.tsx: parallel-import Button from ../src/button",
      "src/button.tsx: parallel-definition Button",
    ])
  })

  it("rejects hand-built controls", () => {
    write("src/form.tsx", "export const Form = () => (\n  <select\n    value=''\n  />\n)\n")
    expect(auditComponents(lock, root, [])).toEqual(["src/form.tsx: raw-element <select>"])
  })

  it("rejects an untracked file inside a vendored directory", () => {
    write("components/aurora/extra.tsx", "export const Extra = () => null\n")
    expect(auditComponents(lock, root, [])).toEqual([
      "components/aurora/extra.tsx: untracked file in a vendored directory",
    ])
  })

  it("honours a referenced exception, and rejects unreferenced or stale ones", () => {
    write("src/form.tsx", "export const Form = () => <input />\n")
    const entry = { path: "src/form.tsx", reason: "Predates Aurora", reference: "AO-096" }
    expect(auditComponents(lock, root, [entry])).toEqual([])
    expect(auditComponents(lock, root, [{ ...entry, reference: "" }])).toContain(
      "exception needs a reason and a reference: src/form.tsx",
    )
    expect(auditComponents(lock, root, [entry, { ...entry, path: "src/gone.tsx" }])).toEqual([
      "stale exception: src/gone.tsx",
    ])
  })
})

describe("committed Aurora state", () => {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const json = (name: string) => JSON.parse(readFileSync(join(root, name), "utf8"))

  it("passes the integrity and component audits", () => {
    const lock = json("aurora.lock.json")
    expect(auditLock(lock, root)).toEqual([])
    expect(auditComponents(lock, root, json("aurora.allow.json"))).toEqual([])
  })
})

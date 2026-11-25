// Verifies that vendored Aurora source matches web/aurora.lock.json. Offline.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const FULL_SHA = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const MUTABLE_URL =
  /aurora\.tootie\.tv|fonts\.(googleapis|gstatic)\.com|dinglebear-ai\/aurora\/(main|master|HEAD)\/|shadcn(-ui)?@latest/

/** @returns {string[]} one message per problem; empty when the lock is satisfied */
export function auditLock(lock, root) {
  const problems = []
  const { source_revision: sha = "", immutable_url_template: template = "" } = lock.registry ?? {}
  if (!FULL_SHA.test(sha)) problems.push("source_revision must be a full 40-character commit SHA")
  if (!template.includes("{sha}")) problems.push("immutable_url_template must contain {sha}")

  const resolved = new Map((lock.resolved_items ?? []).map((item) => [item.name, item]))
  for (const item of resolved.values()) {
    if (!SHA256.test(item.source_sha256 ?? "")) problems.push(`invalid source hash: ${item.name}`)
    for (const dependency of item.registry_dependencies ?? []) {
      if (!resolved.has(dependency)) {
        problems.push(`unresolved dependency: ${dependency} (required by ${item.name})`)
      }
    }
  }
  for (const name of lock.top_level_items ?? []) {
    if (!resolved.has(name)) problems.push(`unresolved top-level item: ${name}`)
  }

  const files = lock.files ?? []
  if (files.length === 0) problems.push("no installed files are recorded")
  for (const file of files) {
    const target = resolve(root, file.path)
    const inside = relative(root, target)
    if (inside.startsWith("..") || isAbsolute(inside)) {
      problems.push(`path escapes the web project: ${file.path}`)
      continue
    }
    if (!existsSync(target)) {
      problems.push(`missing file: ${file.path}`)
      continue
    }
    const content = readFileSync(target)
    if (createHash("sha256").update(content).digest("hex") !== file.installed_sha256) {
      problems.push(`hash mismatch: ${file.path}`)
    }
    if (MUTABLE_URL.test(content.toString("utf8"))) problems.push(`mutable URL in ${file.path}`)
    if (file.locally_modified && !file.modification_note) {
      problems.push(`modified without a note: ${file.path}`)
    }
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const lock = JSON.parse(readFileSync(resolve(root, "aurora.lock.json"), "utf8"))
  const problems = auditLock(lock, root)
  for (const problem of problems) console.error(problem)
  console.log(problems.length ? `Aurora audit failed: ${problems.length} problem(s).` : "Aurora audit passed.")
  process.exit(problems.length ? 1 : 0)
}

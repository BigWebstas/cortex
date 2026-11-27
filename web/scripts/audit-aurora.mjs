// Verifies vendored Aurora source against web/aurora.lock.json and checks that
// feature code does not rebuild Aurora primitives. Offline.
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
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
    if (!lock.usage?.[name]) problems.push(`no planned use recorded: ${name}`)
  }

  const files = lock.files ?? []
  if (files.length === 0) problems.push("no installed files are recorded")
  const assets = (lock.vendored_assets ?? []).map((asset) => ({
    path: asset.path,
    installed_sha256: asset.sha256,
    binary: true,
  }))
  for (const file of [...files, ...assets]) {
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
    if (!file.binary && MUTABLE_URL.test(content.toString("utf8"))) {
      problems.push(`mutable URL in ${file.path}`)
    }
    if (file.locally_modified && !file.modification_note) {
      problems.push(`modified without a note: ${file.path}`)
    }
  }
  return problems
}

const VENDORED = ["components/aurora", "components/ui/aurora", "lib/aurora"]
const FEATURES = ["app", "src", "components"]
const PRIMITIVES = [
  "Avatar", "Badge", "Banner", "Breadcrumb", "Button", "Card", "DataTable", "Dialog", "EmptyState",
  "Input", "Pagination", "ScrollArea", "Select", "Separator", "Sheet", "Skeleton", "Spinner",
  "Tabs", "Textarea", "Timeline", "Toast", "Tooltip",
].join("|")
const DEFINITION = new RegExp(`\\b(?:function|const|class)\\s+(${PRIMITIVES})\\b`, "g")
const IMPORT = /\bimport\s+(?:type\s+)?([^;'"]+?)\s+from\s+["']([^"']+)["']/g
const RAW_ELEMENT = /<(button|input|select|textarea|table|dialog)(?=[\s/>])/g
const AURORA_SOURCE = /(^|\/)components\/(ui\/)?aurora\//

function sourceFiles(root, directory) {
  const absolute = join(root, directory)
  if (!existsSync(absolute)) return []
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(root, path)
    return /\.(tsx?|jsx?|css)$/.test(entry.name) ? [path] : []
  })
}

function featureProblems(source) {
  const found = new Set()
  for (const [, name] of source.matchAll(DEFINITION)) found.add(`parallel-definition ${name}`)
  for (const [, clause, from] of source.matchAll(IMPORT)) {
    // Packages are covered by the dependency lock; only local modules can shadow Aurora.
    if (!/^(\.|@\/)/.test(from) || AURORA_SOURCE.test(from)) continue
    for (const name of clause.match(new RegExp(`\\b(${PRIMITIVES})\\b`, "g")) ?? []) {
      found.add(`parallel-import ${name} from ${from}`)
    }
  }
  for (const [, element] of source.matchAll(RAW_ELEMENT)) found.add(`raw-element <${element}>`)
  return [...found]
}

/**
 * Finds hand-built primitives in feature code and files the lock does not track.
 * Exceptions are per file and must say why, with an issue or plan task.
 * @returns {string[]}
 */
export function auditComponents(lock, root, exceptions) {
  const problems = []
  const tracked = new Set((lock.files ?? []).map((file) => file.path))
  const excused = new Map(exceptions.map((entry) => [entry.path, entry]))
  const used = new Set()
  const files = [...new Set([...FEATURES, ...VENDORED].flatMap((dir) => sourceFiles(root, dir)))]
  for (const path of files.sort()) {
    if (VENDORED.some((dir) => path.startsWith(`${dir}/`))) {
      if (!tracked.has(path)) problems.push(`${path}: untracked file in a vendored directory`)
      continue
    }
    if (tracked.has(path) || !/\.(tsx|jsx|ts|js)$/.test(path) || path === "app/app.js") continue
    const found = featureProblems(readFileSync(join(root, path), "utf8"))
    if (found.length === 0) continue
    const entry = excused.get(path)
    if (!entry) {
      problems.push(...found.map((problem) => `${path}: ${problem}`))
      continue
    }
    used.add(path)
    if (!entry.reason || !entry.reference) {
      problems.push(`exception needs a reason and a reference: ${path}`)
    }
  }
  for (const path of excused.keys()) {
    if (!used.has(path)) problems.push(`stale exception: ${path}`)
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = fileURLToPath(new URL("..", import.meta.url))
  const lock = JSON.parse(readFileSync(resolve(root, "aurora.lock.json"), "utf8"))
  const exceptions = JSON.parse(readFileSync(resolve(root, "aurora.allow.json"), "utf8"))
  const problems = [...auditLock(lock, root), ...auditComponents(lock, root, exceptions)]
  for (const problem of problems) console.error(problem)
  console.log(problems.length ? `Aurora audit failed: ${problems.length} problem(s).` : "Aurora audit passed.")
  process.exit(problems.length ? 1 : 0)
}

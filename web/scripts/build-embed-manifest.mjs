import { createHash } from "node:crypto"
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, extname, posix, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const scriptPath = fileURLToPath(import.meta.url)
const webRoot = resolve(dirname(scriptPath), "..")
const defaultOutDir = resolve(webRoot, "out")
const defaultVendorCytoscape = resolve(webRoot, "vendor/cytoscape-3.34.0.min.js")

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
])

export function sha256Base64(data) {
  return `sha256-${createHash("sha256").update(data).digest("base64")}`
}

export function extractInlineScriptHashes(html) {
  const hashes = []
  const seen = new Set()
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let match
  while ((match = scriptRegex.exec(html)) !== null) {
    const attrs = match[1] ?? ""
    const body = match[2] ?? ""
    // External scripts (<script src="...">) are covered by script-src 'self'.
    if (/\bsrc\s*=/i.test(attrs)) continue
    // Non-executable data scripts (application/json, application/ld+json) do not execute.
    const typeMatch = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    const scriptType = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? "").trim().toLowerCase()
    if (
      scriptType &&
      scriptType !== "text/javascript" &&
      scriptType !== "application/javascript" &&
      scriptType !== "module"
    ) {
      continue
    }
    const hash = sha256Base64(Buffer.from(body, "utf8"))
    if (!seen.has(hash)) {
      seen.add(hash)
      hashes.push(hash)
    }
  }
  return hashes
}

export function requestPathForFile(relPosixPath) {
  if (relPosixPath === "index.html") return "/app/"
  if (relPosixPath.endsWith("/index.html")) {
    return `/app/${relPosixPath.slice(0, -"index.html".length)}`
  }
  return `/app/${relPosixPath}`
}

export function cachePolicyForRequestPath(requestPath) {
  if (
    requestPath.startsWith("/app/_next/static/") ||
    requestPath === "/app/assets/cytoscape-3.34.0.min.js"
  ) {
    return "immutable"
  }
  return "no-store"
}

export function contentTypeForFile(relPosixPath) {
  return MIME_TYPES.get(extname(relPosixPath).toLowerCase()) ?? "application/octet-stream"
}

function collectFiles(rootDir, currentDir, realRoot, files) {
  const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  for (const entry of entries) {
    if (entry.name === "cortex-assets.json") continue
    if (entry.name === ".." || entry.name.includes("\0")) {
      throw new Error(`Unsafe filename in static export: ${entry.name}`)
    }
    const fullPath = resolve(currentDir, entry.name)
    const stat = lstatSync(fullPath)
    if (stat.isSymbolicLink()) {
      const target = realpathSync(fullPath)
      const relTarget = relative(realRoot, target)
      if (relTarget === ".." || relTarget.startsWith(`..${sep}`)) {
        throw new Error(`Symlink escapes static export root: ${fullPath}`)
      }
    }
    if (stat.isDirectory()) {
      collectFiles(rootDir, fullPath, realRoot, files)
      continue
    }
    if (!stat.isFile()) continue
    const relOsPath = relative(rootDir, fullPath)
    const relPosix = relOsPath.split(sep).join(posix.sep)
    if (relPosix.includes("..") || relPosix.startsWith("/")) {
      throw new Error(`Unsafe relative path in static export: ${relPosix}`)
    }
    if (relPosix.endsWith(".map")) {
      throw new Error(`Source map must not be included in static export: ${relPosix}`)
    }
    files.push({ fullPath, relPosix })
  }
}

export function buildEmbedManifest({
  outDir = defaultOutDir,
  vendorCytoscape = defaultVendorCytoscape,
  packageJsonPath = resolve(webRoot, "package.json"),
  sourceDateEpoch = process.env.SOURCE_DATE_EPOCH,
} = {}) {
  const absOutDir = resolve(outDir)
  if (vendorCytoscape) {
    const destCytoscape = resolve(absOutDir, "assets/cytoscape-3.34.0.min.js")
    mkdirSync(dirname(destCytoscape), { recursive: true })
    copyFileSync(vendorCytoscape, destCytoscape)
  }

  const realRoot = realpathSync(absOutDir)
  const files = []
  collectFiles(absOutDir, absOutDir, realRoot, files)
  files.sort((a, b) => a.relPosix.localeCompare(b.relPosix))

  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  const nextVersion = pkg?.dependencies?.next ?? "unknown"

  const generatedAt = sourceDateEpoch
    ? new Date(Number.parseInt(sourceDateEpoch, 10) * 1000).toISOString()
    : new Date().toISOString()

  const assets = files.map(({ fullPath, relPosix }) => {
    const bytes = readFileSync(fullPath)
    const requestPath = requestPathForFile(relPosix)
    const contentType = contentTypeForFile(relPosix)
    const cache = cachePolicyForRequestPath(requestPath)
    const etag = sha256Base64(bytes)
    const inlineScriptHashes =
      extname(relPosix).toLowerCase() === ".html"
        ? extractInlineScriptHashes(bytes.toString("utf8"))
        : []
    return {
      request_path: requestPath,
      file_path: relPosix,
      content_type: contentType,
      cache,
      etag,
      inline_script_hashes: inlineScriptHashes,
    }
  })

  assets.sort((a, b) => a.request_path.localeCompare(b.request_path))

  const manifest = {
    schema: 1,
    source_revision: process.env.CORTEX_WEB_REVISION ?? "workspace",
    aurora_revision: "local-aurora-tokens",
    next_version: nextVersion,
    generated_at: generatedAt,
    assets,
  }

  const manifestPath = resolve(absOutDir, "cortex-assets.json")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const manifest = buildEmbedManifest()
  process.stdout.write(
    `Generated web/out/cortex-assets.json with ${manifest.assets.length} embedded assets.\n`,
  )
}

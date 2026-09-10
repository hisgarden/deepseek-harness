/**
 * CycloneDX SBOM over the shipped runtime dependency closure.
 *
 * Scope is the transitive closure of `dependencies` and `optionalDependencies`
 * reachable from every workspace package outside `DEV_ONLY_AREAS`. The
 * repository's third-party notices tier the same areas but record only direct
 * declarations; a consumer scanning for vulnerabilities needs what those
 * declarations resolve to, so this walks `pnpm-lock.yaml` instead of manifests.
 *
 * Workspace and vendored packages resolve as `link:` entries and are not
 * emitted: they are first-party source, not resolved npm components. The
 * bundled Python runtime and the native addon's prebuilt binaries carry their
 * own dependency sets that an npm lockfile does not describe, so a consumer
 * treating this document as the whole product's inventory would be wrong.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Enums from '@cyclonedx/cyclonedx-library/Enums'
import * as Models from '@cyclonedx/cyclonedx-library/Models'
import * as SPDX from '@cyclonedx/cyclonedx-library/SPDX'
import * as Serialize from '@cyclonedx/cyclonedx-library/Serialize'
import * as Spec from '@cyclonedx/cyclonedx-library/Spec'
import { load } from 'js-yaml'
import { PackageURL } from 'packageurl-js'
import { DEV_ONLY_AREAS } from './gen-third-party-notices.ts'
import { globSync } from './glob.ts'

/** Committed SBOM path, relative to the repository root. */
export const SBOM_PATH = 'sbom.cdx.json'

/** Dependency-declaration kinds a consumer resolves at runtime. */
const RUNTIME_KINDS = ['dependencies', 'optionalDependencies'] as const

/** One resolved dependency edge as `pnpm-lock.yaml` records it. */
interface LockEntry {
  /** Resolved version, or a `link:` target for a workspace or vendored package. */
  version: string
}

/** The subset of `pnpm-lock.yaml` this generator reads. */
interface Lockfile {
  importers?: Record<string, Partial<Record<typeof RUNTIME_KINDS[number], Record<string, LockEntry>>>>
  packages?: Record<string, { resolution?: { integrity?: string }; os?: string[]; cpu?: string[] }>
  snapshots?: Record<string, Partial<Record<typeof RUNTIME_KINDS[number], Record<string, string>>>>
}

/** One external package in the closure, keyed by its exact resolved version. */
export interface ClosureComponent {
  /** npm package identity. */
  name: string
  /** Exact resolved version, without pnpm's peer-resolution suffix. */
  version: string
  /** Subresource integrity from the lockfile, absent for a package pnpm records without one. */
  integrity: string | undefined
  /** Snapshot keys this package depends on at runtime. */
  dependsOn: string[]
}

/**
 * Whether a workspace manifest path belongs to an area that never ships.
 * @param path - repository-relative directory of a workspace package.
 * @returns true when the area is repository tooling, tests, docs, or demos.
 */
function isDevOnlyArea(path: string): boolean {
  const manifest = path === '' ? 'package.json' : `${path}/package.json`
  return DEV_ONLY_AREAS.some(area => (area.endsWith('/') ? manifest.startsWith(area) : manifest === area))
}

/**
 * Strip pnpm's peer-resolution suffix from a lockfile version or snapshot key.
 * @param version - version text that may carry a trailing `(peer@range)` group.
 * @returns the bare semver text.
 */
function bareVersion(version: string): string {
  const parenthesis = version.indexOf('(')
  return parenthesis === -1 ? version : version.slice(0, parenthesis)
}

/**
 * Split a snapshot key into its package identity and resolved version.
 * @param key - snapshot key such as `@scope/name@1.2.3(peer@4.0.0)`.
 * @returns the package name and its bare version.
 */
export function parseSnapshotKey(key: string): { name: string; version: string } {
  // The peer group is stripped first: it contains `@` of its own, so splitting
  // on the last `@` of the whole key would cut inside it.
  const bare = bareVersion(key)
  const at = bare.lastIndexOf('@')
  return { name: bare.slice(0, at), version: bare.slice(at + 1) }
}

/**
 * Runtime dependency entries every shipped workspace package declares directly.
 * @param lock - the parsed lockfile.
 * @returns snapshot keys of the externally resolved direct runtime dependencies.
 */
export function seedKeys(lock: Lockfile): string[] {
  const seeds: string[] = []
  for (const [path, importer] of Object.entries(lock.importers ?? {})) {
    if (isDevOnlyArea(path === '.' ? '' : path)) continue
    for (const kind of RUNTIME_KINDS) {
      for (const [name, entry] of Object.entries(importer[kind] ?? {})) {
        // A workspace or vendored package is first-party source, not a resolved component.
        if (entry.version.startsWith('link:')) continue
        seeds.push(`${name}@${entry.version}`)
      }
    }
  }
  return seeds
}

/**
 * Whether a lockfile package is installed only on matching platforms.
 * @param lock - the parsed lockfile.
 * @param key - snapshot key of the package.
 * @returns true when the entry declares an `os` or `cpu` restriction.
 */
function isPlatformRestricted(lock: Lockfile, key: string): boolean {
  const { name, version } = parseSnapshotKey(key)
  const entry = lock.packages?.[`${name}@${version}`]
  return entry?.os !== undefined || entry?.cpu !== undefined
}

/**
 * Closure members every host installs, reached without crossing a
 * platform-restricted package. A package behind such a parent is present only
 * where the parent is, so requiring its store metadata would make the document
 * depend on the generating host.
 * @param lock - the parsed lockfile.
 * @returns the snapshot keys installed regardless of platform.
 */
export function unconditionalKeys(lock: Lockfile): Set<string> {
  const queue = seedKeys(lock)
  const unconditional = new Set<string>()
  while (queue.length > 0) {
    const key = queue.pop() as string
    if (unconditional.has(key) || isPlatformRestricted(lock, key)) continue
    unconditional.add(key)
    for (const kind of RUNTIME_KINDS) {
      for (const [depName, depVersion] of Object.entries(lock.snapshots?.[key]?.[kind] ?? {})) {
        queue.push(`${depName}@${depVersion}`)
      }
    }
  }
  return unconditional
}

/**
 * Walk the runtime closure of every shipped workspace package.
 * @param lock - the parsed lockfile.
 * @returns each reached package keyed by its snapshot key, in sorted key order.
 */
export function runtimeClosure(lock: Lockfile): Map<string, ClosureComponent> {
  const queue = seedKeys(lock)
  const reached = new Map<string, ClosureComponent>()
  while (queue.length > 0) {
    const key = queue.pop() as string
    if (reached.has(key)) continue
    const snapshot = lock.snapshots?.[key]
    const { name, version } = parseSnapshotKey(key)
    const dependsOn: string[] = []
    for (const kind of RUNTIME_KINDS) {
      for (const [depName, depVersion] of Object.entries(snapshot?.[kind] ?? {})) {
        const depKey = `${depName}@${depVersion}`
        dependsOn.push(depKey)
        queue.push(depKey)
      }
    }
    reached.set(key, {
      name,
      version,
      integrity: lock.packages?.[`${name}@${version}`]?.resolution?.integrity,
      dependsOn: dependsOn.sort(),
    })
  }
  return new Map([...reached].sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Read the declared license of one installed package version from the pnpm store.
 * @param root - absolute repository root.
 * @param name - npm package identity.
 * @param version - exact resolved version.
 * @returns the declared SPDX text, or undefined when the manifest declares none.
 */
function installedLicense(root: string, name: string, version: string): string | undefined {
  // pnpm's virtual store escapes `/` as `+` and may append a peer-resolution hash.
  const escaped = name.replaceAll('/', '+')
  for (const match of globSync(`node_modules/.pnpm/${escaped}@${version}*/node_modules/${name}/package.json`, { cwd: root })) {
    const manifest = JSON.parse(readFileSync(resolve(root, match), 'utf8')) as { license?: string }
    if (manifest.license !== undefined) return manifest.license
  }
  return undefined
}

/**
 * Package URL for an npm component, which also serves as its stable `bom-ref`.
 * @param name - npm package identity.
 * @param version - exact resolved version.
 * @returns the Package URL for this exact version.
 */
export function npmPurl(name: string, version: string): PackageURL {
  const slash = name.indexOf('/')
  const scoped = name.startsWith('@')
  return new PackageURL('npm', scoped ? name.slice(0, slash) : undefined, scoped ? name.slice(slash + 1) : name, version)
}

/**
 * Build the CycloneDX document for the shipped runtime closure.
 * @param root - absolute repository root.
 * @returns the serialized JSON document, newline-terminated.
 */
export function render(root: string): string {
  const lock = load(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')) as Lockfile
  const closure = runtimeClosure(lock)
  const unconditional = unconditionalKeys(lock)
  const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { name: string; version: string }

  const bom = new Models.Bom()
  // The document describes the workspace's shipped surface, not the root tooling manifest.
  bom.metadata.component = new Models.Component(
    Enums.ComponentType.Application,
    rootManifest.name,
    { version: rootManifest.version, bomRef: npmPurl(rootManifest.name, rootManifest.version).toString() },
  )

  const byKey = new Map<string, Models.Component>()
  for (const [key, entry] of closure) {
    // The Package URL doubles as the `bom-ref`, so a component keeps the same
    // identity across regenerations instead of the library's generated one.
    const purl = npmPurl(entry.name, entry.version).toString()
    const component = new Models.Component(Enums.ComponentType.Library, entry.name, {
      version: entry.version,
      bomRef: purl,
      purl,
    })
    // Only packages every host installs carry a declared license: which
    // platform-restricted variant sits in the store differs per generating
    // host, and reading that one would make the committed document depend on
    // where it was generated.
    const conditional = !unconditional.has(key)
    const license = conditional ? undefined : installedLicense(root, entry.name, entry.version)
    if (!conditional && license === undefined) {
      throw new Error(`gen-sbom: cannot resolve a license for ${entry.name}@${entry.version}; run \`pnpm install\`.`)
    }
    if (license !== undefined) component.licenses.add(licenseModel(license))
    if (entry.integrity !== undefined) {
      const [algorithm, value] = decodeIntegrity(entry.integrity)
      if (algorithm !== undefined) component.hashes.set(algorithm, value as string)
    }
    bom.components.add(component)
    byKey.set(key, component)
  }

  // Dependency edges are recorded after every component exists, so each
  // referenced `bom-ref` resolves inside the document.
  for (const [key, entry] of closure) {
    const component = byKey.get(key)
    if (component === undefined) continue
    for (const depKey of entry.dependsOn) {
      const dependency = byKey.get(depKey)
      if (dependency !== undefined) component.dependencies.add(dependency.bomRef)
    }
  }
  for (const component of byKey.values()) bom.metadata.component.dependencies.add(component.bomRef)

  const serializer = new Serialize.JsonSerializer(new Serialize.JSON.Normalize.Factory(Spec.Spec1dot6))
  // No timestamp or serial number: the document is committed and gate-compared,
  // so every field must be a pure function of the lockfile and the store.
  return `${serializer.serialize(bom, { sortLists: true, space: 2 })}\n`
}

/**
 * Model a declared license as an SPDX id where it is one, otherwise as free text.
 * @param license - the manifest's declared license text.
 * @returns the CycloneDX license model.
 */
function licenseModel(license: string): Models.License {
  return SPDX.isSupportedSpdxId(license)
    ? new Models.SpdxLicense(license)
    : new Models.NamedLicense(license)
}

/**
 * Decode a Subresource Integrity string into a CycloneDX hash pair.
 * @param integrity - the lockfile's `sha512-…` base64 integrity text.
 * @returns the hash algorithm and its hex digest, or undefined for an unknown algorithm.
 */
function decodeIntegrity(integrity: string): [Enums.HashAlgorithm | undefined, string | undefined] {
  const separator = integrity.indexOf('-')
  const algorithm = integrity.slice(0, separator)
  const known: Record<string, Enums.HashAlgorithm> = {
    sha512: Enums.HashAlgorithm['SHA-512'],
    sha384: Enums.HashAlgorithm['SHA-384'],
    sha256: Enums.HashAlgorithm['SHA-256'],
    sha1: Enums.HashAlgorithm['SHA-1'],
  }
  const mapped = known[algorithm]
  if (mapped === undefined) return [undefined, undefined]
  return [mapped, Buffer.from(integrity.slice(separator + 1), 'base64').toString('hex')]
}

/**
 * Runtime-independent filesystem globbing for repository gates.
 *
 * `node:fs` `globSync` is a runtime built-in, so its results depend on which
 * engine executes a gate. Bun's implementation returns nothing for a pattern
 * whose leading segment is a literal dot directory (`.agents/notes/**\/*.md`),
 * which silently reduces a gate's scope to zero files instead of failing. This
 * module walks with `fdir` and matches with `picomatch`, so every gate sees the
 * same files under any runtime.
 *
 * Matching reproduces `node:fs` `globSync`: a literal dot segment matches, a
 * wildcard never matches a dot entry, `**` matches zero or more segments and
 * yields directories as well as files. `scripts/glob.spec.ts` pins that
 * agreement against the built-in.
 *
 * @module
 */

import { relative, resolve, sep } from 'node:path'
import { fdir } from 'fdir'
import picomatch from 'picomatch'

/** A matched directory entry, carrying the `node:fs` `Dirent` members gates read. */
export interface GlobEntry {
  /** Final path segment of the match. */
  name: string
  /** Absolute path of the directory containing the match. */
  parentPath: string
  /** Whether the match is a directory. */
  isDirectory: () => boolean
  /** Whether the match is a regular file. */
  isFile: () => boolean
}

/** Options accepted by {@link globSync}; the subset of `node:fs` globSync the gates use. */
export interface GlobOptions {
  /** Directory the patterns and returned paths are relative to. Defaults to `process.cwd()`. */
  cwd?: string
  /** Glob patterns whose matches are dropped, and whose directories are not descended. */
  exclude?: readonly string[]
  /** Return {@link GlobEntry} objects instead of repository-relative path strings. */
  withFileTypes?: boolean
}

/** One walk root: the literal prefix of a pattern, plus its depth budget. */
interface WalkPlan {
  /** Longest literal directory prefix shared by the pattern, `''` for the whole tree. */
  base: string
  /** Directory levels to descend below `base`, or `undefined` when `**` makes it unbounded. */
  depth: number | undefined
}

/**
 * Longest literal directory prefix of a pattern, used to avoid walking the
 * whole tree for a pattern that can only match under one directory.
 * @param pattern - glob pattern in POSIX form.
 * @returns the prefix without a trailing slash, or `''` when the first segment is dynamic.
 */
function staticBase(pattern: string): string {
  const segments = pattern.split('/')
  const literal: string[] = []
  for (const segment of segments) {
    if (/[*?[\]{}!]/.test(segment)) return literal.join('/')
    literal.push(segment)
  }
  // Wholly literal: the final segment names the entry itself, not a directory.
  literal.pop()
  return literal.join('/')
}

/**
 * Depth budget for a walk root. A `**` in any pattern makes depth unbounded;
 * otherwise the deepest pattern fixes how far below `base` a match can sit.
 * @param patterns - every pattern sharing this walk root.
 * @param base - the walk root's literal prefix.
 * @returns the level count to descend, or `undefined` when unbounded.
 */
function depthBudget(patterns: readonly string[], base: string): number | undefined {
  if (patterns.some(pattern => pattern.split('/').includes('**'))) return undefined
  const baseDepth = base === '' ? 0 : base.split('/').length
  return Math.max(...patterns.map(pattern => pattern.split('/').length)) - baseDepth
}

/**
 * Collapse patterns into the walk roots that cover them. A pattern rooted at the
 * tree makes one whole-tree walk cover every pattern.
 * @param patterns - the caller's glob patterns.
 * @returns walk roots to crawl, each with its depth budget.
 */
function walkPlans(patterns: readonly string[]): WalkPlan[] {
  const bases = [...new Set(patterns.map(staticBase))]
  if (bases.includes('')) return [{ base: '', depth: depthBudget(patterns, '') }]
  return bases.map(base => ({ base, depth: depthBudget(patterns, base) }))
}

export function globSync(patterns: string | readonly string[], options?: GlobOptions & { withFileTypes?: false }): string[]
export function globSync(patterns: string | readonly string[], options: GlobOptions & { withFileTypes: true }): GlobEntry[]
/**
 * Expand glob patterns against the filesystem with runtime-independent results.
 * @param patterns - one pattern or a list, POSIX-separated and relative to `cwd`.
 * @param options - walk root, exclusions, and result form.
 * @returns matches relative to `cwd` in walk order, as paths or {@link GlobEntry} objects.
 */
export function globSync(
  patterns: string | readonly string[],
  options: GlobOptions = {},
): string[] | GlobEntry[] {
  const list = typeof patterns === 'string' ? [patterns] : [...patterns]
  const cwd = options.cwd ?? process.cwd()
  const isMatch = picomatch(list)
  const isExcluded = options.exclude === undefined ? undefined : picomatch([...options.exclude])

  const seen = new Set<string>()
  const paths: string[] = []
  const directories = new Set<string>()

  for (const { base, depth } of walkPlans(list)) {
    const root = base === '' ? cwd : resolve(cwd, base)
    let crawler = new fdir().withRelativePaths().withDirs()
    if (depth !== undefined) crawler = crawler.withMaxDepth(depth)
    if (isExcluded !== undefined) {
      crawler = crawler.exclude((_name, directoryPath) => {
        const rel = toPosix(relative(cwd, directoryPath)).replace(/\/$/, '')
        return rel !== '' && isExcluded(rel)
      })
    }

    // A pattern may name a directory that does not exist in this checkout.
    let crawled: string[]
    try {
      crawled = crawler.crawl(root).sync()
    } catch {
      // Missing walk root: no entry beneath it can match, so contribute nothing.
      continue
    }

    // fdir omits the walk root itself; `**` matches it in the built-in.
    if (base !== '') record(base, true)
    for (const entry of crawled) {
      const rel = toPosix(entry)
      const isDirectory = rel.endsWith('/')
      const trimmed = isDirectory ? rel.slice(0, -1) : rel
      if (trimmed === '' || trimmed === '.') continue
      record(base === '' ? trimmed : `${base}/${trimmed}`, isDirectory)
    }
  }

  if (options.withFileTypes === true) return paths.map(path => toEntry(path, cwd, directories))
  return paths

  /**
   * Keep a candidate when the patterns accept it and no exclusion rejects it.
   * @param path - candidate path relative to `cwd`, POSIX-separated.
   * @param isDirectory - whether the candidate is a directory.
   */
  function record(path: string, isDirectory: boolean): void {
    if (seen.has(path)) return
    if (!isMatch(path)) return
    if (isExcluded?.(path) === true) return
    seen.add(path)
    paths.push(path)
    if (isDirectory) directories.add(path)
  }
}

/**
 * Normalize a walker path to the POSIX separators every pattern is written in.
 * @param path - path using the host separator.
 * @returns the same path with `/` separators.
 */
function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

/**
 * Build the `Dirent`-compatible view of a match.
 * @param path - match relative to `cwd`, POSIX-separated.
 * @param cwd - directory the match is relative to.
 * @param directories - matches the walk identified as directories.
 * @returns the entry with its name, parent, and kind predicates.
 */
function toEntry(path: string, cwd: string, directories: ReadonlySet<string>): GlobEntry {
  const segments = path.split('/')
  const name = segments[segments.length - 1] ?? path
  const isDirectory = directories.has(path)
  return {
    name,
    parentPath: resolve(cwd, segments.slice(0, -1).join('/')),
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  }
}

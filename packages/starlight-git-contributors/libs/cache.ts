import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { gitText, type RankedContributor } from "./git-blame.ts";

const SCHEMA_VERSION = 2;

/**
 * On-disk shape. `entries` values are `unknown`: a hand-edited or
 * partially-written cache file can land any shape under a key, so
 * `isRankedContributorArray` validates each entry on read instead of
 * trusting the top-level guard.
 */
interface CacheFile {
	schema: number;
	head: string;
	mailmap: string;
	/** Keyed by repo-relative POSIX path so the cache survives repo moves. */
	entries: Record<string, unknown>;
}

interface CacheState {
	data: CacheFile;
	dirty: boolean;
	/** `null` when the cache cannot be persisted (e.g., worktree with `.git` as a file). */
	path: string | null;
}

// Vite bundles this module twice (plugin integration + component graph),
// giving each copy its own state. Pin the memo to a process-wide property
// so flushes see every write. Namespace-prefixed to avoid collision.
declare global {
	var __starlightGitContributorsCacheMemoV2:
		| Map<string, CacheState>
		| undefined;
}

globalThis.__starlightGitContributorsCacheMemoV2 ??= new Map<
	string,
	CacheState
>();
const memo: Map<string, CacheState> =
	globalThis.__starlightGitContributorsCacheMemoV2;

/**
 * Shell check only: schema/head/mailmap are the right primitive types
 * and `entries` is a plain object. {@link getCached} validates each
 * entry on read, so one corrupt entry can't poison the rest.
 */
function isCacheFile(value: unknown): value is CacheFile {
	if (typeof value !== "object" || value === null) return false;
	if (!("schema" in value) || typeof value.schema !== "number") return false;
	if (!("head" in value) || typeof value.head !== "string") return false;
	if (!("mailmap" in value) || typeof value.mailmap !== "string") return false;
	if (!("entries" in value)) return false;
	const { entries } = value;
	if (typeof entries !== "object" || entries === null) return false;
	if (Array.isArray(entries)) return false;
	return true;
}

/**
 * Deep guard for cached ranking values. Returns true only for an array
 * of `{ name: string; email: string; lines: number }`. Strings, arrays
 * of strings, or arrays of objects with wrong field types all fail.
 */
function isRankedContributorArray(
	value: unknown,
): value is RankedContributor[] {
	if (!Array.isArray(value)) return false;
	for (const item of value) {
		if (typeof item !== "object" || item === null) return false;
		if (!("name" in item) || typeof item.name !== "string") return false;
		if (!("email" in item) || typeof item.email !== "string") return false;
		if (!("lines" in item) || typeof item.lines !== "number") return false;
	}
	return true;
}

function resolveCachePath(repoRoot: string): string | null {
	// `git worktree` makes `.git` a file (gitdir pointer) instead of a directory.
	// Skip persistence in that case rather than try to follow the pointer.
	try {
		const stats = statSync(join(repoRoot, ".git"));
		if (!stats.isDirectory()) return null;
	} catch {
		return null;
	}
	return join(
		repoRoot,
		".git",
		"info",
		`starlight-git-contributors.v${SCHEMA_VERSION}.json`,
	);
}

function mailmapHash(repoRoot: string): string {
	let content = "";
	try {
		content = readFileSync(join(repoRoot, ".mailmap"), "utf8");
	} catch {
		// No mailmap file: hash the empty string, which is stable.
	}
	return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

/**
 * Repo-relative POSIX-style key. Storing relative paths (instead of
 * absolute) keeps the cache valid when the repo gets cloned to a
 * different directory: CI cache restores, Docker bind-mount changes,
 * developer re-clones under a different name.
 */
function relKey(repoRoot: string, absFile: string): string {
	return relative(repoRoot, absFile).replaceAll(sep, "/");
}

function load(repoRoot: string): CacheState {
	const existing = memo.get(repoRoot);
	if (existing) return existing;

	const currentHead = gitText(repoRoot, ["rev-parse", "HEAD"]) ?? "";
	const currentMailmap = mailmapHash(repoRoot);
	const path = resolveCachePath(repoRoot);
	const blank: CacheState = {
		data: {
			schema: SCHEMA_VERSION,
			head: currentHead,
			mailmap: currentMailmap,
			entries: {},
		},
		dirty: false,
		path,
	};

	if (path === null) {
		memo.set(repoRoot, blank);
		return blank;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		// Missing file or corrupt JSON: fall back to a blank cache.
		memo.set(repoRoot, blank);
		return blank;
	}

	if (!isCacheFile(parsed)) {
		// Valid JSON of unexpected shape (e.g., schema drift, hand-edit gone wrong).
		memo.set(repoRoot, blank);
		return blank;
	}
	const stored = parsed;

	if (stored.schema !== SCHEMA_VERSION || stored.mailmap !== currentMailmap) {
		memo.set(repoRoot, blank);
		return blank;
	}

	if (stored.head === currentHead) {
		const state: CacheState = {
			data: { ...blank.data, head: stored.head, entries: stored.entries },
			dirty: false,
			path,
		};
		memo.set(repoRoot, state);
		return state;
	}

	// HEAD moved: keep entries for files unchanged between the stored HEAD
	// and the current HEAD. Anything diffed (modify/add/delete/rename) gets
	// re-blamed on next access. `git diff --name-only` emits repo-relative
	// POSIX paths, matching our entry keys.
	const diff = gitText(repoRoot, [
		"diff",
		"--name-only",
		`${stored.head}..HEAD`,
	]);
	if (diff === null) {
		memo.set(repoRoot, blank);
		return blank;
	}
	const changed = new Set(diff.split("\n").filter(Boolean));
	const reused = Object.fromEntries(
		Object.entries(stored.entries).filter(([relPath]) => !changed.has(relPath)),
	);
	const state: CacheState = {
		data: { ...blank.data, entries: reused },
		dirty: true,
		path,
	};
	memo.set(repoRoot, state);
	return state;
}

export function getCached(
	repoRoot: string,
	absFilePath: string,
): RankedContributor[] | undefined {
	const entry = load(repoRoot).data.entries[relKey(repoRoot, absFilePath)];
	// load()'s shell check only knows `entries` is an object. A
	// hand-edited or schema-drifted cache can land strings, nested
	// objects, or arrays of wrong shape under a key. Treat any
	// non-conforming entry as a miss and let `git blame` rebuild it.
	return isRankedContributorArray(entry) ? entry : undefined;
}

export function setCached(
	repoRoot: string,
	absFilePath: string,
	value: RankedContributor[],
): void {
	const state = load(repoRoot);
	state.data.entries[relKey(repoRoot, absFilePath)] = value;
	state.dirty = true;
}

/**
 * Persist any dirty caches to disk. Called from the plugin's
 * `astro:build:done` hook so cold builds batch their writes instead of
 * rewriting the JSON file per page. Safe to call multiple times.
 *
 * Prunes entries for files that no longer exist in the working tree.
 * Uncommitted deletions don't show up in `git diff`, so without this
 * pruning step the cache accumulates stale entries.
 */
export function flushCache(): void {
	for (const [repoRoot, state] of memo) {
		if (!state.dirty || state.path === null) continue;
		try {
			state.data.entries = pruneMissing(repoRoot, state.data.entries);
			mkdirSync(dirname(state.path), { recursive: true });
			writeFileSync(state.path, JSON.stringify(state.data));
			state.dirty = false;
		} catch {
			// Cache is a build-time optimization; failure to persist is fine.
		}
	}
}

function pruneMissing(
	repoRoot: string,
	entries: Record<string, unknown>,
): Record<string, unknown> {
	const kept: Record<string, unknown> = {};
	for (const [rel, value] of Object.entries(entries)) {
		if (existsSync(join(repoRoot, rel))) kept[rel] = value;
	}
	return kept;
}

/** Test-only: reset module state between fixtures. */
export function _resetCacheForTests(): void {
	memo.clear();
}

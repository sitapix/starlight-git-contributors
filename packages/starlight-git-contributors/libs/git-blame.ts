import {
	type ChildProcessWithoutNullStreams,
	spawn,
	spawnSync,
} from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { getCached, setCached } from "./cache.ts";

export interface BlamedLine {
	sha: string;
	author: string;
	email: string;
	timestamp: number;
}

export interface RankedContributor {
	name: string;
	email: string;
	lines: number;
}

export interface RankOptions {
	top?: number;
	ignore?: readonly string[];
}

/**
 * Discriminated union of every warning the blame pipeline emits. A
 * custom handler switches on `event.reason` to read per-case fields
 * directly, skipping any message-string parsing.
 */
export type BlameWarning =
	| { reason: "git-not-found" }
	| { reason: "not-a-git-repo"; filePath: string }
	| { reason: "file-outside-repo"; filePath: string; repoRoot: string }
	| {
			reason: "blame-failed";
			rel: string;
			stderr: string;
			code: number | null;
	  }
	| { reason: "shallow-repo"; repoRoot: string };

export type BlameWarningReason = BlameWarning["reason"];

export type BlameWarningHandler = (event: BlameWarning) => void;

const ZERO_SHA = "0000000000000000000000000000000000000000";

/**
 * Run `git` with the given args and return trimmed stdout. Returns `null`
 * on non-zero exit or spawn failure (e.g., git not on PATH). Used by every
 * read-only git invocation in the package.
 */
export function gitText(cwd: string, args: readonly string[]): string | null {
	const r = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (r.status !== 0) return null;
	return r.stdout.trim();
}

/**
 * Module-scoped dedup set. Astro re-renders components on every request in
 * dev mode and once per page in build mode. Without dedup, "git not found"
 * on a 200-page site fires 200 warnings.
 */
const seenWarnings = new Set<string>();

/**
 * Default warning handler: log once per unique event shape to stderr
 * with a `[starlight-git-contributors]` prefix. Override via `onWarning`
 * on `contributorsForFile` / `runBlame`; pass `onWarning: () => {}` to
 * silence.
 *
 * Dedup key is `JSON.stringify(event)`, so two `not-a-git-repo` events
 * for different files log twice, but a repeated `git-not-found` logs
 * once.
 */
export const consoleWarnOnce: BlameWarningHandler = (event) => {
	const key = JSON.stringify(event);
	if (seenWarnings.has(key)) return;
	seenWarnings.add(key);
	console.warn(`[starlight-git-contributors] ${formatBlameWarning(event)}`);
};

function formatBlameWarning(event: BlameWarning): string {
	switch (event.reason) {
		case "git-not-found":
			return "`git` is not available on PATH. Contributor lists will be empty. Install git or update your CI image.";
		case "not-a-git-repo":
			return `${event.filePath} is not inside a git working tree. Skipping contributor list.`;
		case "file-outside-repo":
			return `${event.filePath} resolves outside the repo root ${event.repoRoot}. Skipping contributor list.`;
		case "blame-failed":
			return `git blame failed for ${event.rel}: ${event.stderr || `exit ${event.code ?? "?"}`}`;
		case "shallow-repo":
			return `Repo at ${event.repoRoot} is a shallow clone. Contributor history is truncated. Set \`fetch-depth: 0\` (GitHub Actions), \`GIT_DEPTH: 0\` (GitLab CI), or \`clone: depth: full\` (Bitbucket Pipelines).`;
	}
}

/**
 * Parse `git blame --line-porcelain` output. With `--line-porcelain`, the
 * full author/mail/time header is repeated for every blamed line, so we
 * emit one record per `\t`-prefixed content line using the most recent
 * header values. Uncommitted modifications (SHA = 40×'0', author = "Not
 * Committed Yet") are skipped; they aren't real contributions yet.
 */
export function parseBlamePorcelain(porcelain: string): readonly BlamedLine[] {
	if (!porcelain) return [];

	const result: BlamedLine[] = [];
	let sha = "";
	let author = "";
	let email = "";
	let timestamp = 0;

	for (const line of porcelain.split("\n")) {
		if (line.startsWith("\t")) {
			if (sha && sha !== ZERO_SHA && author && author !== "Not Committed Yet") {
				result.push({ sha, author, email, timestamp });
			}
			continue;
		}

		const header = /^([0-9a-f]{7,40}) \d+ \d+(?: \d+)?$/.exec(line);
		if (header?.[1]) {
			sha = header[1];
			author = "";
			email = "";
			timestamp = 0;
			continue;
		}

		if (line.startsWith("author ")) author = line.slice(7);
		else if (line.startsWith("author-mail "))
			email = line.slice(12).replace(/^<|>$/g, "");
		else if (line.startsWith("author-time "))
			timestamp = Number.parseInt(line.slice(12), 10) || 0;
	}

	return result;
}

export function rankContributors(
	lines: readonly BlamedLine[],
	options: RankOptions = {},
): RankedContributor[] {
	const tally = new Map<string, RankedContributor>();

	for (const line of lines) {
		const key = line.email.toLowerCase() || line.author.toLowerCase();
		const existing = tally.get(key);
		if (existing) {
			existing.lines += 1;
		} else {
			tally.set(key, { name: line.author, email: line.email, lines: 1 });
		}
	}

	const ranked = [...tally.values()].sort(
		(a, b) => b.lines - a.lines || a.name.localeCompare(b.name),
	);
	return applyRankOptions(ranked, options);
}

export interface BlameOptions {
	filePath: string;
	cwd?: string;
	follow?: boolean;
	ignoreWhitespace?: boolean;
	onWarning?: BlameWarningHandler;
	/**
	 * Pre-resolved canonical repo root, to skip the internal
	 * `git rev-parse --show-toplevel` call. Callers that already know the
	 * repo root (e.g., from a cache layer) should pass it through to avoid
	 * a redundant subprocess. Explicit `undefined` is accepted so callers
	 * may forward an optional value without a conditional spread.
	 */
	repoRoot?: string | undefined;
}

/**
 * Internal: validate inputs and build the `git blame` argv. Returns
 * `null` (after firing the appropriate warning) for any precondition
 * failure. Shared by both `runBlame` (sync) and `runBlameAsync`.
 */
interface BlameRequest {
	repoRoot: string;
	rel: string;
	args: string[];
}

function prepareBlameRequest(options: BlameOptions): BlameRequest | null {
	const { onWarning } = options;
	const cwd = options.cwd ?? dirname(options.filePath);

	if (!hasGit()) {
		onWarning?.({ reason: "git-not-found" });
		return null;
	}

	const repoRoot = options.repoRoot ?? findRepoRoot(cwd);
	if (!repoRoot) {
		onWarning?.({ reason: "not-a-git-repo", filePath: options.filePath });
		return null;
	}

	// macOS's tmpdir() returns /var/folders/... while the canonical repo
	// root is /private/var/..., so realpath the file end too to keep
	// `path.relative` from producing `../../../` traversal.
	const absFile = canonicalize(resolve(options.filePath));
	const rel = relative(repoRoot, absFile);
	if (!rel || rel.startsWith("..")) {
		onWarning?.({
			reason: "file-outside-repo",
			filePath: options.filePath,
			repoRoot,
		});
		return null;
	}

	if (isShallowRepo(repoRoot)) {
		onWarning?.({ reason: "shallow-repo", repoRoot });
	}

	const args = ["blame", "--line-porcelain"];
	if (options.follow !== false) args.push("--follow");
	if (options.ignoreWhitespace !== false) args.push("-w");
	args.push("--", rel);

	return { repoRoot, rel, args };
}

/**
 * Invoke `git blame --line-porcelain` via spawnSync (argv array, no shell
 * interpolation) and return raw porcelain text. Returns `null` for any
 * failure (no git, not a repo, file outside repo, blame error) and never
 * throws. On failure, the optional `onWarning` callback fires with a
 * structured reason and a human-readable detail, so callers can surface
 * the problem without crashing the build.
 *
 * Defaults: `--follow` (track renames), `-w` (ignore whitespace-only
 * changes so reformatting commits don't reattribute lines).
 */
export function runBlame(options: BlameOptions): string | null {
	const req = prepareBlameRequest(options);
	if (!req) return null;

	const result = spawnSync("git", req.args, {
		cwd: req.repoRoot,
		encoding: "utf8",
		maxBuffer: 50 * 1024 * 1024,
	});

	if (result.status !== 0) {
		options.onWarning?.({
			reason: "blame-failed",
			rel: req.rel,
			stderr: (result.stderr || "").trim(),
			code: result.status ?? null,
		});
		return null;
	}
	return result.stdout;
}

/**
 * Async variant of {@link runBlame}. Uses `child_process.spawn` so callers
 * (e.g. the prewarm step) can run many blames in parallel. Never throws;
 * resolves to `null` on any failure with the same warning semantics as
 * the sync variant.
 */
export function runBlameAsync(options: BlameOptions): Promise<string | null> {
	const req = prepareBlameRequest(options);
	if (!req) return Promise.resolve(null);
	return spawnGitText(req.repoRoot, req.args).then((result) => {
		if (result.status === "ok") return result.stdout;
		options.onWarning?.({
			reason: "blame-failed",
			rel: req.rel,
			stderr: result.stderr,
			code: result.code,
		});
		return null;
	});
}

type SpawnResult =
	| { status: "ok"; stdout: string }
	| { status: "fail"; code: number | null; stderr: string };

function spawnGitText(
	cwd: string,
	args: readonly string[],
): Promise<SpawnResult> {
	return new Promise((resolveP) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const settle = (r: SpawnResult) => {
			if (settled) return;
			settled = true;
			resolveP(r);
		};

		let proc: ChildProcessWithoutNullStreams;
		try {
			proc = spawn("git", [...args], { cwd, windowsHide: true });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			settle({ status: "fail", code: null, stderr: message });
			return;
		}
		proc.stdout.setEncoding("utf8");
		proc.stderr.setEncoding("utf8");
		proc.stdout.on("data", (d: string) => {
			stdout += d;
		});
		proc.stderr.on("data", (d: string) => {
			stderr += d;
		});
		proc.on("error", (e) =>
			settle({ status: "fail", code: null, stderr: e.message }),
		);
		proc.on("close", (code) => {
			settle(
				code === 0
					? { status: "ok", stdout }
					: { status: "fail", code, stderr: stderr.trim() },
			);
		});
	});
}

function canonicalize(p: string): string {
	try {
		return realpathSync(p);
	} catch {
		return p;
	}
}

let gitProbe: boolean | null = null;
function hasGit(): boolean {
	if (gitProbe !== null) return gitProbe;
	// `git --version` ignores cwd, but gitText() requires one. Pass the
	// current process dir as a known-valid placeholder.
	gitProbe = gitText(process.cwd(), ["--version"]) !== null;
	return gitProbe;
}

const repoRootCache = new Map<string, string | null>();

/**
 * Walk up from `from` looking for a `.git` entry (directory in a normal
 * clone, file in a worktree). Pure filesystem traversal saves one
 * `git rev-parse --show-toplevel` subprocess per unique starting dir.
 *
 * Limitation: doesn't honor `GIT_DIR` / `GIT_WORK_TREE` env overrides.
 * In practice, build-time tooling for docs sites doesn't set those.
 */
function findRepoRoot(from: string): string | null {
	const cached = repoRootCache.get(from);
	if (cached !== undefined) return cached;

	let dir: string;
	try {
		dir = canonicalize(resolve(from));
	} catch {
		repoRootCache.set(from, null);
		return null;
	}

	while (true) {
		if (existsSync(join(dir, ".git"))) {
			repoRootCache.set(from, dir);
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	repoRootCache.set(from, null);
	return null;
}

/**
 * Detect whether the git repo containing `from` is a shallow clone. CI
 * runners (GitHub Actions, GitLab CI, Bitbucket Pipelines) shallow-clone
 * by default, which causes `git blame` to under-report authors.
 */
export function isShallowRepo(from: string): boolean {
	return gitText(from, ["rev-parse", "--is-shallow-repository"]) === "true";
}

/**
 * Public entrypoint used by `<PageContributors />`. Warnings default to
 * `consoleWarnOnce` so build operators see a single line per unique
 * problem instead of N lines per N pages. Pass `onWarning: () => {}` to
 * silence; pass your own handler to integrate with a logger.
 *
 * Set `cache: true` to persist the full ranking under `.git/info/` and
 * skip `git blame` on subsequent builds when neither HEAD nor `.mailmap`
 * changed for this file. The cache stores unfiltered rankings, so
 * `top`/`ignore` get re-applied on read and cache entries survive option
 * changes.
 */
export type ContributorsForFileOptions = RankOptions & {
	onWarning?: BlameWarningHandler;
	cache?: boolean;
};

type CacheKey = { repoRoot: string; absFile: string };

/**
 * Resolve cache identity for `filePath`, and check for a hot cache entry.
 * Returned `hit` is the pre-filter ranking; callers slice/ignore via
 * `applyRankOptions`. `null` cache key means caching is disabled or the
 * file isn't in any repo we recognize.
 */
function lookupCache(
	filePath: string,
	cache: boolean,
): { key: CacheKey | null; hit: RankedContributor[] | undefined } {
	if (!cache) return { key: null, hit: undefined };
	const repoRoot = findRepoRoot(dirname(filePath));
	if (!repoRoot) return { key: null, hit: undefined };
	const absFile = canonicalize(resolve(filePath));
	return { key: { repoRoot, absFile }, hit: getCached(repoRoot, absFile) };
}

function finalizeBlame(
	porcelain: string | null,
	key: CacheKey | null,
	rank: RankOptions,
): RankedContributor[] {
	if (!porcelain) return [];
	const full = rankContributors(parseBlamePorcelain(porcelain));
	if (key) setCached(key.repoRoot, key.absFile, full);
	return applyRankOptions(full, rank);
}

/**
 * Public entrypoint used by `<PageContributors />`. Warnings default to
 * `consoleWarnOnce` so build operators see a single line per unique
 * problem instead of N lines per N pages. Pass `onWarning: () => {}` to
 * silence; pass your own handler to integrate with a logger.
 *
 * Set `cache: true` to persist the full ranking under `.git/info/` and
 * skip `git blame` on subsequent builds when neither HEAD nor `.mailmap`
 * changed for this file. The cache stores unfiltered rankings, so
 * `top`/`ignore` get re-applied on read and cache entries survive option
 * changes.
 */
export function contributorsForFile(
	filePath: string,
	options: ContributorsForFileOptions = {},
): RankedContributor[] {
	const { onWarning = consoleWarnOnce, cache = false, ...rank } = options;
	const { key, hit } = lookupCache(filePath, cache);
	if (hit) return applyRankOptions(hit, rank);
	const porcelain = runBlame({ filePath, onWarning, repoRoot: key?.repoRoot });
	return finalizeBlame(porcelain, key, rank);
}

/**
 * Async mirror of {@link contributorsForFile}. Use this in batch
 * pre-computation paths (e.g. the plugin's build-time prewarm) where
 * many files can be blamed in parallel. The cache layer is shared, so a
 * hot entry written here is read by the sync `contributorsForFile`
 * during page render.
 */
export async function contributorsForFileAsync(
	filePath: string,
	options: ContributorsForFileOptions = {},
): Promise<RankedContributor[]> {
	const { onWarning = consoleWarnOnce, cache = false, ...rank } = options;
	const { key, hit } = lookupCache(filePath, cache);
	if (hit) return applyRankOptions(hit, rank);
	const porcelain = await runBlameAsync({
		filePath,
		onWarning,
		repoRoot: key?.repoRoot,
	});
	return finalizeBlame(porcelain, key, rank);
}

function applyRankOptions(
	ranking: readonly RankedContributor[],
	options: RankOptions,
): RankedContributor[] {
	const ignore = new Set((options.ignore ?? []).map((s) => s.toLowerCase()));
	const filtered = ranking.filter(
		(r) =>
			!ignore.has(r.email.toLowerCase()) && !ignore.has(r.name.toLowerCase()),
	);
	return typeof options.top === "number"
		? filtered.slice(0, options.top)
		: filtered;
}

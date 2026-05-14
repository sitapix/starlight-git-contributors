import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";

import {
	type BlameWarningHandler,
	consoleWarnOnce,
	contributorsForFileAsync,
} from "./git-blame.ts";

export interface PrewarmOptions {
	/**
	 * Root directory to scan for content files. The walker descends
	 * recursively, skipping dot-dirs and `node_modules`.
	 */
	contentDir: string;
	/** File extensions to include. Default: `.md`, `.mdx`, `.mdoc`. */
	extensions?: readonly string[];
	/**
	 * Max parallel `git blame` subprocesses. Default `8`. Tuned for SSDs
	 * with reasonable CPU; lower it on constrained CI runners.
	 */
	concurrency?: number;
	onWarning?: BlameWarningHandler;
}

export interface PrewarmResult {
	scanned: number;
	durationMs: number;
}

/**
 * Walk `contentDir`, run `git blame` for every matching file in parallel,
 * and write the results into the build-time cache. Never throws.
 * Per-file failures surface as warnings via `onWarning`.
 *
 * The plugin wires this to Astro's `astro:build:start` hook so cold
 * builds amortize blame across `concurrency` workers instead of paying
 * the round-trip cost serially during page render.
 */
export async function prewarmCache(
	opts: PrewarmOptions,
): Promise<PrewarmResult> {
	const t0 = Date.now();
	const exts = opts.extensions ?? DEFAULT_EXTENSIONS;
	const concurrency = Math.max(1, opts.concurrency ?? 8);
	const onWarning = opts.onWarning ?? consoleWarnOnce;

	const files = walkContent(opts.contentDir, exts);
	await mapWithConcurrency(files, concurrency, (file) =>
		contributorsForFileAsync(file, { cache: true, onWarning }).then(
			() => undefined,
			() => undefined,
		),
	);

	return { scanned: files.length, durationMs: Date.now() - t0 };
}

const DEFAULT_EXTENSIONS = [".md", ".mdx", ".mdoc"] as const;

/**
 * Tiny recursive walker. Intentionally avoids `fs.glob` (still flagged
 * experimental in Node 22) and any third-party glob library to keep the
 * package dependency-free.
 */
function walkContent(dir: string, exts: readonly string[]): string[] {
	const out: string[] = [];
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...walkContent(full, exts));
		} else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Fixed-size worker pool. Each worker pulls the next index off a shared
 * cursor until the input is exhausted. Failures inside `fn` are
 * swallowed; the prewarm contract is best-effort.
 */
async function mapWithConcurrency<T>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	if (items.length === 0) return;
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (true) {
			const i = cursor++;
			const item = items[i];
			if (item === undefined) return;
			try {
				await fn(item);
			} catch {
				// best-effort
			}
		}
	};
	const n = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: n }, () => worker()));
}

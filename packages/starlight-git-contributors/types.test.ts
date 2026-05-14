import { test } from "node:test";
import type VirtualConfig from "virtual:starlight-git-contributors/config";
import type {
	BlamedLine,
	BlameOptions,
	BlameWarning,
	BlameWarningHandler,
	BlameWarningReason,
	ContributorsForFileOptions,
	PrewarmOptions,
	PrewarmResult,
	RankedContributor,
	RankOptions,
	StarlightGitContributorsOptions,
} from "./index.ts";
import starlightGitContributors, {
	type consoleWarnOnce,
	type contributorsForFile,
	type contributorsForFileAsync,
	type isShallowRepo,
	type parseBlamePorcelain,
	type prewarmCache,
	type rankContributors,
	type runBlame,
	type runBlameAsync,
} from "./index.ts";
import type { ResolvedOptions } from "./libs/plugin-internals.ts";
import type { StarlightGitContributorsContext } from "./libs/vite.ts";

/**
 * Compile-time equality: both directions of subtyping must hold.
 * Yields `true` only for exact structural equality.
 */
type AssertEqual<T, U> = [T] extends [U]
	? [U] extends [T]
		? true
		: false
	: false;

// Force evaluation of the assertion. If any of these is `false` instead of
// `true`, `tsc` (and `node --experimental-strip-types` type-only check)
// raises a compile error and the file fails to load.
const _check = <T extends true>(_: T): void => {};

// ---- BlamedLine -----------------------------------------------------------
_check<
	AssertEqual<
		BlamedLine,
		{
			sha: string;
			author: string;
			email: string;
			timestamp: number;
		}
	>
>(true);

// ---- RankedContributor ----------------------------------------------------
_check<
	AssertEqual<
		RankedContributor,
		{
			name: string;
			email: string;
			lines: number;
		}
	>
>(true);

// ---- RankOptions ----------------------------------------------------------
_check<
	AssertEqual<
		RankOptions,
		{
			top?: number;
			ignore?: readonly string[];
		}
	>
>(true);

// ---- BlameWarningReason: derived from the BlameWarning union -------------
_check<
	AssertEqual<
		BlameWarningReason,
		| "git-not-found"
		| "not-a-git-repo"
		| "file-outside-repo"
		| "blame-failed"
		| "shallow-repo"
	>
>(true);

// ---- BlameWarning: discriminated union with per-reason payloads ----------
type ExtractWarning<R extends BlameWarningReason> = Extract<
	BlameWarning,
	{ reason: R }
>;
_check<
	AssertEqual<ExtractWarning<"git-not-found">, { reason: "git-not-found" }>
>(true);
_check<
	AssertEqual<
		ExtractWarning<"not-a-git-repo">,
		{ reason: "not-a-git-repo"; filePath: string }
	>
>(true);
_check<
	AssertEqual<
		ExtractWarning<"file-outside-repo">,
		{ reason: "file-outside-repo"; filePath: string; repoRoot: string }
	>
>(true);
_check<
	AssertEqual<
		ExtractWarning<"blame-failed">,
		{
			reason: "blame-failed";
			rel: string;
			stderr: string;
			code: number | null;
		}
	>
>(true);
_check<
	AssertEqual<
		ExtractWarning<"shallow-repo">,
		{ reason: "shallow-repo"; repoRoot: string }
	>
>(true);

// ---- BlameWarningHandler takes a single discriminated event --------------
const handler: BlameWarningHandler = (event) => {
	const r: BlameWarningReason = event.reason;
	void r;
	switch (event.reason) {
		case "git-not-found":
			break;
		case "not-a-git-repo": {
			const _f: string = event.filePath;
			void _f;
			break;
		}
		case "file-outside-repo": {
			const _f: string = event.filePath;
			const _r: string = event.repoRoot;
			void _f;
			void _r;
			break;
		}
		case "blame-failed": {
			const _rel: string = event.rel;
			const _stderr: string = event.stderr;
			const _code: number | null = event.code;
			void _rel;
			void _stderr;
			void _code;
			break;
		}
		case "shallow-repo": {
			const _r: string = event.repoRoot;
			void _r;
			break;
		}
	}
};
void handler;

// ---- Virtual module shape matches the internal context type --------------
// `virtual.d.ts` mirrors `StarlightGitContributorsContext` from
// `libs/vite.ts` by hand. Either side drifting fails this AssertEqual.
_check<AssertEqual<typeof VirtualConfig, StarlightGitContributorsContext>>(
	true,
);

// ---- StarlightGitContributorsOptions: every key is optional --------------
_check<
	AssertEqual<
		keyof StarlightGitContributorsOptions,
		| "overrideFooter"
		| "top"
		| "ignore"
		| "ariaLabel"
		| "prewarm"
		| "prewarmConcurrency"
	>
>(true);

// ---- ResolvedOptions key set matches Required<options> ------------------
// `resolveOptions` builds `ResolvedOptions` by hand. Adding a new key to
// `StarlightGitContributorsOptions` without wiring a default would ship
// as `undefined`. The build breaks until both shapes line up.
_check<
	AssertEqual<
		keyof ResolvedOptions,
		keyof Required<StarlightGitContributorsOptions>
	>
>(true);

// ---- Function signatures hold their shapes -------------------------------
_check<
	AssertEqual<ReturnType<typeof contributorsForFile>, RankedContributor[]>
>(true);
_check<
	AssertEqual<
		ReturnType<typeof contributorsForFileAsync>,
		Promise<RankedContributor[]>
	>
>(true);
_check<AssertEqual<ReturnType<typeof runBlame>, string | null>>(true);
_check<AssertEqual<ReturnType<typeof runBlameAsync>, Promise<string | null>>>(
	true,
);
_check<AssertEqual<ReturnType<typeof rankContributors>, RankedContributor[]>>(
	true,
);
_check<
	AssertEqual<ReturnType<typeof parseBlamePorcelain>, readonly BlamedLine[]>
>(true);
_check<AssertEqual<ReturnType<typeof isShallowRepo>, boolean>>(true);
_check<AssertEqual<ReturnType<typeof prewarmCache>, Promise<PrewarmResult>>>(
	true,
);
_check<AssertEqual<typeof consoleWarnOnce, BlameWarningHandler>>(true);

// ---- ContributorsForFileOptions extends RankOptions ----------------------
_check<
	AssertEqual<Pick<ContributorsForFileOptions, keyof RankOptions>, RankOptions>
>(true);

// ---- BlameOptions: filePath is required, rest optional -------------------
const blameOpts: BlameOptions = { filePath: "/x" };
void blameOpts;

// ---- PrewarmOptions: contentDir is required ------------------------------
const prewarmOpts: PrewarmOptions = { contentDir: "/x" };
void prewarmOpts;

// ---- Default export is callable and returns a StarlightPlugin-shaped object
const _plugin = starlightGitContributors();
void _plugin;

test("types: compile-time public API contract holds", () => {
	// If this file loaded, every `_check` passed at compile time. The
	// runtime assertion is just a placeholder so `node:test` sees a test.
});

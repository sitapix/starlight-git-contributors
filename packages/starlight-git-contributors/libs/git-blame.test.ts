import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { BlameWarning } from "./git-blame.ts";
import {
	consoleWarnOnce,
	contributorsForFile,
	contributorsForFileAsync,
	parseBlamePorcelain,
	rankContributors,
	runBlame,
	runBlameAsync,
} from "./git-blame.ts";
import { expectDefined, gitTestSpawnOptions } from "./test-helpers.ts";

const sampleBlame = `\
abc1234 1 1 2
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary first commit
filename docs/intro.md
\tline one
abc1234 2 2
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary first commit
filename docs/intro.md
\tline two
def4567 3 3 1
author Bob
author-mail <bob@example.com>
author-time 1700000100
author-tz +0000
committer Bob
committer-mail <bob@example.com>
committer-time 1700000100
committer-tz +0000
summary second commit
filename docs/intro.md
\tline three
`;

test("parseBlamePorcelain attributes each blamed line to its author", () => {
	const lines = parseBlamePorcelain(sampleBlame);
	assert.equal(lines.length, 3);
	assert.deepEqual(
		lines.map((l) => l.author),
		["Alice", "Alice", "Bob"],
	);
	assert.deepEqual(
		lines.map((l) => l.email),
		["alice@example.com", "alice@example.com", "bob@example.com"],
	);
});

test("rankContributors counts lines per author, descending", () => {
	const lines = parseBlamePorcelain(sampleBlame);
	const ranked = rankContributors(lines);
	assert.deepEqual(ranked, [
		{ name: "Alice", email: "alice@example.com", lines: 2 },
		{ name: "Bob", email: "bob@example.com", lines: 1 },
	]);
});

test("rankContributors filters by ignore list (email or name)", () => {
	const lines = parseBlamePorcelain(sampleBlame);
	const ranked = rankContributors(lines, { ignore: ["bob@example.com"] });
	assert.deepEqual(ranked, [
		{ name: "Alice", email: "alice@example.com", lines: 2 },
	]);
});

test("rankContributors respects top limit", () => {
	const lines = parseBlamePorcelain(sampleBlame);
	const ranked = rankContributors(lines, { top: 1 });
	assert.equal(ranked.length, 1);
	assert.equal(expectDefined(ranked[0]).name, "Alice");
});

test("parseBlamePorcelain returns [] for empty input", () => {
	assert.deepEqual(parseBlamePorcelain(""), []);
});

test("parseBlamePorcelain preserves bot-noreply emails verbatim", () => {
	const blame = `\
deadbee 1 1 1
author dependabot[bot]
author-mail <49699333+dependabot[bot]@users.noreply.github.com>
author-time 1700000000
author-tz +0000
committer dependabot[bot]
committer-mail <noreply@github.com>
committer-time 1700000000
committer-tz +0000
summary bump
filename a.md
\tx
`;
	const lines = parseBlamePorcelain(blame);
	const head = expectDefined(lines[0]);
	assert.equal(head.author, "dependabot[bot]");
	assert.equal(head.email, "49699333+dependabot[bot]@users.noreply.github.com");
});

test('parseBlamePorcelain skips uncommitted lines (zero-SHA + "Not Committed Yet")', () => {
	const blame = `\
0000000000000000000000000000000000000000 1 1 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1700000200
author-tz +0000
committer Not Committed Yet
committer-mail <not.committed.yet>
committer-time 1700000200
committer-tz +0000
summary Version of docs/intro.md from docs/intro.md
filename docs/intro.md
\tunsaved line
abc1234 2 2 1
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary first commit
filename docs/intro.md
\tcommitted line
`;
	const lines = parseBlamePorcelain(blame);
	assert.equal(lines.length, 1);
	assert.equal(expectDefined(lines[0]).author, "Alice");
});

test('runBlame returns null + warns "not-a-git-repo" when file lives outside any repo', () => {
	const dir = mkdtempSync(join(tmpdir(), "sgc-test-"));
	try {
		const file = join(dir, "doc.md");
		writeFileSync(file, "hello\n");

		const warnings: BlameWarning[] = [];
		const out = runBlame({
			filePath: file,
			onWarning: (event) => warnings.push(event),
		});

		assert.equal(out, null);
		assert.equal(warnings.length, 1);
		const head = expectDefined(warnings[0]);
		assert.equal(head.reason, "not-a-git-repo");
		if (head.reason === "not-a-git-repo") {
			assert.equal(head.filePath, file);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runBlame never throws even when the file does not exist", () => {
	const warnings: BlameWarning[] = [];
	const out = runBlame({
		filePath: "/definitely/does/not/exist/at/all.md",
		onWarning: (event) => warnings.push(event),
	});
	assert.equal(out, null);
	assert.ok(warnings.length >= 1, "expected at least one warning");
});

/**
 * Build a throwaway git repo with two committed authors on a single
 * file. The remote URL is configurable so we can prove identical
 * blame output regardless of where the repo is hosted.
 */
function createMultiAuthorRepo(remoteUrl: string | null): {
	dir: string;
	filePath: string;
} {
	const dir = mkdtempSync(join(tmpdir(), "sgc-host-"));
	const git = (...args: string[]) =>
		spawnSync("git", args, gitTestSpawnOptions(dir));

	git("init", "-q", "-b", "main");
	git("config", "commit.gpgsign", "false");
	git("config", "tag.gpgsign", "false");

	git("config", "user.email", "alice@example.com");
	git("config", "user.name", "Alice");
	const filePath = join(dir, "page.md");
	writeFileSync(filePath, "alpha line\nbeta line\n");
	git("add", "page.md");
	git("commit", "-q", "-m", "alice initial");

	git("config", "user.email", "bob@example.com");
	git("config", "user.name", "Bob");
	writeFileSync(filePath, "alpha line\nbeta line\ngamma line\n");
	git("add", "page.md");
	git("commit", "-q", "-m", "bob adds gamma");

	if (remoteUrl) git("remote", "add", "origin", remoteUrl);

	return { dir, filePath };
}

const HOST_FIXTURES: ReadonlyArray<readonly [string, string | null]> = [
	["GitHub", "https://github.com/foo/bar.git"],
	["GitHub SSH", "git@github.com:foo/bar.git"],
	["GitLab SaaS", "https://gitlab.com/foo/bar.git"],
	["GitLab self-hosted", "https://gitlab.internal.example/foo/bar.git"],
	["Codeberg", "https://codeberg.org/foo/bar.git"],
	["Gitea self-hosted", "https://gitea.example.com/foo/bar.git"],
	["Sourcehut", "https://git.sr.ht/~foo/bar"],
	["Bitbucket", "https://bitbucket.org/foo/bar.git"],
	["no remote (offline)", null],
];

const EXPECTED = [
	{ name: "Alice", email: "alice@example.com", lines: 2 },
	{ name: "Bob", email: "bob@example.com", lines: 1 },
];

for (const [label, remote] of HOST_FIXTURES) {
	test(`contributorsForFile is identical regardless of remote: ${label}`, () => {
		const { dir, filePath } = createMultiAuthorRepo(remote);
		try {
			const result = contributorsForFile(filePath, { onWarning: () => {} });
			assert.deepEqual(
				result,
				EXPECTED,
				`mismatch for ${label} (${remote ?? "<none>"})`,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}

test("contributorsForFile picks up .mailmap aliases (host-agnostic)", () => {
	const dir = mkdtempSync(join(tmpdir(), "sgc-mailmap-"));
	try {
		const git = (...args: string[]) =>
			spawnSync("git", args, gitTestSpawnOptions(dir));

		git("init", "-q", "-b", "main");
		git("config", "commit.gpgsign", "false");
		git("config", "user.email", "alice-old@example.com");
		git("config", "user.name", "Alice");

		const filePath = join(dir, "page.md");
		writeFileSync(filePath, "one\n");
		git("add", "page.md");
		git("commit", "-q", "-m", "first commit under old email");

		git("config", "user.email", "alice@example.com");
		writeFileSync(filePath, "one\ntwo\n");
		git("add", "page.md");
		git("commit", "-q", "-m", "second commit under new email");

		writeFileSync(
			join(dir, ".mailmap"),
			"Alice <alice@example.com> <alice-old@example.com>\n",
		);

		const result = contributorsForFile(filePath, { onWarning: () => {} });
		assert.equal(result.length, 1, "mailmap should collapse to one identity");
		const head = expectDefined(result[0]);
		assert.equal(head.email, "alice@example.com");
		assert.equal(head.lines, 2);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("consoleWarnOnce: identical events log once across many calls", () => {
	const original = console.warn;
	const calls: string[] = [];
	console.warn = (msg?: unknown) => {
		calls.push(String(msg));
	};
	try {
		// First call fires; identical events on subsequent calls are silent.
		consoleWarnOnce({ reason: "not-a-git-repo", filePath: "/file-A" });
		consoleWarnOnce({ reason: "not-a-git-repo", filePath: "/file-A" });
		consoleWarnOnce({ reason: "not-a-git-repo", filePath: "/file-A" });
		// Different payload = different key = new line.
		consoleWarnOnce({ reason: "not-a-git-repo", filePath: "/file-B" });
		// Different reason, overlapping payload shape = new key.
		consoleWarnOnce({
			reason: "blame-failed",
			rel: "/file-A",
			stderr: "boom",
			code: 1,
		});

		assert.equal(
			calls.length,
			3,
			`expected 3 warnings, got ${calls.length}: ${calls.join(" | ")}`,
		);
		assert.ok(expectDefined(calls[0]).includes("/file-A"));
		assert.ok(expectDefined(calls[1]).includes("/file-B"));
		assert.ok(expectDefined(calls[2]).includes("git blame failed"));
	} finally {
		console.warn = original;
	}
});

test("runBlameAsync produces identical porcelain to runBlame on the same fixture", async () => {
	const { dir, filePath } = createMultiAuthorRepo(null);
	try {
		const sync = runBlame({ filePath, onWarning: () => {} });
		const async = await runBlameAsync({ filePath, onWarning: () => {} });
		assert.ok(sync, "sync runBlame returned null");
		assert.ok(async, "async runBlameAsync returned null");
		assert.equal(
			async,
			sync,
			"sync and async outputs must match byte-for-byte",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("contributorsForFileAsync returns the same ranking as the sync variant", async () => {
	const { dir, filePath } = createMultiAuthorRepo(null);
	try {
		const sync = contributorsForFile(filePath, { onWarning: () => {} });
		const async = await contributorsForFileAsync(filePath, {
			onWarning: () => {},
		});
		assert.deepEqual(async, sync);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runBlameAsync resolves to null without throwing when the file is outside any repo", async () => {
	const dir = mkdtempSync(join(tmpdir(), "sgc-async-"));
	try {
		const warnings: BlameWarning[] = [];
		const result = await runBlameAsync({
			filePath: join(dir, "doc.md"),
			onWarning: (event) => warnings.push(event),
		});
		assert.equal(result, null);
		assert.ok(warnings.some((e) => e.reason === "not-a-git-repo"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("rankContributors handles a Unicode-named author", () => {
	const blame = `\
abc1234 1 1 1
author 山田太郎
author-mail <yamada@example.jp>
author-time 1700000000
author-tz +0000
committer 山田太郎
committer-mail <yamada@example.jp>
committer-time 1700000000
committer-tz +0000
summary commit
filename docs/intro.md
\tline
`;
	const ranked = rankContributors(parseBlamePorcelain(blame));
	const head = expectDefined(ranked[0]);
	assert.equal(head.name, "山田太郎");
	assert.equal(head.lines, 1);
});

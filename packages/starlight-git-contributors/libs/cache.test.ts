import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { _resetCacheForTests, flushCache, getCached } from "./cache.ts";
import { contributorsForFile } from "./git-blame.ts";
import { expectDefined, gitTestSpawnOptions } from "./test-helpers.ts";

function createRepo(): { dir: string; filePath: string } {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "sgc-cache-")));
	const git = (...args: string[]) =>
		spawnSync("git", args, gitTestSpawnOptions(dir));

	git("init", "-q", "-b", "main");
	git("config", "commit.gpgsign", "false");
	git("config", "user.email", "alice@example.com");
	git("config", "user.name", "Alice");

	const filePath = join(dir, "page.md");
	writeFileSync(filePath, "alpha\nbeta\n");
	git("add", "page.md");
	git("commit", "-q", "-m", "init");

	return { dir, filePath };
}

function cacheFilePath(dir: string): string {
	return join(dir, ".git", "info", "starlight-git-contributors.v2.json");
}

function repoRelKey(repoRoot: string, absFile: string): string {
	return relative(repoRoot, absFile).split(/[\\/]/).join("/");
}

test("cache: cold miss writes cache on flush, warm hit reads from cache", () => {
	_resetCacheForTests();
	const { dir, filePath } = createRepo();
	try {
		const cold = contributorsForFile(filePath, {
			onWarning: () => {},
			cache: true,
		});
		assert.equal(cold.length, 1);
		assert.equal(expectDefined(cold[0]).email, "alice@example.com");

		// Writes are batched: cache file should not exist until flush.
		assert.equal(
			existsSync(cacheFilePath(dir)),
			false,
			"cache file should not exist before flush",
		);
		flushCache();
		assert.equal(
			existsSync(cacheFilePath(dir)),
			true,
			"cache file should exist after flush",
		);

		// Tamper with cache to a sentinel value, then verify next call reads it.
		const stored = JSON.parse(readFileSync(cacheFilePath(dir), "utf8"));
		const repoRoot = realpathSync(dir);
		const absFile = realpathSync(filePath);
		stored.entries[repoRelKey(repoRoot, absFile)] = [
			{ name: "Sentinel", email: "sentinel@example.com", lines: 99 },
		];
		writeFileSync(cacheFilePath(dir), JSON.stringify(stored));

		_resetCacheForTests(); // clear in-memory memo so disk gets re-read
		const warm = contributorsForFile(filePath, {
			onWarning: () => {},
			cache: true,
		});
		const head = expectDefined(warm[0]);
		assert.equal(head.name, "Sentinel", "should read sentinel from cache");
		assert.equal(head.lines, 99);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cache: HEAD move invalidates only files that changed in the diff", () => {
	_resetCacheForTests();
	const { dir, filePath } = createRepo();
	const git = (...args: string[]) =>
		spawnSync("git", args, gitTestSpawnOptions(dir));
	try {
		const otherPath = join(dir, "other.md");
		writeFileSync(otherPath, "x\n");
		git("add", "other.md");
		git("commit", "-q", "-m", "add other");

		// Populate cache for both files.
		contributorsForFile(filePath, { onWarning: () => {}, cache: true });
		contributorsForFile(otherPath, { onWarning: () => {}, cache: true });
		flushCache();

		// Touch only `otherPath` with a new commit.
		writeFileSync(otherPath, "x\ny\n");
		git("add", "other.md");
		git("commit", "-q", "-m", "touch other");

		_resetCacheForTests();
		const fileAbs = realpathSync(filePath);
		const otherAbs = realpathSync(otherPath);
		const repoRoot = realpathSync(dir);

		// First call after HEAD move loads the cache and applies invalidation.
		contributorsForFile(filePath, { onWarning: () => {}, cache: true });

		assert.notEqual(
			getCached(repoRoot, fileAbs),
			undefined,
			"unchanged file should still be in cache",
		);
		assert.equal(
			getCached(repoRoot, otherAbs),
			undefined,
			"changed file should be invalidated",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cache: mailmap change invalidates everything", () => {
	_resetCacheForTests();
	const { dir, filePath } = createRepo();
	try {
		contributorsForFile(filePath, { onWarning: () => {}, cache: true });
		flushCache();
		assert.equal(existsSync(cacheFilePath(dir)), true);

		writeFileSync(
			join(dir, ".mailmap"),
			"Alice <new@example.com> <alice@example.com>\n",
		);

		_resetCacheForTests();
		const fileAbs = realpathSync(filePath);
		const repoRoot = realpathSync(dir);

		// Load triggers invalidation when mailmap hash differs.
		contributorsForFile(filePath, { onWarning: () => {}, cache: true });

		// The new entry uses the mailmap-rewritten identity; the old cached
		// entry under the original email is gone.
		const fresh = expectDefined(
			getCached(repoRoot, fileAbs),
			"expected fresh cache entry",
		);
		assert.equal(
			expectDefined(fresh[0]).email,
			"new@example.com",
			"mailmap should have rewritten the email",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cache: corrupt JSON does not crash; falls back to blame", () => {
	_resetCacheForTests();
	const { dir, filePath } = createRepo();
	try {
		// Write garbage to the cache file before any read.
		writeFileSync(cacheFilePath(dir), "{ not valid json");

		const result = contributorsForFile(filePath, {
			onWarning: () => {},
			cache: true,
		});
		assert.equal(result.length, 1);
		assert.equal(expectDefined(result[0]).email, "alice@example.com");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cache: drifted entry shape is treated as a miss", () => {
	_resetCacheForTests();
	const { dir, filePath } = createRepo();
	try {
		// Prime the cache so the shell shape (schema/head/mailmap) is correct.
		contributorsForFile(filePath, { onWarning: () => {}, cache: true });
		flushCache();

		// Hand-edit the entry for `filePath` into a shape that passes the
		// old top-level guard but isn't a RankedContributor[].
		const stored = JSON.parse(readFileSync(cacheFilePath(dir), "utf8"));
		const repoRoot = realpathSync(dir);
		const absFile = realpathSync(filePath);
		stored.entries[repoRelKey(repoRoot, absFile)] = "not-an-array";
		writeFileSync(cacheFilePath(dir), JSON.stringify(stored));

		_resetCacheForTests();
		// A drifted entry should miss and rebuild from blame. If
		// `getCached` returned the string verbatim, downstream code would
		// crash iterating contributors.
		const fresh = contributorsForFile(filePath, {
			onWarning: () => {},
			cache: true,
		});
		assert.equal(fresh.length, 1);
		assert.equal(expectDefined(fresh[0]).email, "alice@example.com");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("cache: applyRankOptions filters and slices cached rankings", () => {
	_resetCacheForTests();
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "sgc-rank-")));
	const git = (...args: string[]) =>
		spawnSync("git", args, gitTestSpawnOptions(dir));
	try {
		git("init", "-q", "-b", "main");
		git("config", "commit.gpgsign", "false");

		const filePath = join(dir, "page.md");

		git("config", "user.email", "alice@example.com");
		git("config", "user.name", "Alice");
		writeFileSync(filePath, "a\nb\nc\n");
		git("add", "page.md");
		git("commit", "-q", "-m", "alice");

		git("config", "user.email", "bob@example.com");
		git("config", "user.name", "Bob");
		writeFileSync(filePath, "a\nb\nc\nd\nB\n");
		git("add", "page.md");
		git("commit", "-q", "-m", "bob");

		// First populate the unfiltered ranking in cache.
		const all = contributorsForFile(filePath, {
			onWarning: () => {},
			cache: true,
		});
		assert.equal(all.length, 2);

		// top: 1 slices to a single entry.
		const topOne = contributorsForFile(filePath, {
			onWarning: () => {},
			cache: true,
			top: 1,
		});
		assert.equal(topOne.length, 1);
		assert.equal(expectDefined(topOne[0]).name, "Alice");

		// ignore by email drops Bob.
		const noBob = contributorsForFile(filePath, {
			onWarning: () => {},
			cache: true,
			ignore: ["bob@example.com"],
		});
		assert.equal(noBob.length, 1);
		assert.equal(expectDefined(noBob[0]).name, "Alice");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

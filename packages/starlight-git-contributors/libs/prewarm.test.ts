import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { _resetCacheForTests, flushCache, getCached } from "./cache.ts";
import { prewarmCache } from "./prewarm.ts";
import { expectDefined, gitTestSpawnOptions } from "./test-helpers.ts";

function createDocsRepo(): { dir: string; files: string[] } {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "sgc-prewarm-")));
	const git = (...args: string[]) =>
		spawnSync("git", args, gitTestSpawnOptions(dir));

	git("init", "-q", "-b", "main");
	git("config", "commit.gpgsign", "false");
	git("config", "user.email", "alice@example.com");
	git("config", "user.name", "Alice");

	const contentDir = join(dir, "src", "content", "docs");
	mkdirSync(contentDir, { recursive: true });
	const files = [
		join(contentDir, "intro.md"),
		join(contentDir, "guide.mdx"),
		join(contentDir, "nested", "deep.md"),
	];
	mkdirSync(join(contentDir, "nested"), { recursive: true });
	for (const f of files) writeFileSync(f, "line one\nline two\n");

	git("add", "-A");
	git("commit", "-q", "-m", "seed content");
	return { dir, files };
}

test("prewarmCache: walks the content dir and populates cache for every match", async () => {
	_resetCacheForTests();
	const { dir, files } = createDocsRepo();
	try {
		const result = await prewarmCache({
			contentDir: join(dir, "src", "content"),
			onWarning: () => {},
		});
		assert.equal(result.scanned, files.length, "should scan every md/mdx file");
		assert.ok(result.durationMs >= 0);
		for (const f of files) {
			const hit = expectDefined(getCached(dir, f), `cache miss for ${f}`);
			assert.equal(expectDefined(hit[0]).email, "alice@example.com");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("prewarmCache: returns scanned=0 cleanly when contentDir does not exist", async () => {
	const result = await prewarmCache({
		contentDir: "/does/not/exist/anywhere",
		onWarning: () => {},
	});
	assert.equal(result.scanned, 0);
});

test("prewarmCache: skips dot-dirs and node_modules", async () => {
	_resetCacheForTests();
	const { dir } = createDocsRepo();
	try {
		const contentDir = join(dir, "src", "content");
		// Plant decoy md files in skipped dirs.
		mkdirSync(join(contentDir, ".cache"), { recursive: true });
		writeFileSync(join(contentDir, ".cache", "skipme.md"), "x\n");
		mkdirSync(join(contentDir, "node_modules"), { recursive: true });
		writeFileSync(join(contentDir, "node_modules", "skipme.md"), "x\n");

		const result = await prewarmCache({ contentDir, onWarning: () => {} });
		// Only the 3 real fixtures should be scanned.
		assert.equal(result.scanned, 3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("prewarmCache: subsequent flush prunes deleted files from disk cache", async () => {
	_resetCacheForTests();
	const { dir, files } = createDocsRepo();
	try {
		await prewarmCache({
			contentDir: join(dir, "src", "content"),
			onWarning: () => {},
		});
		// Delete one file from the working tree without committing.
		const deleted = expectDefined(files[0]);
		const survivor = expectDefined(files[1]);
		rmSync(deleted);
		flushCache();
		// The deleted file should no longer be in the in-memory cache after flush.
		assert.equal(
			getCached(dir, deleted),
			undefined,
			"deleted entry should be pruned",
		);
		// Other entries survive.
		assert.ok(getCached(dir, survivor), "unaffected entry should remain");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

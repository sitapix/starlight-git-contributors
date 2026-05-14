#!/usr/bin/env node
// Wires git to use `.githooks/` as its hooks dir. Runs from the root
// package.json `prepare` script, so it fires on `pnpm install` in a dev
// checkout. No-op when there's no `.git` dir (consumer installs of the
// published package never see this anyway).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync(".git")) process.exit(0);

try {
	execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
		stdio: "ignore",
	});
} catch {
	// Best-effort: a CI checkout with --no-checkout or a non-git context
	// shouldn't fail `pnpm install`.
}

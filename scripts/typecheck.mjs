#!/usr/bin/env node
// Runs tsc against the plugin's tsconfig and filters out
// framework-internal errors so we only fail on issues in our own code.
//
// Why this exists: Starlight ships its public API as `.ts` source rather
// than `.d.ts`. Astro/Vite handle the virtual modules and content
// collections those sources import; bare `tsc` does not. Pre-emptively
// stubbing every Starlight internal type would chase a moving target on
// each Starlight release. Filtering by path is stable.
//
// See https://github.com/withastro/starlight/pull/3572 for upstream
// intent to ship Starlight as JavaScript, which would let us drop this.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = resolve(root, "node_modules/.bin/tsc");
const project = "packages/starlight-git-contributors/tsconfig.json";

const proc = spawn(tsc, ["--noEmit", "-p", project], {
	cwd: root,
	stdio: ["ignore", "pipe", "pipe"],
});

let buffer = "";
proc.stdout.setEncoding("utf8");
proc.stderr.setEncoding("utf8");
proc.stdout.on("data", (chunk) => {
	buffer += chunk;
});
proc.stderr.on("data", (chunk) => {
	buffer += chunk;
});

proc.on("close", (code) => {
	const lines = buffer.split("\n");
	const errorLines = lines.filter((l) => / error TS\d+:/.test(l));
	const projectErrors = errorLines.filter(
		(l) => !l.startsWith("node_modules/") && !l.startsWith("../"),
	);

	if (projectErrors.length > 0) {
		console.error(projectErrors.join("\n"));
		process.exit(1);
	}

	const skipped = errorLines.length - projectErrors.length;
	const note =
		skipped > 0
			? `typecheck: clean (skipped ${skipped} framework-internal error${skipped === 1 ? "" : "s"} in node_modules)`
			: "typecheck: clean";
	console.log(note);

	// If tsc exited with a non-zero code but every error was framework-
	// internal, we still want to pass. The filter above is authoritative.
	process.exit(0);
	void code;
});

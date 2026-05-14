import { strict as assert } from "node:assert";
import { test } from "node:test";

import starlightGitContributors from "./index.ts";
import {
	buildIntegration,
	decideFooterAction,
} from "./libs/plugin-internals.ts";
import { translations } from "./translations.ts";

test("plugin: factory returns a StarlightPlugin with the expected shape", () => {
	const plugin = starlightGitContributors();
	assert.equal(plugin.name, "starlight-git-contributors");
	assert.ok(plugin.hooks, "hooks object is present");
	assert.equal(typeof plugin.hooks["i18n:setup"], "function");
	assert.equal(typeof plugin.hooks["config:setup"], "function");
});

test("translations: every supported locale ships an ariaLabel string", () => {
	for (const [locale, strings] of Object.entries(translations)) {
		assert.equal(
			typeof strings["starlightGitContributors.ariaLabel"],
			"string",
			`${locale} missing ariaLabel string`,
		);
	}
});

test("decideFooterAction: wires footer when override is on and slot is empty", () => {
	assert.deepEqual(decideFooterAction(true, undefined), {
		kind: "wire",
		footerPath: "starlight-git-contributors/overrides/Footer.astro",
	});
});

test("decideFooterAction: warns and skips when another Footer is configured", () => {
	const decision = decideFooterAction(true, "./user/Footer.astro");
	assert.equal(decision.kind, "skip-conflict");
	if (decision.kind === "skip-conflict") {
		assert.match(decision.warning, /Skipping Footer override/);
	}
});

test("decideFooterAction: overrideFooter: false skips silently", () => {
	assert.deepEqual(decideFooterAction(false, undefined), {
		kind: "skip-silent",
	});
});

test("buildIntegration: registers the documented integration name", () => {
	const integration = buildIntegration({
		overrideFooter: true,
		top: 5,
		ignore: [],
		ariaLabel: undefined,
		prewarm: true,
		prewarmConcurrency: 8,
	});
	assert.equal(integration.name, "starlight-git-contributors-integration");
	assert.ok(integration.hooks, "integration exposes hooks");
	assert.equal(typeof integration.hooks["astro:config:setup"], "function");
	assert.equal(typeof integration.hooks["astro:build:done"], "function");
});

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { expectDefined } from "./test-helpers.ts";
import {
	buildModuleSource,
	loadVirtualModule,
	resolveVirtualId,
} from "./vite.ts";

const VIRTUAL_ID = "virtual:starlight-git-contributors/config";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

function parseExportedJson(source: string): unknown {
	const json = source.replace(/^export default /, "").replace(/;$/, "");
	return JSON.parse(json);
}

function expectObject(value: unknown): object {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected a non-null object");
	}
	return value;
}

test("vite plugin: resolveId returns the resolved id only for the virtual module", () => {
	assert.equal(resolveVirtualId(VIRTUAL_ID), RESOLVED_ID);
	assert.equal(resolveVirtualId("some-other-module"), undefined);
	assert.equal(
		resolveVirtualId(RESOLVED_ID),
		undefined,
		"resolveId should not double-resolve",
	);
});

test("vite plugin: load returns a module exporting the serialized config", () => {
	const source = buildModuleSource({
		top: 5,
		ignore: ["bot@example.com"],
		ariaLabel: "Contributors",
	});
	const loaded = loadVirtualModule(RESOLVED_ID, source);
	assert.ok(loaded, "load should return a module source string");
	assert.match(loaded, /^export default /);

	assert.deepEqual(parseExportedJson(loaded), {
		top: 5,
		ignore: ["bot@example.com"],
		ariaLabel: "Contributors",
	});
});

test("vite plugin: load returns undefined for ids it does not own", () => {
	const source = buildModuleSource({
		top: 5,
		ignore: [],
		ariaLabel: undefined,
	});
	assert.equal(loadVirtualModule(VIRTUAL_ID, source), undefined);
	assert.equal(loadVirtualModule("some-other-module", source), undefined);
});

test("vite plugin: ariaLabel: undefined survives JSON serialization as missing key", () => {
	// JSON.stringify drops undefined values; consumers read `config.ariaLabel`
	// and get `undefined`, which is the documented behavior.
	const source = buildModuleSource({
		top: 3,
		ignore: [],
		ariaLabel: undefined,
	});
	const loaded = expectDefined(loadVirtualModule(RESOLVED_ID, source));
	const parsed = expectObject(parseExportedJson(loaded));
	assert.equal("ariaLabel" in parsed, false);
});

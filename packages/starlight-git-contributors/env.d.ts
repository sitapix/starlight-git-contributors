// Astro ambient declarations so `tsc` resolves the virtual modules
// (`astro:content`, `*.jsonc?raw`) that Starlight imports. Without this,
// transitively-pulled Starlight source fails to type-check under bare tsc.
/// <reference types="astro/client" />

// Starlight's own virtual-module declarations. Its source imports these
// at build time; tsc never runs that code path but walks the import
// graph for type resolution.
/// <reference types="@astrojs/starlight/virtual" />

/**
 * Local `App.Locals` shape covering the Starlight bits this plugin reads.
 *
 * We don't import Starlight's own `locals.d.ts` augmentation because doing
 * so transitively pulls `StarlightRouteData` (and downstream types like
 * `RenderResult` from `astro:content`) out of Starlight's `.ts` source,
 * which tsc can't resolve outside an Astro build. The plugin only reads
 * `starlightRoute.entry.filePath`, `starlightRoute.lang`, and `t`, so a
 * narrow local shape suffices. Consumers' Astro projects pick up the full
 * Starlight types automatically via Starlight's own pipeline; this file
 * only governs the plugin's own typecheck.
 */
declare namespace App {
	interface Locals {
		starlightRoute?: {
			entry?: { filePath?: string };
			lang?: string;
		};
		t: (key: string) => string;
	}
}

declare namespace StarlightApp {
	type StarlightGitContributorsI18n =
		typeof import("./translations").translations.en;
	interface I18n extends StarlightGitContributorsI18n {}
}

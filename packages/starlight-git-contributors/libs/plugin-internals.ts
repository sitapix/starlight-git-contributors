import { fileURLToPath } from "node:url";

import type { AstroConfig, AstroIntegration } from "astro";

import { flushCache } from "./cache.ts";
import { prewarmCache } from "./prewarm.ts";
import { vitePluginStarlightGitContributors } from "./vite.ts";

export interface ResolvedOptions {
	overrideFooter: boolean;
	top: number;
	ignore: readonly string[];
	ariaLabel: string | undefined;
	prewarm: boolean;
	prewarmConcurrency: number;
}

export const FOOTER_OVERRIDE_PATH =
	"starlight-git-contributors/overrides/Footer.astro";
export const INTEGRATION_NAME = "starlight-git-contributors-integration";
export const FOOTER_CONFLICT_WARNING =
	"Skipping Footer override: another `components.Footer` is already configured. " +
	"Import `PageContributors` into your own Footer, or pass " +
	"`starlightGitContributors({ overrideFooter: false })` to silence this warning.";

export type FooterDecision =
	| { kind: "wire"; footerPath: typeof FOOTER_OVERRIDE_PATH }
	| { kind: "skip-conflict"; warning: string }
	| { kind: "skip-silent" };

export function decideFooterAction(
	overrideFooter: boolean,
	existingFooter: string | undefined,
): FooterDecision {
	if (!overrideFooter) return { kind: "skip-silent" };
	if (existingFooter !== undefined) {
		return { kind: "skip-conflict", warning: FOOTER_CONFLICT_WARNING };
	}
	return { kind: "wire", footerPath: FOOTER_OVERRIDE_PATH };
}

export function buildIntegration(opts: ResolvedOptions): AstroIntegration {
	let resolvedAstroConfig: AstroConfig | null = null;
	return {
		name: INTEGRATION_NAME,
		hooks: {
			"astro:config:setup"({ updateConfig: updateAstroConfig }) {
				updateAstroConfig({
					vite: {
						plugins: [
							vitePluginStarlightGitContributors({
								top: opts.top,
								ignore: opts.ignore,
								ariaLabel: opts.ariaLabel,
							}),
						],
					},
				});
			},
			"astro:config:done"({ config: astroConfig }) {
				resolvedAstroConfig = astroConfig;
			},
			async "astro:build:start"({ logger: astroLogger }) {
				if (!opts.prewarm || resolvedAstroConfig === null) return;
				const contentDir = fileURLToPath(
					new URL("content/", resolvedAstroConfig.srcDir),
				);
				const { scanned, durationMs } = await prewarmCache({
					contentDir,
					concurrency: opts.prewarmConcurrency,
				});
				if (scanned > 0) {
					astroLogger.info(
						`prewarmed git blame for ${scanned} file(s) in ${durationMs}ms`,
					);
				}
			},
			"astro:build:done"() {
				flushCache();
			},
		},
	};
}

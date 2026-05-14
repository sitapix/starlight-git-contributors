import type { StarlightPlugin } from "@astrojs/starlight/types";

import {
	buildIntegration,
	decideFooterAction,
	type ResolvedOptions,
} from "./libs/plugin-internals.ts";
import { translations } from "./translations.ts";

export type {
	BlamedLine,
	BlameOptions,
	BlameWarning,
	BlameWarningHandler,
	BlameWarningReason,
	ContributorsForFileOptions,
	RankedContributor,
	RankOptions,
} from "./libs/git-blame.ts";
export {
	consoleWarnOnce,
	contributorsForFile,
	contributorsForFileAsync,
	isShallowRepo,
	parseBlamePorcelain,
	rankContributors,
	runBlame,
	runBlameAsync,
} from "./libs/git-blame.ts";
export type { PrewarmOptions, PrewarmResult } from "./libs/prewarm.ts";
export { prewarmCache } from "./libs/prewarm.ts";

export interface StarlightGitContributorsOptions {
	/**
	 * Register the plugin's `Footer.astro` on `components.Footer` (default
	 * `true`). That file renders Starlight's default footer and appends a
	 * credit line with `<PageContributors />`. Set to `false` when you ship
	 * your own `components.Footer` and want to include `<PageContributors />`
	 * manually.
	 */
	overrideFooter?: boolean;
	/** Max contributors to display per page. Default: `5`. */
	top?: number;
	/** Names or emails to exclude from rankings (case-insensitive). Default: `[]`. */
	ignore?: readonly string[];
	/**
	 * Accessible name applied to the contributor list region in the auto-wired
	 * Footer. Overrides the localized default from `i18n:setup`.
	 */
	ariaLabel?: string;
	/**
	 * Pre-blame all content files in parallel during `astro build`. Speeds
	 * up cold builds substantially on multi-page sites by replacing N
	 * serial `git blame` calls (one per page render) with N parallel ones
	 * during build start. Default: `true`. Skipped for `astro dev`.
	 */
	prewarm?: boolean;
	/** Max parallel `git blame` subprocesses during prewarm. Default: `8`. */
	prewarmConcurrency?: number;
}

function resolveOptions(
	options: StarlightGitContributorsOptions,
): ResolvedOptions {
	return {
		overrideFooter: options.overrideFooter ?? true,
		top: options.top ?? 5,
		ignore: options.ignore ?? [],
		ariaLabel: options.ariaLabel,
		prewarm: options.prewarm ?? true,
		prewarmConcurrency: options.prewarmConcurrency ?? 8,
	};
}

export default function starlightGitContributors(
	options: StarlightGitContributorsOptions = {},
): StarlightPlugin {
	const opts = resolveOptions(options);
	return {
		name: "starlight-git-contributors",
		hooks: {
			"i18n:setup"({ injectTranslations }) {
				injectTranslations(translations);
			},
			"config:setup"({ config, updateConfig, addIntegration, logger }) {
				addIntegration(buildIntegration(opts));
				const decision = decideFooterAction(
					opts.overrideFooter,
					config.components?.Footer,
				);
				if (decision.kind === "skip-silent") return;
				if (decision.kind === "skip-conflict") {
					logger.warn(decision.warning);
					return;
				}
				updateConfig({
					components: {
						...config.components,
						Footer: decision.footerPath,
					},
				});
			},
		},
	};
}

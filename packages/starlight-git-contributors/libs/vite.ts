import type { ViteUserConfig } from "astro";

type VitePlugin = NonNullable<ViteUserConfig["plugins"]>[number];

export interface StarlightGitContributorsContext {
	top: number;
	ignore: readonly string[];
	/**
	 * Omit to use the localized default from `i18n:setup`. Explicit
	 * `undefined` is accepted and treated the same as omitting the key:
	 * `JSON.stringify` drops the property, and `virtual.d.ts` mirrors this
	 * shape so consumers read `undefined` either way.
	 */
	ariaLabel?: string | undefined;
}

const VIRTUAL_ID = "virtual:starlight-git-contributors/config";
const RESOLVED_ID = `\0${VIRTUAL_ID}` as const;

export function resolveVirtualId(id: string): string | undefined {
	return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
}

export function buildModuleSource(
	context: StarlightGitContributorsContext,
): string {
	return `export default ${JSON.stringify(context)};`;
}

export function loadVirtualModule(
	id: string,
	moduleSource: string,
): string | undefined {
	return id === RESOLVED_ID ? moduleSource : undefined;
}

export function vitePluginStarlightGitContributors(
	context: StarlightGitContributorsContext,
): VitePlugin {
	const moduleSource = buildModuleSource(context);

	return {
		name: "vite-plugin-starlight-git-contributors",
		resolveId(id) {
			return resolveVirtualId(id);
		},
		load(id) {
			return loadVirtualModule(id, moduleSource);
		},
	};
}

/**
 * `en` defines the key set. Each other locale carries `satisfies
 * LocaleStrings`, so adding a key to `en` breaks the build for any
 * locale that doesn't follow.
 *
 * `env.d.ts` derives `StarlightApp.I18n` from `typeof translations.en`,
 * so `Astro.locals.t(...)` reads the same key set.
 */
const en = {
	"starlightGitContributors.ariaLabel": "Page contributors",
} as const;

type LocaleStrings = { readonly [K in keyof typeof en]: string };

export const translations = {
	en,
	fr: {
		"starlightGitContributors.ariaLabel": "Contributeurs de la page",
	} satisfies LocaleStrings,
	de: {
		"starlightGitContributors.ariaLabel": "Mitwirkende dieser Seite",
	} satisfies LocaleStrings,
	es: {
		"starlightGitContributors.ariaLabel": "Colaboradores de la página",
	} satisfies LocaleStrings,
	"pt-BR": {
		"starlightGitContributors.ariaLabel": "Contribuidores da página",
	} satisfies LocaleStrings,
	ja: {
		"starlightGitContributors.ariaLabel": "ページの貢献者",
	} satisfies LocaleStrings,
	"zh-CN": {
		"starlightGitContributors.ariaLabel": "此页面的贡献者",
	} satisfies LocaleStrings,
	ar: {
		"starlightGitContributors.ariaLabel": "المساهمون في الصفحة",
	} satisfies LocaleStrings,
} as const;

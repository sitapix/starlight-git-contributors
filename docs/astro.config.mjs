import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightGitContributors from "starlight-git-contributors";

export default defineConfig({
	// GitHub Pages serves the docs at https://sitapix.github.io/starlight-git-contributors/.
	// Without `base`, asset URLs and sidebar links break under the project subpath.
	site: "https://sitapix.github.io",
	base: "/starlight-git-contributors",
	integrations: [
		starlight({
			title: "starlight-git-contributors",
			description:
				"Per-page contributor lists from local git blame. Host-agnostic.",
			editLink: {
				baseUrl:
					"https://github.com/sitapix/starlight-git-contributors/edit/main/docs/",
			},
			plugins: [starlightGitContributors()],
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/sitapix/starlight-git-contributors",
				},
			],
			sidebar: [
				{ label: "Getting started", slug: "index" },
				{ label: "Demo", slug: "demo" },
				{ label: "Usage", slug: "usage" },
				{ label: "CI & shallow clones", slug: "ci" },
			],
			lastUpdated: true,
		}),
	],
});

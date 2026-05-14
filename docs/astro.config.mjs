import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightGitContributors from "starlight-git-contributors";

export default defineConfig({
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

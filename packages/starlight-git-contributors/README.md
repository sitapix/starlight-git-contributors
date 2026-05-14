# starlight-git-contributors

[![npm](https://img.shields.io/npm/v/starlight-git-contributors.svg)](https://www.npmjs.com/package/starlight-git-contributors) [![license](https://img.shields.io/npm/l/starlight-git-contributors.svg)](https://github.com/sitapix/starlight-git-contributors/blob/main/LICENSE)

A [Starlight](https://starlight.astro.build) plugin that lists each page's contributors from local `git blame`. Any host (GitHub, GitLab, Codeberg, Gitea, self-hosted, none). No tokens, no rate limits.

## Install

```sh
npm install starlight-git-contributors
```

```js
// astro.config.mjs
import starlight from '@astrojs/starlight';
import starlightGitContributors from 'starlight-git-contributors';

export default defineConfig({
  integrations: [starlight({ title: 'My Docs', plugins: [starlightGitContributors()] })],
});
```

The plugin auto-wires `components.Footer` to append a credit line under each page's pagination, ranked by surviving blame lines.

## Plugin options

| Option                | Type        | Default     | Description                                           |
| --------------------- | ----------- | ----------- | ----------------------------------------------------- |
| `overrideFooter`      | `boolean`   | `true`      | Auto-wire the Footer. `false` if you ship your own.   |
| `top`                 | `number`    | `5`         | Max contributors per page.                            |
| `ignore`              | `string[]`  | `[]`        | Names/emails to exclude (case-insensitive). For bots. |
| `ariaLabel`           | `string`    | localized   | Accessible name for the list region.                  |
| `prewarm`             | `boolean`   | `true`      | Pre-blame content in parallel at `astro build`.       |
| `prewarmConcurrency`  | `number`    | `8`         | Max parallel `git blame` processes during prewarm.    |

```js
starlightGitContributors({ top: 3, ignore: ['dependabot[bot]'] })
```

## Already shipping a custom Footer?

Pass `overrideFooter: false` and import the component yourself:

```astro
---
// src/overrides/Footer.astro
import Default from '@astrojs/starlight/components/Footer.astro';
import PageContributors from 'starlight-git-contributors/PageContributors.astro';
---
<Default><slot /></Default>
<p><PageContributors top={5} /></p>
```

Without `overrideFooter: false`, the plugin detects the conflict and logs one warning.

## `<PageContributors />` props

| Prop        | Type       | Default         | Description                                                              |
| ----------- | ---------- | --------------- | ------------------------------------------------------------------------ |
| `filePath`  | `string`   | Starlight route | Absolute path to blame. Defaults to the current page's source file.      |
| `top`       | `number`   | `5`             | Max contributors per page.                                               |
| `ignore`    | `string[]` | `[]`            | Names or emails to exclude.                                              |
| `icon`      | `boolean`  | `true`          | Show the person glyph. `false` to omit, or use the `icon` slot.          |
| `ariaLabel` | `string`   | `undefined`     | Accessible name. Localize yourself; the component does not translate it. |

Renders `<span class="sgc-root">` of comma-separated `<span class="sgc-name">` entries, joined via `Intl.ListFormat` for the page locale. Data-only; style with CSS. The icon switches between single/multi-person based on count; replace via slot:

```astro
<PageContributors top={5}><Icon slot="icon" name="user" /></PageContributors>
```

`ariaLabel` ships translations for `en`, `fr`, `de`, `es`, `pt-BR`, `ja`, `zh-CN`, `ar`. Override or add via `starlightGitContributors.ariaLabel` in your i18n collection.

## CI

Most CI runners shallow-clone, which under-reports authors. One warning fires when detected. Fix:

- **GitHub Actions:** `with: { fetch-depth: 0 }` on `actions/checkout`
- **GitLab CI:** `GIT_DEPTH: 0`
- **Bitbucket Pipelines:** `clone: depth: full`

## Mailmap

If contributors commit under multiple emails or names, add `.mailmap` to the repo root:

```
Jane Doe <jane@example.com> <jane@oldcompany.com>
```

Git resolves these to the canonical identity.

## Programmatic API

```ts
import { contributorsForFile, isShallowRepo, type BlameWarning } from 'starlight-git-contributors';

const top = contributorsForFile('/abs/path/to/file.md', { top: 5 });
// → [{ name, email, lines }, …]
```

Also exported: `contributorsForFileAsync`, `runBlame`/`runBlameAsync`, `prewarmCache`, `parseBlamePorcelain`, `rankContributors`, `consoleWarnOnce`. `BlameWarning` is a discriminated union; switch on `event.reason` for per-case fields.

## Failure modes

`git` can fail (no repo, untracked file, missing binary). The component renders nothing; one `console.warn` per unique problem per build.

| `BlameWarning.reason` | When                                              |
| --------------------- | ------------------------------------------------- |
| `git-not-found`       | `git` not on `$PATH`                              |
| `not-a-git-repo`      | File outside any git working tree                 |
| `file-outside-repo`   | Explicit `filePath` resolves above the repo root  |
| `blame-failed`        | `git blame` returned non-zero (stderr included)   |
| `shallow-repo`        | Repo is a shallow clone                           |

## How it works

```sh
git blame --line-porcelain --follow -w -- <relative-path>
```

Surviving lines per author, top N. `--follow` tracks renames; `-w` ignores whitespace; uncommitted lines don't count.

During `astro build`, the plugin blames every content file in parallel (8 workers) and caches the result under `.git/info/`. Rebuilds skip unchanged files. `.mailmap` changes drop the cache. `astro dev` blames on demand.

## Requirements

`git` on `$PATH` · Node ≥ 22.12.0 · Astro ≥ 6.0.0 · Starlight ≥ 0.39.0

## License

[MIT](https://github.com/sitapix/starlight-git-contributors/blob/main/LICENSE).

---
title: Usage
description: Plugin options, component props, programmatic API, failure modes.
---

## Plugin options

The plugin's credit line reads these. They have no effect when `overrideFooter: false`.

| Option           | Type        | Default     | Description                                                                                                |
| ---------------- | ----------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `overrideFooter` | `boolean`   | `true`      | Register the plugin's `Footer.astro` (default + appended credit line). Set `false` when you ship your own. |
| `top`            | `number`    | `5`         | Max contributors per page, ordered by surviving lines descending.                                          |
| `ignore`         | `string[]`  | `[]`        | Names or emails to exclude (case-insensitive). Useful for bots.                                            |
| `ariaLabel`      | `string`    | `undefined` | Accessible name for the list region. Defaults to a localized i18n string.                                  |

```js
starlight({
  plugins: [
    starlightGitContributors({
      top: 3,
      ignore: ['dependabot[bot]', 'github-actions[bot]'],
    }),
  ],
});
```

## `<PageContributors />` props

For users writing their own Footer.

| Prop        | Type       | Default         | Description                                                                                |
| ----------- | ---------- | --------------- | ------------------------------------------------------------------------------------------ |
| `filePath`  | `string`   | Starlight route | Absolute path to blame. Defaults to `Astro.locals.starlightRoute.entry.filePath`.          |
| `top`       | `number`   | `5`             | Max contributors per page, ordered by surviving lines descending.                          |
| `ignore`    | `string[]` | `[]`            | Names or emails to exclude (case-insensitive).                                             |
| `icon`      | `boolean`  | `true`          | Show the leading person glyph. Pass `false` to omit, or use the `icon` slot to override.   |
| `ariaLabel` | `string`   | `undefined`     | Accessible name for the list region. Pass a localized string.                              |

The component renders an inline `<span class="sgc-root">` of comma-separated names, ordered by surviving lines (most first). The icon switches between single-person and multi-people based on the count.

Names come from `git blame`. The component joins them with `Intl.ListFormat` keyed off `Astro.locals.starlightRoute.lang` (default `'en'`). With placeholder names `A`, `B`, `C`: `A, B, and C` (en), `A, B und C` (de), `A、B和C` (zh), `A、B、C` (ja), `A وB وC` (ar). The icon uses `margin-inline-end` so it sits on the correct side in RTL pages.

### Custom icon

Set `overrideFooter: false` and pass any markup into the `icon` slot in your own Footer:

```astro
<PageContributors top={5}>
  <Icon slot="icon" name="user" />
</PageContributors>
```

Or omit the icon entirely with `icon={false}`.

## Programmatic API

```ts
import {
  contributorsForFile,
  isShallowRepo,
  type BlameWarningReason,
} from 'starlight-git-contributors';

const top = contributorsForFile('/abs/path/to/file.md', {
  top: 5,
  ignore: ['dependabot[bot]'],
});

contributorsForFile(filePath, {
  onWarning: (reason: BlameWarningReason, detail) =>
    myLogger.warn({ reason, detail }),
});

if (isShallowRepo(process.cwd())) {
  console.warn('Shallow clone, contributors may be incomplete.');
}
```

## Failure modes

`git` can fail for a page (no repo, untracked file, missing binary). The component renders nothing and emits one `console.warn` per unique reason. Builds keep running.

| Reason (`BlameWarningReason`) | When it fires                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `git-not-found`               | `git` is not on `$PATH` (e.g. a CI image without it)                                |
| `not-a-git-repo`              | The page's file is outside any git working tree                                     |
| `file-outside-repo`           | An explicit `filePath` prop resolves above the repo root                            |
| `blame-failed`                | `git blame` returned non-zero (binary file, internal error)                         |
| `shallow-repo`                | Repo is a shallow clone, history truncated                                          |

Warnings deduplicate at module scope. One unique problem fires one log line across the whole build.

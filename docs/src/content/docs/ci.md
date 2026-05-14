---
title: CI & shallow clones
description: Fix under-reported contributors on GitHub Actions, GitLab CI, and Bitbucket Pipelines.
---

GitHub Actions, GitLab CI, and Bitbucket Pipelines shallow-clone by default, which makes `git blame` under-report authors. Fix it in your CI config:

- **GitHub Actions:** `with: { fetch-depth: 0 }` on `actions/checkout`.
- **GitLab CI:** set `GIT_DEPTH: 0` in the job or globally.
- **Bitbucket Pipelines:** `clone: depth: full` in the pipeline definition.

The plugin logs one build warning when it detects a shallow clone, so the cause shows up in your CI output.

## Mailmap

Git reads `.mailmap` from the repo root. If a contributor commits under multiple emails or display names, add a `.mailmap` file:

```
Jane Doe <jane@example.com> <jane@oldcompany.com>
Jane Doe <jane@example.com> <jane@github>
```

Git applies these aliases automatically when it reads blame data.

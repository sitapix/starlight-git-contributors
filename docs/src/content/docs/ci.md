---
title: CI & shallow clones
description: Fix under-reported contributors on GitHub Actions, GitLab CI, and Bitbucket Pipelines.
---

GitHub Actions, GitLab CI, and Bitbucket Pipelines shallow-clone by default, which makes `git blame` under-report authors. Fix it in your CI config:

- **GitHub Actions:** `with: { fetch-depth: 0 }` on `actions/checkout`.
- **GitLab CI:** set `GIT_DEPTH: 0` in the job or globally.
- **Bitbucket Pipelines:** `clone: depth: full` in the pipeline definition.

A shallow repo emits one build warning so the cause shows up in your CI logs.

## Mailmap

Git reads `.mailmap` from the repo root. If a contributor commits under multiple emails or display names, add a `.mailmap` file:

```
Jane Doe <jane@example.com> <jane@oldcompany.com>
Jane Doe <jane@example.com> <jane@github>
```

Aliases collapse to the canonical identity. No config required.

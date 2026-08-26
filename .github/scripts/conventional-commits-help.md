Titles must look like `type(optional-scope): description`.

| Type | Use for |
| --- | --- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `refactor` | A change that neither fixes a bug nor adds a feature |
| `perf` | A performance improvement |
| `test` | Adding or correcting tests |
| `build` | Build system or dependencies |
| `ci` | CI configuration |
| `chore` | Anything else that touches no source |
| `style` | Formatting only, no behaviour change |
| `revert` | Reverts a previous commit |

Add `!` before the colon to mark a breaking change: `feat(api)!: drop v0 endpoints`

Scopes are lowercase, for example `feat(import): ...` or `fix(api/dives): ...`

Keep the description to 72 characters or fewer, and do not end it with a period.

**Examples**

```
feat(import): add UDDF 3.x parser
fix(api): reject dive numbers below zero
docs: add implementation plan
chore(deps): bump prisma to 6.2.0
```

Edit the pull request title to fix this — the check re-runs automatically.

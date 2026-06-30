# Contributing

## Development Flow

1. Create a branch for each focused change.
2. Keep planning/doc changes separate from implementation changes when practical.
3. Run local checks before opening a pull request.
4. Open a pull request against `main`.
5. Use the pull request description to call out review focus and follow-up work.

## Local Checks

```bash
pnpm check
```

Current checks validate repo hygiene and Markdown links. More checks will be added as `api`, `web`, `admin`, `packages`, `infra`, and `app` are scaffolded.

## Commit Guidance

Use clear, imperative commit messages:

```text
Add planning documentation
Set up repo basics
Scaffold API workspace
```

Prefer small, reviewable commits when a change spans multiple areas.

## Documentation

Update docs when a change affects:

- Product scope.
- Data model.
- API contracts.
- Infrastructure or provider decisions.
- Security or auth behavior.
- Build, deploy, or local development workflows.

## Generated And Secret Files

Do not commit:

- `.env` files.
- Local credentials.
- Terraform state.
- Build output.
- OS/editor noise.

Lock files should generally be committed.

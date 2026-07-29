# Contributing

## Branches

- `main` is the integration branch for production-ready work.
- Use short topic branches such as `feature/msdp-fixtures`, `fix/proxy-close`, or `docs/onboarding`.

## Commit Style

Prefer conventional commit prefixes:

- `feat:` for product behavior
- `fix:` for defects
- `docs:` for documentation
- `refactor:` for behavior-preserving code changes
- `test:` for test coverage

## Local Checks

Run these before opening a pull request:

```bash
npm run lint
npm run build
npm test
```

The committed test script runs the focused Node test suite. If you add broader or slower tests, document their commands in `package.json`, `README.md`, and `docs/development.md`.

## Pull Requests

1. Keep each pull request focused on one objective.
2. Update documentation when behavior, commands, configuration, or architecture changes.
3. Include manual verification notes for connect, terminal output, command input, disconnect, and reconnect when affected.
4. Do not copy code from GPL-licensed reference repositories unless the project explicitly changes license strategy.

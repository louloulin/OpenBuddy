## Description

<!-- What does this PR do? Why? -->

## Related Issue

<!-- Link the issue this PR fixes or relates to. -->
<!-- Use "Fixes #123" to auto-close on merge. -->

Fixes #

## Type of Change

<!-- Pick one. Remove the others. -->

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to change)
- [ ] 📖 Documentation update
- [ ] 🧪 Test addition or improvement
- [ ] 🎨 UI / styling change
- [ ] ⚡ Performance improvement
- [ ] 🔏 Build / CI change

## Checklist

<!-- Reviewers will appreciate thorough checks. -->

### Code

- [ ] My code follows the project's style guidelines (see [`CONTRIBUTING.md`](../CONTRIBUTING.md))
- [ ] I have added tests that prove my fix / feature works
- [ ] New and existing unit tests pass locally (`pnpm workspace:test`)
- [ ] Type-check passes (`pnpm workspace:typecheck`)
- [ ] No new TypeScript `any` introduced in `packages/` or `electron/`

### Documentation

- [ ] I have updated the relevant docs
- [ ] I have added a `CHANGELOG.md` entry under the next version
- [ ] If I added a new IPC channel, `pnpm test:electron:ipc-surface` was re-run
- [ ] If I added a new `@openbuddy/*` package, it was added to `docs/openbuddy-capability-matrix.md`

### Quality

- [ ] I have read [`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md)
- [ ] My commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

## Screenshots / Recordings

<!-- If UI changes, add before/after. Drag images in or paste Markdown. -->

## Additional Context

<!-- Anything else reviewers should know: deprecations, migrations, follow-up work, etc. -->

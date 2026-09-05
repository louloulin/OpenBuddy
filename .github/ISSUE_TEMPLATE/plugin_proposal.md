---
name: 🧩 Plugin / Capability Proposal
about: Propose a new Cordis capability package
title: '[PLUGIN] '
labels: 'plugin'
assignees: ''
---

## Proposed Package Name

<!-- e.g. @openbuddy/capability-screenshot -->

## Category

<!-- Pick one. -->
- [ ] `capability/` — user-facing capability
- [ ] `team/` — multi-agent
- [ ] `auth/` — authentication
- [ ] `payment/` — payment integration
- [ ] `collaboration/` — cross-agent protocol
- [ ] `ui/` — UI primitive
- [ ] Other: <!-- specify -->

## Purpose

<!-- What does this capability do? -->

## User Stories

<!-- "As a [user], I want [feature], so that [benefit]." -->

## API Surface

```typescript
// Sketch of the public API — methods, events, config schema
```

## Dependencies

<!-- What other @openbuddy/* packages does it depend on? -->

## Willing to Implement?

- [ ] I will implement this myself
- [ ] I need a mentor / pairing partner
- [ ] I'm only proposing — others should implement

## Prior Art

<!-- Any existing projects or plugins that inspired this? -->
FEAT_EOF

cat > /Users/louloulin/appx/OpenBuddy/.github/ISSUE_TEMPLATE/config.yml << 'CONFIG_EOF'
blank_issues_enabled: false
contact_links:
  - name: 💬 Community Discussion
    url: https://github.com/louloulin/OpenBuddy/discussions
    about: Ask questions, share ideas, or get help
  - name: 🔏 Security Disclosure
    url: https://github.com/louloulin/OpenBuddy/security/advisories/new
    about: Report security vulnerabilities privately
  - name: 📖 Contributing Guide
    url: https://github.com/louloulin/OpenBuddy/blob/main/CONTRIBUTING.md
    about: Read this before opening an issue or PR
  - name: 📚 Documentation
    url: https://github.com/louloulin/OpenBuddy/blob/main/docs/README.md
    about: Browse the full documentation index
CONFIG_EOF

cat > /Users/louloulin/appx/OpenBuddy/.github/PULL_REQUEST_TEMPLATE.md << 'PR_EOF'
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

- [ ] My code follows the project's style guidelines (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md))
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

- [ ] I have read [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md)
- [ ] My commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

## Screenshots / Recordings

<!-- If UI changes, add before/after. Drag images in or paste Markdown. -->

## Additional Context

<!-- Anything else reviewers should know: deprecations, migrations, follow-up work, etc. -->
PR_EOF

echo "Templates written"
ls /Users/louloulin/appx/OpenBuddy/.github/ISSUE_TEMPLATE/
ls /Users/louloulin/appx/OpenBuddy/.github/PULL_REQUEST_TEMPLATE/
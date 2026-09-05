# Release Process

> 🌐 **Language / 语言:** [English](#english) · [简体中文](#简体中文)

How OpenBuddy ships a release — from cutting a branch to publishing the GitHub Release. For the CI matrix, see [`release-ci.md`](release-ci.md).

---

<a id="english"></a>
## 🇬🇧 English

### Cadence

- **Stable releases**: every 2–4 weeks.
- **Patch releases**: as needed for critical bugs.
- **Security releases**: within 48h of disclosure for critical issues.

### Versioning

OpenBuddy follows [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** (v**X**.0.0): breaking IPC channels, removed capability packages, license change.
- **MINOR** (v0.**X**.0): new capabilities, new packages, non-breaking changes.
- **PATCH** (v0.0.**X**): bug fixes, perf improvements, doc updates.

Pre-1.0: even minor bumps may include breaking changes. We document them loudly.

### Release types

| Type | Trigger | Example | Promotion |
|---|---|---|---|
| **Stable** | Manual `workflow_dispatch` | `v0.15.0` | Internal users for 3+ days → public |
| **RC** | Manual `workflow_dispatch` | `v0.16.0-rc.1` | Internal users + power users |
| **Patch** | Manual `workflow_dispatch` | `v0.15.1` | Fast-track after CI green |
| **Security** | Off-cycle | `v0.15.2-sec.1` | Private disclosure + advisory |

### Step-by-step

#### 1. Cut a release branch (for major/minor)

```bash
git fetch upstream
git checkout master
git pull upstream master
git checkout -b release/v0.16.0
git push upstream release/v0.16.0
```

For patches, work directly on `master`.

#### 2. Bump versions

Edit version numbers in:

- `package.json` (root)
- `packages/*/*/package.json` (each package)
- `apps/*/package.json`
- `electron-builder.yml` (if relevant)

```bash
# Use moon's bump task (planned)
pnpm moon:version v0.16.0
```

For now, do it manually and use `pnpm -r --filter @openbuddy/* version X.Y.Z`.

#### 3. Update CHANGELOG.md

Add a new section at the top of [`CHANGELOG.md`](../CHANGELOG.md) following the existing format. The auto-extraction in `.github/workflows/release.yml` will use this for the GitHub Release body.

Sections to include:

- 🎯 Headline (1 line)
- ✨ New features
- 🐛 Bug fixes
- ⚡ Performance
- 🔏 Security
- 📚 Documentation
- 💥 Breaking changes (if any)
- ⚠️ Known issues (if any)
- 🙏 Credits

#### 4. Build, test, sign

```bash
# Local sanity check
pnpm workspace:typecheck
pnpm workspace:test
pnpm test:electron:smoke
pnpm test:closed-loop

# Build all platforms locally (optional)
pnpm electron:build:all
```

#### 5. Trigger the release workflow

```bash
# Via gh CLI
gh workflow run release.yml \
  -f tag=v0.16.0

# Or via GitHub UI
# Actions → Release → Run workflow → Tag: v0.16.0
```

The CI will:

1. Run typecheck + test on all 32 projects.
2. Build Windows NSIS + MSI.
3. Build macOS DMG (signed + notarized).
4. Build Linux AppImage + .deb.
5. Publish a **draft** GitHub Release with auto-extracted notes.

#### 6. Test the release candidate

```bash
# Download the artifacts from the draft release
gh release download --pattern "*.dmg" --pattern "*.exe" --pattern "*.AppImage"

# Verify checksums
shasum -a 256 -c checksums.txt
```

Install on each platform and:

- [ ] First-launch experience works
- [ ] Existing sessions migrate
- [ ] New provider (BYOK) connects
- [ ] Plan mode + rewind work
- [ ] Sub-agents spawn
- [ ] MCP connector connects
- [ ] Auto-updater detects the new version
- [ ] Audit log writes correctly

#### 7. Publish

Once verified:

1. Open the draft release on GitHub.
2. Edit the body to add any final notes.
3. Click **Publish release**.

The auto-updater (`electron-updater`) will push notifications to existing installs within 30 min.

#### 8. Post-release

- [ ] Update the GitHub Releases sidebar with a one-liner.
- [ ] Post to Discord `#announcements` channel.
- [ ] Post to Mastodon / X.
- [ ] Update the OpenBuddy website download page.
- [ ] Add to the What's New dialog in OpenBuddy.
- [ ] Close the milestone on GitHub.
- [ ] Send `announce@openbuddy.dev` digest.

### Hotfix / patch flow

For urgent fixes:

```bash
# 1. Branch from the release tag
git checkout -b hotfix/v0.15.1 v0.15.0

# 2. Cherry-pick the fix
git cherry-pick <commit-sha>

# 3. Push and trigger patch workflow
git push upstream hotfix/v0.15.1
gh workflow run release.yml -f tag=v0.15.1
```

Patch releases don't need a release branch — they can go straight to `master` and be tagged.

### Security release flow

For critical security issues:

1. **Coordinate** with `@louloulin/security` privately.
2. **Prepare** the fix on a private branch.
3. **Pre-notify** integrators (Casdoor, NewAPI, etc.) under embargo.
4. **CVE** assignment (if applicable).
5. **Ship** the fix with `v0.15.2-sec.1` tag.
6. **Disclose** with GitHub Security Advisory + CVE record.
7. **Backport** to supported releases (see [`SECURITY.md`](../SECURITY.md)).

### Tools

| Tool | Purpose |
|---|---|
| `gh workflow run release.yml` | Trigger release workflow |
| `gh release download` | Download artifacts |
| `gh release edit` | Edit release body |
| `pnpm moon:version` | Bump versions (planned) |
| `bash scripts/build-release-bundle.sh` | Build release artifacts + extract CHANGELOG |

### Release checklist (quick)

```
[ ] Version bumped in package.json × N
[ ] CHANGELOG.md updated with new section
[ ] Local typecheck + tests + smoke pass
[ ] gh workflow run release.yml -f tag=vX.Y.Z
[ ] CI green on all 3 platforms
[ ] Draft release auto-created on GitHub
[ ] RC tested on Win + macOS + Linux
[ ] GitHub release published
[ ] Auto-updater pushes notifications
[ ] Announcements posted (Discord / Mastodon)
[ ] Milestone closed
[ ] announce@ mailing list sent
```

---

<a id="简体中文"></a>
## 🇨🇳 简体中文

### 节奏

- **稳定版**:每 2–4 周
- **补丁版**:按需,用于关键 bug
- **安全版**:关键问题披露后 48h 内

### 版本号

OpenBuddy 遵循[语义化版本 2.0.0](https://semver.org/):

- **MAJOR**(v**X**.0.0):破坏性 IPC 通道、删除能力包、许可证变更
- **MINOR**(v0.**X**.0):新能力、新包、非破坏性变更
- **PATCH**(v0.0.**X**):bug 修复、性能改进、文档更新

1.0 之前:即使是次版本号也可能有破坏性变更。我们会大声声明。

### 发布类型

(同英文表格)

### 分步发布

#### 1. 拉发布分支(用于 major/minor)

(代码同英文版)

#### 2. 提升版本号

(代码同英文版)

#### 3. 更新 CHANGELOG.md

在 [`CHANGELOG.md`](../CHANGELOG.md) 顶部加新段,遵循现有格式。`.github/workflows/release.yml` 中的自动抽取会用它作 GitHub Release 正文。

(章节清单同英文)

#### 4. 构建、测试、签名

(代码同英文版)

#### 5. 触发发布 workflow

(代码同英文版)

#### 6. 测试候选发布

(代码同英文版)

#### 7. 发布

验证通过后:

(步骤同英文)

#### 8. 发布后

(清单同英文)

### 紧急修复 / 补丁流程

(代码同英文)

### 安全发布流程

(同英文)

### 工具

(同英文表格)

### 发布清单(快速)

(同英文清单)

---

<div align="center">

**Ship small, ship often. / 小步快跑。**

</div>

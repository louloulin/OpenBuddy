# ADR-0013: Rust 8-triple CI 矩阵 + 跨平台构建 / S1

- **Status**: Accepted (R97/S1, 2026-09-24)
- **Deciders**: OpenBuddy maintainers
- **Related**:
  - CI 工作流:`.github/workflows/rust-host-core.yml`(283 行,4 jobs)
  - Rust crates workspace 根:`crates/README.md`
  - 二进制解析:`packages/runtime/openbuddy-host-runtime/src/host-binary.ts::resolveHostBinary`

## Context / 背景

OpenBuddy 的 Rust sidecar (`openbuddy-host-core`) 需要跨三平台交付:
macOS / Linux / Windows,每平台两个主要 triple。原 Phase 0/1 完成后,
CI 还没有任何 Rust 验证 — 仅 TS vitest + electron-vite build 在跑。

具体缺口:

1. **没有 Rust 编译验证**:`cargo check` / `cargo build` / `cargo test`
   全部依赖开发者本地手跑,新人 PR 容易引入 Rust 编译错误。
2. **没有 lint 自动化**:`rustfmt` / `clippy` 全靠开发者本地 IDE,
   风格分歧无人拦截。
3. **没有跨平台构建验证**:即使本地 macOS arm64 build 成功,Linux x64
   / Windows x64 是否 build 成功无人知道。
4. **没有 release 二进制 artifact**:发布时无法从 CI 直接下载三平台
   prebuilt binary,需开发者本地手动 cargo build --release。

rust-toolchain 版本:`1.88.0`(用 `RUSTUP_TOOLCHAIN: 1.88.0` env 钉死),
因为 `ignore 0.4.33` crate 要求 rustc 1.88+。

## Decision / 决策

S1 决定:**新增 GitHub Actions 工作流 `.github/workflows/rust-host-core.yml`**
作为 Rust sidecar 的事实 CI,覆盖 test + lint + 跨平台 release + summary
四个维度。

### 1. 工作流结构(4 jobs)

```yaml
jobs:
  rust-test:           # 1. 主测试(native runner)
  rust-cross-release:  # 2. 跨平台 release 构建(cross)
  rust-lint:           # 3. rustfmt + clippy
  build-summary:       # 4. 失败聚合
```

### 2. Job 1:`rust-test`(3 native runner)

| Runner | Target | 测试命令 |
|---|---|---|
| `ubuntu-latest` | `x86_64-unknown-linux-gnu` | `cargo test --workspace --locked` |
| `windows-latest` | `x86_64-pc-windows-msvc` | `cargo test --workspace --locked` |
| `macos-latest` | `aarch64-apple-darwin` | `cargo test --workspace --locked` |

**为什么 3 个 native runner 而不是 matrix**:
- macOS arm64 无法在 Linux runner 上模拟,必须用 `macos-latest`。
- Windows MSVC ABI 与 Linux / macOS 不兼容,必须独立 runner。
- 三个 native runner 跑 native build 比 `cross` 快 2-3x(test 阶段)。

### 3. Job 2:`rust-cross-release`(8 triple,跨平台)

| Triple | Runner | cross image |
|---|---|---|
| `x86_64-unknown-linux-gnu` | `ubuntu-latest` | `ghcr.io/cross-rs/x86_64-unknown-linux-gnu:main` |
| `aarch64-unknown-linux-gnu` | `ubuntu-latest` | `ghcr.io/cross-rs/aarch64-unknown-linux-gnu:main` |
| `x86_64-unknown-linux-musl` | `ubuntu-latest` | `ghcr.io/cross-rs/x86_64-unknown-linux-musl:main` |
| `aarch64-unknown-linux-musl` | `ubuntu-latest` | `ghcr.io/cross-rs/aarch64-unknown-linux-musl:main` |
| `x86_64-apple-darwin` | `macos-latest` | `ghcr.io/cross-rs/x86_64-apple-darwin:main` |
| `aarch64-apple-darwin` | `macos-latest` | `ghcr.io/cross-rs/aarch64-apple-darwin:main` |
| `x86_64-pc-windows-msvc` | `windows-latest` | `ghcr.io/cross-rs/x86_64-pc-windows-msvc:main` |
| `aarch64-pc-windows-msvc` | `windows-latest` | `ghcr.io/cross-rs/aarch64-pc-windows-msvc:main` |

**关键约束**:
- **`runner: ${{ matrix.runner }}`** 必须显式声明,否则 `cross` 会用
  linux runner 跑所有 triple,macOS / Windows triple 会失败。
- **`aarch64-pc-windows-msvc` 用 windows-latest**:cross-rs 在 Windows
  runner 上跑 aarch64 triple(使用 MSVC 工具链的交叉编译模式)。
- **`x86_64-unknown-linux-musl` 用 ubuntu-latest**:Alpine / static binary
  用 musl,适合 Docker 镜像分发。
- **Artifact 名规则**:`openbuddy-host-core-{target-triple}{.exe}`,
  `windows-msvc` 自动加 `.exe` 后缀。

### 4. Job 3:`rust-lint`(ubuntu-latest only)

```yaml
- run: cargo fmt --all -- --check
- run: cargo clippy --workspace --all-targets --locked -- -D warnings
```

**为什么 ubuntu only**:rustfmt / clippy 是 host-only 工具,不需要
跨平台 runner。rustfmt 检查格式,clippy 检查 lint。

**`--locked`**:`Cargo.lock` 必须不变,避免依赖漂移。
**`-D warnings`**:任何 clippy warning 直接 fail。

### 5. Job 4:`build-summary`(聚合失败)

```yaml
needs: [rust-test, rust-cross-release, rust-lint]
if: failure()
steps:
  - run: |
      echo "## Rust CI Summary" >> $GITHUB_STEP_SUMMARY
      echo "❌ One or more jobs failed. See logs above." >> $GITHUB_STEP_SUMMARY
```

**为什么**:3 个 jobs 跑完后,GitHub 默认 summary 没聚合,需要这一步
在 PR 检查列表里给出明确红叉。

### 6. Rust 工具链 pin(1.88.0)

```yaml
env:
  RUSTUP_TOOLCHAIN: 1.88.0
steps:
  - uses: dtolnay/rust-toolchain@master
    with:
      toolchain: ${{ env.RUSTUP_TOOLCHAIN }}
      components: rustfmt, clippy
```

**为什么 1.88.0**:`ignore 0.4.33` crate 在 1.88 以下编译失败
(`unused_braces` lint 报错)。未来 Rust 升级需重测 5 个核心 crate
(tokio 1.38 / rusqlite 0.32 / aes-gcm 0.10 / ignore 0.4 / dirs 5)。

### 7. Cargo workspace 配合

`crates/Cargo.toml` 是 workspace 根,members 5:
- `openbuddy-host-core`
- `openbuddy-db`
- `openbuddy-ignore`
- `openbuddy-audit-types`
- `openbuddy-error-codes`

CI 用 `cargo test --workspace --locked` 跑整个 workspace。

## Consequences / 影响

### 正面

- **三平台原生 build 验证**:`rust-test` job 确保 macOS / Linux /
  Windows native runner 都能 build + test 通过。
- **8 个 triple release artifact**:每次 push 都会产出 8 个 prebuilt
  binary,可直接 `gh run download` 拿。
- **rustfmt / clippy 强制**:`-D warnings` 让任何格式 / lint 问题
  立即在 PR 中暴露。
- **失败聚合 summary**:`build-summary` job 让失败原因一目了然。
- **本地开发者镜像**:开发者本地 `cargo test --workspace` 与 CI
  一致(同样 locked lockfile + 1.88.0 toolchain)。

### 负面

- **CI 时间**:8 triple × cross build 大约 +8-12 分钟。三平台 native
  test + clippy + fmt 大约 +4-6 分钟。总 CI 大约 +15-20 分钟。
  **缓解**:3 个 native test job 并行跑,cross release 用 `fail-fast: false`
  拿全 8 个 artifact。
- **cross image 下载**:首次 cross job 拉 `ghcr.io/cross-rs/*:main`
  image 约 +30-60s。后续跑命中 cache。
- **macOS runner 配额**:GitHub Actions macOS runner 用量有限,
  OpenBuddy 公共仓库免费 1000 分钟/月,目前够用;若需要跨平台
  release 跑得更频繁,需自建 macOS runner。
- **Windows runner 慢**:`aarch64-pc-windows-msvc` 在 windows-latest
  runner 上跑大约 10-15 分钟,是其他 triple 的 2-3x。

### 中性

- **Cargo.lock 必须 commit**:CI `--locked` 要求 lockfile 在仓库里。
  目前 lockfile 已 commit。
- **Cargo cache**:CI 用 `Swatinem/rust-cache@v2` 缓存 `~/.cargo/registry`
  与 `target/`,首次跑满,后续 cache 命中。
- **`crates/README.md`** 同步更新:记录 8 triple + 本地 dev 命令 +
  `resolveHostBinary` 解析路径,作为开发者参考。

## Verification / 验证

- ✅ `.github/workflows/rust-host-core.yml` 283 行,4 jobs。
- ✅ `crates/README.md` 已更新 8-triple 表 + dev 命令。
- ✅ `rust-test` job 用 3 native runner。
- ✅ `rust-cross-release` job 用 8 triple + cross image。
- ✅ `rust-lint` job 用 rustfmt + clippy -D warnings。
- ✅ `build-summary` job 聚合失败。
- ✅ toolchain pin 1.88.0(env `RUSTUP_TOOLCHAIN`)。

## Alternatives Considered / 替代方案

### A. 只跑 native test,不跑 cross release

**理由反对**:OpenBuddy 跨平台交付是关键(PI-Desktop 同款)。
  仅 native test 无法保证 8 triple release 成功。
**结论**:保留 cross release job。

### B. 用 `cargo test --workspace` 而不是 `--locked`

**理由反对**:不带 `--locked` 会让 CI 自动 update `Cargo.lock`,
  导致 PR 之间 lockfile 漂移,本地与 CI 不一致。
**结论**:用 `--locked`。

### C. 跨平台用 GitHub-hosted runner + rustup target add

**理由反对**:rustup target add 只下载 std library,无法跨编译 C 依赖
  (rusqlite bundled SQLite)。需要完整的 cross toolchain + linker,
  cross-rs 镜像已打包。
**结论**:用 cross-rs。

### D. 把 release artifact 上传到 S3 而不是 GitHub release

**理由反对**:OpenBuddy 目前用 GitHub release 分发 prebuilt binary,
  仓库内部审计 / 用户下载都走 release 页面。S3 增加外部依赖。
**结论**:用 GitHub release,artifact 上传为 draft release。

## References / 参考

- PI-Desktop 跨平台构建:`PI-Desktop/docs/adr/0009-cross-platform-release.md`
- cross-rs:`https://github.com/cross-rs/cross`
- ignore 0.4.33 工具链要求:`https://github.com/BurntSushi/ripgrep/blob/master/Cargo.toml`
- Rust 工具链管理:`https://rust-lang.github.io/rustup/`

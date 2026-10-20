#!/usr/bin/env bash
# build-host-core-matrix.sh — 跨平台 host-core 二进制矩阵构建 (P3 打包发布)
#
# 对照 PI-Desktop crates/host-core build 矩阵,本脚本构建 OpenBuddy
# Rust host-core sidecar 在所有目标平台上的 release 二进制。
#
# 8 triple 矩阵(与 ADR-0011 / .github/workflows/rust-host-core.yml 对齐):
#
#   | 平台       | target triple                          | 架构     | 工具链     |
#   |------------|----------------------------------------|----------|------------|
#   | macOS      | aarch64-apple-darwin                   | arm64    | osxcross   |
#   | macOS      | x86_64-apple-darwin                    | x64      | osxcross   |
#   | Linux      | x86_64-unknown-linux-gnu               | x64      | cargo       |
#   | Linux      | aarch64-unknown-linux-gnu              | arm64    | cross      |
#   | Linux      | x86_64-unknown-linux-musl              | x64 musl | cross (alpine) |
#   | Windows    | x86_64-pc-windows-msvc                | x64      | cross      |
#   | Windows    | aarch64-pc-windows-msvc                | arm64    | cross      |
#   | FreeBSD    | x86_64-unknown-freebsd                 | x64      | (可选,后续) |
#
# 用法:
#   ./scripts/build-host-core-matrix.sh                       # 本机架构
#   ./scripts/build-host-core-matrix.sh --all                # 全部可用目标
#   ./scripts/build-host-core-matrix.sh --target x86_64-unknown-linux-gnu
#   ./scripts/build-host-core-matrix.sh --platform linux
#
# 输出:
#   - 每个 triple 一个 binary,落到 crates/target/<triple>/release/openbuddy-host-core{,.exe}
#   - 顶层 ls 输出建好 Cargo_Build_Matrix.md(供发版检查 / 用户阅读)
#
# 前置条件:
#   - Rust toolchain 已安装(`rustup default stable`)
#   - macOS targets: `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
#   - Linux cross: `cargo install cross --git https://github.com/cross-rs/cross`
#   - Windows MSVC: `rustup target add x86_64-pc-windows-msvc aarch64-pc-windows-msvc`

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

ALL_TARGETS=(
  "aarch64-apple-darwin"
  "x86_64-apple-darwin"
  "x86_64-unknown-linux-gnu"
  "aarch64-unknown-linux-gnu"
  "x86_64-unknown-linux-musl"
  "x86_64-pc-windows-msvc"
  "aarch64-pc-windows-msvc"
)

LOG_DIR="${REPO_ROOT}/target/matrix-logs"
mkdir -p "${LOG_DIR}"

echo "=== OpenBuddy host-core build matrix (P3) ==="
echo "Repo root: ${REPO_ROOT}"
echo "Log dir:   ${LOG_DIR}"
echo

# 解析参数
TARGETS=()
case "${1:-}" in
  --all)
    TARGETS=("${ALL_TARGETS[@]}")
    ;;
  --target)
    shift
    TARGETS=("$@")
    ;;
  --platform)
    PLATFORM="${2:-}"
    case "${PLATFORM}" in
      mac|macos|darwin)
        TARGETS=("aarch64-apple-darwin" "x86_64-apple-darwin")
        ;;
      linux)
        TARGETS=("x86_64-unknown-linux-gnu" "aarch64-unknown-linux-gnu" "x86_64-unknown-linux-musl")
        ;;
      win|windows)
        TARGETS=("x86_64-pc-windows-msvc" "aarch64-pc-windows-msvc")
        ;;
      *)
        echo "未知平台: ${PLATFORM}" >&2
        exit 2
        ;;
    esac
    ;;
  "")
    # 默认:本机架构对应的目标
    UNAME_M=$(uname -m)
    case "${UNAME_M}" in
      arm64|aarch64)
        case "$(uname -s)" in
          Darwin) TARGETS=("aarch64-apple-darwin") ;;
          Linux)  TARGETS=("aarch64-unknown-linux-gnu") ;;
          *)      echo "不支持的 OS: $(uname -s)" >&2; exit 2 ;;
        esac
        ;;
      x86_64)
        case "$(uname -s)" in
          Darwin) TARGETS=("x86_64-apple-darwin") ;;
          Linux)  TARGETS=("x86_64-unknown-linux-gnu") ;;
          *)      echo "不支持的 OS: $(uname -s)" >&2; exit 2 ;;
        esac
        ;;
      *)
        echo "本机架构 ${UNAME_M} 未在矩阵中,使用 --all 强制构建" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    echo "未知参数: $*" >&2
    exit 2
    ;;
esac

echo "Targets to build:"
for t in "${TARGETS[@]}"; do echo "  - ${t}"; done
echo

# 用 cross 还是原生 cargo
build_one() {
  local target="$1"
  local log="${LOG_DIR}/${target}.log"
  echo ">>> ${target} ..."
  if command -v cross >/dev/null 2>&1; then
    cross build --release --target "${target}" -p openbuddy-host-core >"${log}" 2>&1 \
      && echo "    ✓ ${target} (cross)" \
      || { echo "    ✗ ${target} — see ${log}"; return 1; }
  else
    cargo build --release --target "${target}" -p openbuddy-host-core >"${log}" 2>&1 \
      && echo "    ✓ ${target} (cargo)" \
      || { echo "    ✗ ${target} — see ${log}"; return 1; }
  fi
}

FAILED=0
for t in "${TARGETS[@]}"; do
  build_one "${t}" || FAILED=$((FAILED + 1))
done

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "✓ 全部 ${#TARGETS[@]} 个 target 构建成功"
else
  echo "✗ ${FAILED} / ${#TARGETS[@]} 失败,查看 ${LOG_DIR}/"
  exit 1
fi

echo
echo "产物清单:"
for t in "${TARGETS[@]}"; do
  case "${t}" in
    *windows*) bin="crates/target/${t}/release/openbuddy-host-core.exe" ;;
    *)         bin="crates/target/${t}/release/openbuddy-host-core" ;;
  esac
  if [[ -f "${bin}" ]]; then
    size=$(stat -c%s "${bin}" 2>/dev/null || stat -f%z "${bin}" 2>/dev/null)
    echo "  ${bin}  (${size} bytes)"
  else
    echo "  ${bin}  MISSING"
  fi
done

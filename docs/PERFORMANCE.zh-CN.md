# Performance

[English](PERFORMANCE.md) · **简体中文**

### 性能预算

| 指标 | 目标 | 度量 |
|---|---|---|
| 冷启动到可交互(Win/macOS, M1/i7) | ≤ 2.5 s | 真机 UI smoke |
| 热启动(Vite HMR dev) | ≤ 200 ms | `vite` dev server |
| 渲染端入口 chunk | ≤ 4 MB 未压缩(CI 门禁) | `node scripts/perf/bundle-topology.mjs --strict` |
| 渲染端总体 | ≤ 13 MB 未压缩(CI 门禁) | `node scripts/perf/bundle-topology.mjs --strict` |
| 主进程 bundle | ≤ 4 MB | `node scripts/perf/bundle-baseline.mjs --include-main` |
| IPC 分发热路径(验证器 + 提取) | ≤ 5 µs p99 / 次 | `node scripts/perf/ipc-latency.mjs` |
| 内存基线(空闲) | ≤ 250 MB | `process.memoryUsage()` |
| 每活跃会话内存 | ≤ 50 MB | `process.memoryUsage()` |
| 测试套件(309 个测试文件) | ≤ 3 分钟 | CI 日志 |

任何**超出预算 > 10%** 的发布会在 CI `perf-budget` job 失败(渲染端入口 chunk 或总大小),从而被阻止合并。

> 📊 实测基线、可运行脚本、改 X 之前要看哪段代码的回归矩阵,请见
> [`docs/perf/REGRESSION_MATRIX.md`](./perf/REGRESSION_MATRIX.md)。这份矩阵是本文的**实测**伴侣 —— 这里提到的每个脚本都真实可跑,那里引用的每个数字都真实可测。

### 如何度量

#### 本地

```bash
# Bundle topology —— CI 门禁质量检查
pnpm exec electron-vite build
node scripts/perf/bundle-topology.mjs --strict

# Bundle baseline —— 带 JSON 输出的被动报告器(用于趋势追踪)
node scripts/perf/bundle-baseline.mjs --include-main \
  --json=evidence/perf/bundle-baseline-$(date +%s).json

# IPC 分发热路径微基准
node scripts/perf/ipc-latency.mjs --iterations=3000 --inner=200 \
  --json=evidence/perf/ipc-latency-$(date +%s).json

# 把所有 perf 产物聚合到一份 dashboard
node scripts/perf/dashboard.mjs --since-days=7
```

#### CI

- **每个 PR** —— `perf-budget` job 跑 `bundle-topology.mjs --strict`,如果入口 chunk > 4 MB 或总 > 13 MB,或 heavy chunk(markdown/katex/mermaid/cytoscape/cynefin)泄漏进入口静态图,即失败。
- **合并到 master** —— 完整 perf dashboard 每晚更新
- **发布 tag** —— 性能预算门禁;违反则阻塞发布

### 我们遵循的模式

#### 渲染端

- **按路由代码分割**。重屏(ChatView、Settings、Marketplace)动态 import
- **Zustand 选择器用 `shallow` 相等性记忆化** 昂贵选择器
- **虚拟化长列表**(会话、插件、市场)用 `@tanstack/virtual`
- **避免布局抖动** —— 永远不要在写入循环里读 DOM 尺寸
- **`requestAnimationFrame` 把流式 delta 限流到 ≤ 60 fps**
- **图标按需加载** —— `Icon.tsx` 只 import 可见路由用到的图标

#### 主进程

- **流式事件不每个字节走 IPC**。以 16 ms 间隔批量
- **存储写操作去抖 250 ms**;`before-quit` 时 flush
- **插件重载** 用 worker_threads,避免阻塞主进程

#### 构建

- **lucide-react 摇树**。只 import 用到的图标
- **`splitChunks`** 给 vendor 库(react、katex、mermaid)
- **`esbuild` 压缩**(Vite 默认)
- **CSS purge** 经 PostCSS

#### 持久化

- **SQLite WAL** 模式用于 memory 与审计账本
- **Append-only** 审计日志,每 1000 条做哈希链 checkpoint
- **懒迁移** —— schema 变更在下次读取时执行

### 避免的模式

- ❌ **`useEffect` 用于派生状态** —— 用 Zustand 选择器
- ❌ **每个组件都用 `React.memo`** —— 只在 profiling 后记忆化
- ❌ **热路径用 JSON.stringify** —— 用 MessagePack 或原生结构化克隆
- ❌ **主进程同步 fs** —— 包装在 `fs.promises`
- ❌ **性能关键代码里用 `any`** —— TypeScript 擦除在运行时无效
- ❌ **模块顶层 import 大库** —— 动态 import 重库(mermaid、katex)

### Profiling 技巧

(同英文版)

### 已发布的优化

过去 6 个月的性能工作:

- ⚡ 流式 delta 批量间隔从 4 ms 改为 16 ms —— **React 重渲染减少 40%**
- ⚡ 通过摇树,图标 bundle 从 1.2 MB 砍到 280 KB
- ⚡ 通过懒加载 marketplace,冷启动从 3.5 s 降到 2.1 s
- ⚡ 修复 session store 内存泄漏 —— 长时间会话稳定在 250 MB
- ⚡ 启用 SQLite WAL —— 写入快 6 倍

---

<div align="center">

**Fast is a feature. / 快就是特性。**

</div>

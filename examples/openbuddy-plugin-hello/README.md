# openbuddy-plugin-hello

最小可用 OpenBuddy 插件示例 — 在 HomePage 场景切换栏注册一个 "Hello" tab。

## 文件清单

- `manifest.json` — 插件元数据（name / version / description / contributes）
- `index.tsx` — 插件主体，使用 `defineExtension` API 注册 slot

## 运行

```bash
# 开发模式：把本目录放到 ~/openbuddy-plugins/openbuddy-plugin-hello/
mkdir -p ~/openbuddy-plugins/openbuddy-plugin-hello
cp manifest.json index.tsx ~/openbuddy-plugins/openbuddy-plugin-hello/
# 启动 OpenBuddy，进入设置 → 已安装扩展，刷新即可看到
pnpm dev
```

## 代码说明

```typescript
defineExtension({
  manifest: { name: "openbuddy-plugin-hello", version: "0.15.0", ... },
  setup: (api) => {
    api.registerSlot("home.scene.tab", "list", "root", {
      id: "hello-world-tab",
      label: "👋 Hello",
      onActivate: () => alert("Hello, World! 👋"),
    });
  },
});
```

插件被加载后，HomePage 的场景栏会出现 "👋 Hello" tab，点击触发 `alert`。

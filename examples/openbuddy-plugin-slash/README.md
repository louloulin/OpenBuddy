# openbuddy-plugin-slash

注册一个 slash 命令 `/greet <name>`，在 Composer 输入 `/greet Alice` 触发后输出 `Hello, Alice!`。

## 文件清单

- `manifest.json`
- `index.tsx`
- `README.md`

## 使用

```
/greet Alice    →  Hello, Alice!
/greet          →  Hello, World!
```

## 命令注册

通过 `api.registerCommand(id, label, onExecute)` 注册。`onExecute` 接收可选 `args` 字符串。

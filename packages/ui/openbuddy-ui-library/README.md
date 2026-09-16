# @openbuddy/ui-library

资料库 —— 用户的资料统一入口(我的文件 / 知识库 / 云存储 / 灵感),对标
WorkBuddy 的 library 面板,但**分区是插件可扩展的**。

## 结构

```
LibraryPage
├── 左:分区导航(来自 `library.section` 槽,按 meta.order 排序)
└── 右:当前分区内容(分区自带标题 / 空态;内层沿用 .placeholder-page--panel 包络)
```

## 槽位

| 槽位 | kind | 消费者 | 说明 |
| --- | --- | --- | --- |
| `placeholder.library` | single | `PlaceholderPage`(资料库 / 更多 / 灵感 路由) | 整页可被插件替换 |
| `library.section` | list | `LibraryPage` | 分区总线,内置 4 个分区也走它 |

## 追加一个分区(插件)

```tsx
import { defineLibrarySection } from "@openbuddy/ui-library";

export const MySection = defineLibrarySection(
  { id: "team-wiki", label: "团队知识", icon: "generic", order: 15 },
  function MySection({ onToast, cwd }) {
    return <TeamWiki onToast={onToast} cwd={cwd} />;
  },
);

// apply(ctx):
ctx.slots.register(
  { name: "library.section", kind: "list", scope: "root", id: "team-wiki", registrant: "my-plugin" },
  MySection as never,
);
```

`defineLibrarySection` 把元数据挂在组件上:槽位注册值仍然是组件(符合
`packages/ui/AGENTS.md`),而宿主能拿到导航列需要的 `label / icon / order`。
图标只给 id,插件不需要依赖图标表。

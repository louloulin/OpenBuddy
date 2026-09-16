# @openbuddy/ui-onboarding

首启引导层。承载"第一次打开 OpenBuddy"到"第一次真正干活"这条路上的全部界面。

| 能力              | 组件                          | 槽位                   |
| ----------------- | ----------------------------- | ---------------------- |
| 分步向导(可恢复)  | `OnboardingWizard`            | `onboarding.wizard`    |
| 锚定式漫游        | `TourModal` + `TourSpotlight` | `onboarding.tour`      |
| 数据目录确认      | `DataDirPrompt`               | `onboarding.data-dir`  |
| 轻量反馈(赞 / 踩) | `FeedbackPopup`               | `onboarding.feedback`  |
| 版本更新摘要      | `WhatsNewCard`                | `onboarding.whats-new` |

与 `@openbuddy/ui-shell` 的 `OnboardingChecklist` / `StartupSplash` 是互补关系:
那两个是**常驻**的启动画面与"还剩几步"清单,本包是**一次性**的首启流程。

## 设计约束

- **零依赖**:只用 `react` / `react-dom`(portal)与 `--wb-*` token,不引第三方 UI 库。
- **数据驱动**:向导步骤是 `{ id, title, render }[]`,漫游步骤是
  `{ id, title, target, placement }[]`;组件不 import 任何业务模块。
- **宿主持有副作用**:所有 `onSubmit` / `onDismiss` / `onComplete` 都抛回宿主
  (IPC、写盘、上报由宿主决定),组件本身不碰 IPC。
- **持久化可注入**:`storage?: { getItem, setItem, removeItem }`,默认
  `window.localStorage`;传 `null` 即退化为纯内存(测试 / 隐私模式下有用)。

## 向导状态机

`lib/onboarding-reducer.ts` 是一组纯函数 —— 引导是全应用最容易被打断的交互,
把它压成 `storage → state → state` 之后,UI 与副作用各自独立可测。

```ts
import {
  readOnboardingState,
  nextOnboardingStep,
  writeOnboardingState,
} from "@openbuddy/ui-onboarding/lib/onboarding-reducer";

let state = readOnboardingState(window.localStorage, ["welcome", "provider", "done"]);
state = nextOnboardingStep(state, ["welcome", "provider", "done"]);
writeOnboardingState(window.localStorage, state);
```

语义要点:

- `active` 恒等于游标所在步骤;游标向后移动时,原 `active` 退回 `pending`
  (它只是"到过",还没被解决),而 `done` / `skipped` 永不回滚。
- 宿主增删步骤时按 **id** 对齐:同名步骤保留历史进度,新步骤追加为 `pending`。
- 任何脏数据(解析失败 / 版本不匹配 / storage 抛错)都退化为"全新状态",不抛异常。

## 漫游

```tsx
import { TourModal, useTourController } from "@openbuddy/ui-onboarding";

const tour = useTourController({ autoOpen: true });
return (
  <>
    <button onClick={() => tour.start()}>重新观看引导</button>
    <TourModal open={tour.open} steps={tour.steps} onFinish={tour.stop} onClose={tour.stop} />
  </>
);
```

目标锚点用 `data-tour="<id>"`(或任意 CSS 选择器)。三种退化路径:

1. 目标缺失 → 自动跳到下一个可达步骤;
2. 剩余步骤全不可达 → 直接 `onFinish`;
3. 没有视口信息(jsdom / SSR)→ 用固定回退尺寸跑同一套定位函数。

`computeCardPosition()` / `probeTourStep()` / `findAvailableTourIndex()` 都是纯函数,
可以在没有真实布局的环境里直接断言。

## 用法

```tsx
import {
  OnboardingWizard,
  DataDirPrompt,
  FeedbackPopup,
  WhatsNewCard,
} from "@openbuddy/ui-onboarding";

<OnboardingWizard
  steps={[
    { id: "welcome", title: "欢迎" },
    { id: "theme", title: "挑主题", optional: true },
    { id: "provider", title: "接入模型", render: (api) => <ProviderForm onDone={api.next} /> },
  ]}
  onComplete={closeWizard}
  onSkip={closeWizard}
  onDismiss={closeWizard}
/>;
```

`apply(ctx)` 会把 5 个 surface 注册到对应槽位:自带默认值的(wizard / tour)
零配置即可渲染;依赖宿主回调的(data-dir / feedback / whats-new)在缺回调时
渲染 `null`,避免把一个提交不了的空壳弹给用户。宿主想换成自己的 UI,只需以
更高优先级注册自己的组件。

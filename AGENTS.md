# Ainotation

框架无关的 DOM 标注与原生动画检查工具，通过 Script/SDK 接入开发者项目。
以下选型已确定，无需在后续会话中重复确认。

## 技术栈

- 核心：TypeScript（strict），不依赖宿主渲染框架。
- UI：Lit + Shadow DOM；原生 CSS / CSS Variables；Lucide 图标。
- 动画与捕获：Web Animations API、Screen Capture API 等原生浏览器能力，渐进增强。
- 截图编辑：位图底图 + SVG 标记；Canvas 负责裁剪与图片合成。暂不引入 Konva。
- 数据契约：Zod + JSON Schema；反馈文档独立于 UI、SVG 和浏览器运行时对象。
- 本地存储：IndexedDB + idb，图片使用 Blob，不放入 localStorage。
- 工具链：Vite+；应用使用 `vp dev` / `vp build`，SDK 与 MCP 包使用 `vp pack`。
- 组件开发：Storybook + `@storybook/web-components-vite`。
- 测试：Vitest + Playwright；保留小型 Playground 验证真实宿主、动画和屏幕捕获。
- 包管理与发布：pnpm workspace + Changesets，结合 Vite+ 管理。
- Agent 集成：独立 Node.js LTS 进程 + 官方 MCP SDK；浏览器通过 HTTP/SSE 通信。

## 实现边界

- MCP 是首版正式能力，但基础标注不依赖其运行；未连接时可复制反馈、导出附件。两种出口共用数据契约。
- 核心逻辑、反馈文档、UI、集成分离；无需提前把每个模块拆成发布包。
- 选择元素即持续观察其子树中的动画；多选取并集，不扩大到共同祖先。观察不暂停页面，显式检查才接管动画。
- 暂不做浏览器扩展、任意 JS 动画倒放、录像/GIF、云端账号和多人协作；源码定位为可选增强。
- 工具运行时依赖由 SDK 自行提供，不要求宿主安装 Lit；重模块按需加载。
- 原生资源生命周期独立于 UI 渲染；销毁时清理监听器、动画控制和媒体流。
- MCP 服务默认仅监听 loopback，并实现本地鉴权、Origin 校验和会话隔离。

## 当前仓库

```text
packages/
  schema/              共享数据契约
  sdk/                 核心逻辑与 Lit UI
  mcp/                 独立 MCP 服务
apps/
  playground/          SDK 集成开发与验证
  storybook/           UI 组件开发
pnpm-workspace.yaml    Workspace 配置与依赖版本 catalog
```

使用 `vp install` 安装依赖，`vp run dev` 启动 Playground，`vp run storybook` 启动组件开发环境；提交前运行 `vp run ready`。
`vp <命令>` 是工具链内置命令，`vp run <脚本>` 执行 workspace 脚本；新增功能应补对应测试。

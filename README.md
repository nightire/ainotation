# Ainotation

框架无关的 DOM 标注与原生动画检查工具。MVP 已通过技术验证并移除，当前仓库是产品化开发骨架，尚未实现正式的元素选择、动画检查、截图编辑或反馈同步流程。

## 工作区

```text
packages/
  schema/      共享反馈契约、Zod 校验和 JSON Schema
  sdk/         浏览器 SDK 生命周期与 Lit / Shadow DOM UI
  mcp/         独立 Node.js MCP 服务
apps/
  playground/  原生 TypeScript 宿主，用于 SDK 集成开发
  storybook/   Lit 组件的独立开发与状态展示
```

SDK 核心、UI、文档与集成保持模块边界，不提前拆成更多发布包。所有 workspace 包当前为 private，正式发布前再确定许可证和发布策略。

## 环境与安装

使用 Node.js 24 LTS、Vite+ 全局 CLI 和 pnpm。运行时要求与包管理器版本在 `package.json` 中声明，依赖版本集中在 `pnpm-workspace.yaml` 的 catalog。

```sh
vp install
vp run dev
vp run storybook
```

后两个命令分别运行 Playground 和 Storybook，可在两个终端中启动。默认地址是 `http://127.0.0.1:5173` 和 `http://127.0.0.1:6006`，以终端输出为准。

本地 Vite+ 固定为 0.2.9，与 Storybook 10.6.0 声明的兼容范围一致；TypeScript 使用 6.0.3，避免声明打包依赖尚不稳定的 TypeScript 7 API。浏览器测试使用的 Vitest provider 与 Vite+ 自带的 Vitest 版本保持一致。

## 检查与构建

```sh
vp run ready       # 格式、lint、类型检查、测试、全部构建
vp run typecheck
vp run test
vp run build
vp fmt
```

`vp <命令>` 调用工具链内置命令；`vp run <名称>` 执行仓库脚本。根目录脚本负责按 workspace 依赖顺序运行，库包使用 `vp pack`，Playground 使用 `vp build`，Storybook 使用自己的构建命令。

SDK 生命周期测试通过 Vitest Browser Mode 在本机 Chrome 中运行，需要已安装 Chrome。schema 和 MCP 测试在 Node.js 中执行。正式动画、媒体权限和跨浏览器回归会随对应功能加入。

## SDK 骨架

```ts
import { createAinotation } from '@ainotation/sdk';

const inspector = createAinotation();
await inspector.mount();
inspector.destroy();
```

当前只挂载可关闭的 Inspector shell。导入入口不会访问 DOM；UI 在异步 mount 时按需加载并注册。SDK 的构建产物包含 Lit 和所用图标的运行时代码，不要求宿主手动提供框架。尚未增加独立 Script 分发入口。

开发环境通过条件导出访问 workspace 源码；生产构建使用 `dist` 中的 ESM 和类型声明。需要直接使用产物时，先执行 `vp run build`。

## MCP 骨架

```sh
vp run build
vp run @ainotation/mcp#start
```

当前通过 stdio 提供 `ainotation_get_schema` 工具，用于验证 MCP 客户端与共享数据契约的连接，不会打开 HTTP 端口。浏览器 HTTP/SSE 通信、鉴权、会话隔离、反馈收发和附件访问尚未实现；添加 HTTP 服务时必须遵循 `AGENTS.md` 的安全边界。

## 版本管理

已配置 Changesets。实现需要记录版本影响的变更时运行 `vp run changeset`；发布准备阶段使用 `vp run version-packages`。当前未自动提交、打 tag 或发布包。

`AGENTS.md` 记录已确定的技术栈与边界。旧 MVP 源码及专用脚本不再保留在产品目录中；本机历史截图和测试产物仍位于 git 忽略目录，不参与构建。

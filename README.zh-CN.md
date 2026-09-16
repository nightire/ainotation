# Ainotation

**面向 Web 开发与 AI 编程 Agent 的可视化反馈工具。**

[![npm beta](https://img.shields.io/npm/v/@ainotation/vite/beta?label=npm%20beta)](https://www.npmjs.com/package/@ainotation/vite)
[![Checks](https://github.com/nightire/ainotation/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/nightire/ainotation/actions/workflows/release.yml)

[English](./README.md) · 简体中文

选中元素，描述需要修改的地方，把上下文直接交给你的编程 Agent。Ainotation 将反馈关联到真实的页面元素和文本选区，并通过 MCP 或导出文件提供 DOM 上下文与标注截图。

## 特性

- **带上下文的反馈。** 标注元素或文本选区，同时保留选择器、样式、位置和周围 DOM 信息。
- **直接在页面上绘图。** 添加箭头、形状和自由笔迹，框选多个图形，裁剪截图；也支持粘贴、拖入和选择图片。
- **与 AI Agent 协作。** 通过本地 MCP 服务读取和编辑已保存的反馈，按需获取图片附件。
- **本地即可使用。** 草稿和标注在刷新后仍可恢复，无需 MCP 连接也能复制 Markdown 或导出反馈，不需要账号或云端服务。
- **接入现有应用。** 框架无关的界面、自动化 Vite 接入，以及适用于 monorepo 的工作区项目发现。
- **适合你的习惯。** 支持明暗主题、快捷键，以及简体中文、繁體中文、English、日本語和 한국어 五种界面语言。

## 快速开始

需要 **Node.js 24.x LTS（24.20 或更新版本）**，以及 **Vite 7/8 或 Vite+** 项目。

### 1. 安装插件

```sh
pnpm add -D @ainotation/vite@beta
```

插件已包含 SDK 和本地服务依赖，**不需要单独安装 `@ainotation/sdk`**。

### 2. 添加到 Vite 配置

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { ainotation } from '@ainotation/vite';

export default defineConfig({
  plugins: [
    // 保留现有的框架插件。
    ainotation({ name: 'my-app' }),
  ],
});
```

如果使用 Vite+，请从 `vite-plus` 导入 `defineConfig`。

### 3. 启动开发服务器

运行应用平时使用的开发命令，在浏览器中打开页面。点击浮动的 **A** 按钮，选中一个元素，即可填写第一条反馈。

插件会自动完成注入和本地配对。它只在开发环境启用，不会将 Ainotation 注入生产构建。

## 连接编程 Agent

将 Ainotation 添加到 MCP 客户端。对于使用 `mcpServers` 配置格式的客户端：

```json
{
  "mcpServers": {
    "ainotation": {
      "command": "npx",
      "args": ["--yes", "@ainotation/mcp@beta", "connect"]
    }
  }
}
```

对应的启动命令为：

```sh
npx --yes @ainotation/mcp@beta connect
```

客户端需要提供项目的工作区 roots，或在该工作区目录下启动进程。如果两者都不满足，请在参数中追加 `--directory /项目的绝对路径`。不同 MCP 客户端的配置格式可能有所不同。

命令行选项可通过 `npx --yes @ainotation/mcp@beta --help` 查看。

启动 Web 应用完成项目注册，保存一些反馈后，就可以告诉 Agent：

> 读取 my-app 的 Ainotation 反馈，并完成其中要求的 UI 修改。

Agent 可以发现项目、读取反馈和图片，以及新增、修改、删除标注。你也可以通过 **复制反馈** 或 **导出** 手动分享。

遇到文件丢失、服务异常或存储损坏时，可使用 `ainotation-mcp doctor` 和 `ainotation-mcp repair`。Settings 也提供重试连接及从当前浏览器恢复项目的入口。冲突处理与外部备份操作见[可靠性与恢复说明](./RECOVERY.md)。

### 同一工作区内的多个应用

为每个应用设置不同的项目名称。如果希望重命名后保持身份不变，可额外提供稳定的 `id`：

```ts
ainotation({ name: '管理后台', id: 'my-company/admin' });
```

使用 `ainotation_list_projects` 发现应用；存在多个项目时，在工具调用中传入 `project`。工作区连接无法访问其 roots 范围之外的项目。

## 使用方式

1. **选择目标**：点击元素或拖选页面文字，按住 **Shift** 可选择多个元素。
2. **描述修改**：在 marker 弹出框中填写反馈，需要时添加截图或导入图片。
3. **保存反馈**：之后可以点击编号 marker 再次编辑。
4. **交给 Agent**：通过 MCP、复制的 Markdown 或导出文件传递反馈。

选择或绘图时，按住 **Option / Alt** 可操作真实页面，便于打开菜单、填写表单，准备需要标注的页面状态。

设置中可以切换界面语言、主题和 Markdown 详细程度。偏好按项目保存，反馈按项目与完整页面 URL 隔离。

### 截图与图片

在 marker 弹出框中选择 **截图**，即可直接在页面上绘图；也可以粘贴、拖入或选择 PNG/JPEG/WebP 图片。绘图工具支持移动、缩放、旋转、框选、撤销／重做和裁剪。

原生屏幕捕获需要受支持的桌面浏览器、HTTPS 或 localhost 等安全上下文，以及你的授权。实时裁剪请选择**当前浏览器标签页**。不支持屏幕捕获时，仍可导入外部截图。

图片先加入草稿，保存反馈后才会共享。带图页面导出为包含 Markdown、JSON 和 PNG 的 ZIP；无图页面导出为 JSON。复制会汇总当前项目所有页面的已保存反馈，导出和清除则仅作用于当前页面。

<details>
<summary>快捷键</summary>

| 使用场景   | 快捷键                   | 操作                                   |
| ---------- | ------------------------ | -------------------------------------- |
| 检查器     | Option/Alt + Shift + A   | 打开或关闭                             |
| 反馈输入框 | Command/Super + Enter    | 保存反馈                               |
| 选择或绘图 | 按住 Option/Alt          | 操作真实页面                           |
| 绘图       | V / A / R / E / F / X    | 选择、箭头、矩形、椭圆、自由绘制、裁剪 |
| 绘图       | C / S                    | 循环切换颜色／线宽                     |
| 绘图       | D                        | 删除选中图形，或在裁剪模式下清除裁剪   |
| 绘图       | Command/Ctrl + Z         | 撤销                                   |
| 绘图       | Command/Ctrl + Shift + Z | 重做                                   |
| 绘图       | Command/Ctrl + Enter     | 截图或添加图片附件                     |

绘图快捷键仅在图片编辑器打开时生效，每个工具栏操作也提供 tooltip 提示。

</details>

## 包列表

| 包                                        | 用途                                         |
| ----------------------------------------- | -------------------------------------------- |
| [`@ainotation/vite`](./packages/vite)     | 推荐接入方式：开发环境注入与自动配对         |
| [`@ainotation/sdk`](./packages/sdk)       | 浏览器检查器与手动生命周期管理               |
| [`@ainotation/mcp`](./packages/mcp)       | 本地 MCP 服务与工作区 Agent 连接             |
| [`@ainotation/schema`](./packages/schema) | 反馈契约、JSON Schema 和 Markdown／JSON 交接 |

项目目前处于 beta 阶段，请使用 npm 的 `@beta` 标签安装 beta 版本。更新记录见 [Releases](https://github.com/nightire/ainotation/releases)。

<details>
<summary>手动接入 SDK</summary>

如果需要自行控制挂载，请将 SDK 安装为项目的直接依赖：

```sh
pnpm add -D @ainotation/sdk@beta
```

在浏览器文档就绪后运行：

```ts
import { createAinotation } from '@ainotation/sdk';

const inspector = createAinotation({ projectId: 'my-app' });
await inspector.mount();
```

集成卸载时调用 `inspector.destroy()`。`getDocument()` 返回当前反馈快照，`copyFeedback()` 将项目内已保存的反馈复制为 Markdown。手动接入时，由宿主应用负责将工具限制在开发环境；Vite 插件会自动处理这一点。

传入 `mcp: false` 可创建仅本地实例：关闭 MCP 连接界面、凭据恢复和同步，标注、复制和导出仍可使用。该选项不能与 `development` 同时设置；不传入时保留现有连接行为。

</details>

## 参与贡献

欢迎提交问题、使用体验反馈和 Pull Request。遇到 bug 请[创建 Issue](https://github.com/nightire/ainotation/issues)，较大的改动建议先讨论方案。

本地开发、示例应用和检查命令见 [CONTRIBUTING.md](./CONTRIBUTING.md)（英文）；Changesets 发布流程见 [RELEASING.md](./RELEASING.md)（英文）。

## 许可证

Ainotation 采用 [MIT 开源许可证](./LICENSE)，免费用于个人和商业项目。

你可以使用、修改、分发和销售副本，包括集成到闭源产品或提供托管服务，只需保留版权和许可声明。第三方组件仍适用各自的许可证。

已发布的 `1.0.0-beta.0` 和 `1.0.0-beta.1` npm 包仍包含旧许可文本。请使用后续携带 MIT 许可证的版本，以采用新条款。完整条款见 [LICENSE](./LICENSE)。

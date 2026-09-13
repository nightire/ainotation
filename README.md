# Ainotation

框架无关的页面反馈工具。里程碑一聚焦持久化的单次标注：DOM 单选/多选、标注增删改、批量 Markdown/JSON 交接及 MCP 标注 CRUD。多轮对话架构和历史数据保留在内部，当前 UI 和 MCP 不提供回复、会话讨论或处理状态工作流。原生动画检查、截图编辑与图片附件属于后续里程碑。

## 工作区

```text
packages/
  schema/      共享反馈契约、Zod 校验和 JSON Schema
  sdk/         DOM 选择、本地草稿、同步与 Lit / Shadow DOM UI
  mcp/         独立 MCP 服务、鉴权 HTTP/SSE 和本地持久化
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

SDK 测试通过 Vitest Browser Mode 在本机 Chrome 中运行，需要已安装 Chrome。schema 和 MCP 测试在 Node.js 中执行。Playground 集成测试临时启动 Vite、HTTP/SSE 和 MCP 客户端，验证多条标注批量复制/导出、刷新恢复、MCP CRUD、离线编辑重连及历史对话的保留与隐藏，并在结束时关闭所有服务。

## SDK 使用

```ts
import { createAinotation } from '@ainotation/sdk';

const inspector = createAinotation({ projectId: 'my-project' });
await inspector.mount();
// inspector.getDocument() 返回当前文档快照。
// await inspector.copyFeedback() 复制同一文档的 Markdown。
inspector.destroy();
```

导入入口不会访问 DOM；UI 和运行时在异步 mount 时按需加载。SDK 提供 Lit 和所用图标的运行时代码，不要求宿主手动提供框架。尚未增加独立 Script 分发入口。

运行 `vp run dev` 后，Playground 默认通过 Vite 插件自动挂载 Ainotation，无需点击挂载按钮：

顶部 **Samples**（`/`）与 **Checkout**（`/checkout`）可来回切换，切换时 Inspector 保持挂载。展开 Inspector 后按住 Option/Alt 点击导航，可在两个路由分别新增标注；返回时恢复该路由的 marker 和草稿，点击 Copy feedback 会合并复制两页已保存的标注。浏览器前进、后退及直接刷新 `/checkout` 同样支持。

Marker popover 的反馈输入框支持 **Command/Super + Enter** 新建或保存反馈，与对勾按钮行为一致；普通 Enter 仍换行，空白内容、保存中、长按重复和输入法组合输入不会触发提交。

1. 默认显示 48 x 48 的圆形 **A** 触发器。打开 Inspector 后始终处于元素选取状态，没有选择开关或 Multiple 切换。普通点击选择一个元素；按住 Shift 连续点击可增减本次多选目标，松开 Shift 结束本次多选。
2. 单选后在点击处出现 24 x 24 的 **+** 圆形及输入 popover。Shift 松开时，如果指针仍在本次任一选中元素上，就在指针处放置 marker；否则放到最后一个选中目标的右下角。Popover 在 textarea 上方列出关联元素，不显示可见标题和 label。
3. 输入后点击对勾保存；叉号或 Escape 取消本次选择，仍保持选取模式。保存成功后 popover 关闭，原位出现编号 marker。悬停编号显示编辑图标，再点击可编辑：对勾保存、叉号取消、垃圾桶删除。删除同时移除标注和 marker；编辑只更新内容，保留原始页面、目标和 marker 快照。图标按钮保留提示与无障碍名称。
4. Inspector 展开为紧凑的胶囊形 toolbar，按钮依次为 **Copy feedback / Export JSON / Clear all annotations / Settings / 分隔符 / Close inspector**。复制汇总同一项目所有已保存页面的标注，按 URL 分组；JSON 导出包含当前页面全部标注及上下文。清除按钮删除当前页面的标注和未提交草稿，并向已连接的 MCP 同步删除。
5. 标注、marker 锚点和未提交草稿均保存在 IndexedDB。刷新或 unmount/remount 后默认仍显示圆形，打开即可恢复页面 marker 和未完成的输入。Shift 是临时手势，不持久化为“多选模式”。SDK 按 `projectId + 完整页面 URL` 隔离记录；默认 projectId 为页面 origin。

Playground 还提供 **Popup menu** 和 **Modal dialog** 示例。菜单的 **Export as** 可悬停或点击展开二级菜单，支持方向键、Enter、Escape 和点击外部关闭。Modal 带半透明 backdrop、表单和焦点限制，支持保存、取消、Escape 或点击 backdrop 关闭。Inspector 展开时可先按住 Option/Alt 激活这些交互，再松开键标注菜单项、对话框内容或遮罩。

原生 disabled 表单控件也可选取：工具使用根级 Pointer Events 补充被禁用控件抑制的 click，不移除 disabled 属性，也不触发控件的业务点击。拖动和取消的手势不会被当作选择。

在页面正文上直接按住主鼠标键拖选文字，松开后打开标注 popover，显示选中的文字引用。支持正向、反向、跨行内节点和 open Shadow DOM 内的选区；选区保存精确文字片段、前后文和位置。Escape 取消正在进行的拖选；Shift 仍用于元素多选，Option/Alt 仍交给真实页面交互。输入框、textarea、select 和可编辑区域的内容不通过此手势自动读取。选区文字最多 1000 字符，前后文各 64 字符，位置最多 32 个矩形；超长文字会标记截断。

Inspector 展开时，按住 **Option（macOS）/ Alt（Windows/Linux）** 可临时穿透拾取：点击、输入和菜单操作交给真实页面，marker 和 popover 也不拦截指针。松开后恢复选取，已有标注和草稿不清空。Alt 优先于 Shift，穿透期间的点击不会加入多选或生成标注；一次已经穿透的点击不会因中途松开 Alt 而被误捕获。收起 Inspector 后移除这组临时按键监听，原有开关快捷键仍可用。

需要标注 focus 或展开状态时，先按住 Option/Alt 激活控件，再松开并点击要标注的元素。目标快照保留选取瞬间的焦点状态、`aria-expanded` 和相关样式，不被之后 popover 获取焦点的变化覆盖；输入框的实际 value 不会自动采集。

关闭 toolbar 会回到圆形、停止拾取并隐藏页面高亮、marker 与 popover，不清除标注或草稿，也不断开 MCP。重新打开时按可解析元素的位置恢复；缺失目标的标注保留，并以捕获时的位置作为 marker 后备位置，便于继续编辑或删除，不将快照改绑到其它元素。旧标注没有 marker 字段时，默认使用最后一个目标的右下角。手动使用 SDK 时，完全卸载请调用 `destroy()`。圆形可直接拖动，toolbar 可通过空白边缘或分隔符拖动。两种形态共享位置：拖动任一种都会带动另一种的锚点。移动圆形后优先向左展开，左侧空间不足时向右展开；移动 toolbar 后沿当前锚点收起和展开，避免切换形态时跳位。两种形态都保持在视口内。聚焦圆形或 toolbar 的移动区域后也可用方向键移动，Shift 配合方向键微调。

`Option + Shift + A`（macOS）或 `Alt + Shift + A`（Windows/Linux）切换 toolbar 展开与收起，同时开启或退出元素选取。快捷键在反馈输入框中也可用；忽略长按重复和输入法组合输入，卸载 SDK 后移除监听。

浮动控件的共享锚点和展开方向按项目保存在 IndexedDB，并同步写入 localStorage 小型快照，避免快速刷新时丢失末次移动。拖动 trigger、拖动 toolbar 或使用方向键移动后，unmount/remount 和刷新都能恢复位置；恢复时仍以圆形 trigger 出现，较小视口会将位置限制在可见范围内。位置与 Output Detail 分别保存，刚结束拖动就重新挂载也会使用最新位置。

Settings 在 toolbar 上方打开，包含 Theme、Output Detail 与 MCP 连接配置；靠近屏幕上沿时向下打开，并适配窄屏。再次点击 Settings、点击外部或按 Escape 可关闭；Escape 优先关闭 Settings，不取消标注草稿。收起 Inspector 也会关闭 Settings，未提交的连接输入在本次挂载期间保留。

**Theme** 在 Light / Dark 之间切换，默认 Light，支持鼠标及键盘 Enter / Space 操作。主题覆盖 trigger、toolbar、Settings、页面 marker 和反馈 popover，包括表单与文字引用；只改变 Ainotation 自身的界面。偏好按项目保存，重新挂载和刷新后恢复；切换时保留标注、草稿和原始捕获数据。Storybook 提供 **Inspector/Shell → Dark** 与 **Annotations/Markers → Dark Text Selection** 预览。

**Output Detail** 控制复制的 Markdown，默认 **Standard**。点击当前级别可按 Compact → Standard → Detailed → Everything → Compact 循环切换，右侧四个圆点标示当前档位；键盘 Enter / Space 同样可切换。偏好按项目保存在 IndexedDB，刷新和重新挂载后恢复。四档使用同一份标注快照，JSON 导出与 MCP 始终保留完整上下文。

| 级别       | 复制内容                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------- |
| Compact    | 简短元素描述、selector、反馈及至多 30 字符的选中文字摘要                                 |
| Standard   | 标注标识、页面与视口、元素定位、完整选中文字                                             |
| Detailed   | 增加类名、尺寸位置、邻近文本或引用前后文、捕获状态                                       |
| Everything | 增加 DOM 祖先路径、全部已采集样式与语义属性、邻近元素、可聚焦信息、User Agent 和捕获时间 |

目标采集包含 32 项计算样式、语义与 ARIA 属性、最多 32 层祖先和 4 个邻近元素；过深的祖先链会明确标记截断。上下文排除工具 UI、隐藏文字与表单 value。旧标注缺少新增字段时仍可正常读取，不从当前页面补写历史快照。React 组件链与源码文件定位留待后续阶段。

Storybook 的 **Inspector/Shell** 展示触发器、toolbar、Settings popover 与连接状态；**Annotations/Markers** 分别展示新增、已保存和编辑中的页面标注。Shell 故事不包含真实页面拾取，完整交互在 Playground 验证。

目标丢失或匹配不唯一时显示 Missing / Ambiguous，保留原反馈，不自动改绑其它元素。页面路由变化会切换文档；仍在加载新页面文档时暂不接收编辑操作。IndexedDB 不可用时退化为内存，并明确提示导出后再刷新。

本阶段没有 Reply、Send reply、处理状态徽标或 Reopen，即使连接 MCP 也不显示。已有 `status`、`replies` 和内部对话操作仍按原有模型持久化，不会因隐藏 UI 而丢失。SDK 的 `getDocument()` 返回内部文档快照；复制、UI 导出和 MCP 读取则使用 `FeedbackExport`，只包含标注正文、标识及页面/元素上下文，不携带历史对话或处理状态。未来对话功能应在会话管理和交互规划完成后另行开放。

开发环境通过条件导出访问 workspace 源码；生产构建使用 `dist` 中的 ESM 和类型声明。需要直接使用产物时，先执行 `vp run build`。

## MCP 集成

### 多框架测试应用

仓库提供三个独立的 Web 项目，均通过 Vite 插件自动接入。首次使用先运行 `vp run build`。

| 应用       | 启动命令           | 默认地址                | MCP project 名称        |
| ---------- | ------------------ | ----------------------- | ----------------------- |
| Playground | `vp run dev`       | `http://127.0.0.1:5173` | `Ainotation Playground` |
| React      | `vp run dev:react` | `http://127.0.0.1:5174` | `react`                 |
| Vue        | `vp run dev:vue`   | `http://127.0.0.1:5175` | `vue`                   |

也可用 `vp run dev:apps` 同时启动三个应用。React / Vue 示例包含响应式计数器、输入框、下拉选择、展开内容和禁用按钮；按住 Option/Alt 操作真实页面，松开后标注。测试整个 monorepo 时，MCP 配置应省略 app 级 `--directory` 或指向仓库根目录，再通过 `ainotation_list_projects` 和每次调用的 `project` 参数选择应用。

### 推荐：Vite / Vite+ 自动接入

在 Vite 配置中声明项目即可，不需要执行 init，也不需要 `ainotation.config.json`：

```ts
import { ainotation } from '@ainotation/vite';

export default {
  plugins: [ainotation({ name: 'my-company/web-app' })],
};
```

默认使用 `name` 作为稳定项目键，内部 ID 确定性生成；如果需要自由修改显示名称，提供独立的 `id`，例如 `ainotation({ name: '管理后台', id: 'my-company/admin' })`。`id` 可以是普通字符串，也兼容旧 UUID。不同目录重复使用同一个项目键会拒绝注册，不会合并标注。

Agent 的 stdio MCP 启动命令使用 `node /absolute/path/to/packages/mcp/dist/cli.mjs connect`。全局配置优先从 Agent roots 识别工作区；不提供 roots 时使用启动目录。可以附加 `--directory /absolute/path/to/web-app-or-workspace`：指向已注册 Web app 时固定限定为该 app，指向 monorepo 时可访问其中的项目。MCP 通过本机注册表发现项目，不执行 Vite 配置；首次启动顺序不限，若 MCP 先访问未注册项目，启动开发服务器后重试即可。

Monorepo 中多个 Web app 可以共用一个 MCP 配置。先调用 `ainotation_list_projects` 获取当前工作区的候选项目，再在标注工具中传入 `project`，例如 `ainotation_list_sessions({ project: "admin" })`。参数支持精确的显示名称、插件稳定 id 或返回的项目 UUID；同名或名称与稳定 id 冲突时使用 UUID。只有一个候选项目时可省略参数，多项目省略参数会返回候选列表并要求明确选择。不会根据上一次调用或 session ID 猜测项目。

每次调用独立解析项目并使用该项目的授权，因此并行会话不会互相切换目标；工作区外的项目不会进入候选列表，知道其名称或 ID 也不能访问。Agent roots 变化后会撤销该 MCP 连接持有的项目授权，需要重新连接。

插件在开发服务器启动时自动注册项目，自动挂载 SDK，并通过同源代理同步。Settings 无需填写 endpoint/token。共享服务会自动启动或复用；MCP 连接退出只撤销自身授权。生产构建不注入工具。自动接入额外提供 `ainotation_list_projects` 和 `ainotation_get_project` 发现项目、确认身份。

当前仓库可执行 `vp run build` 后运行 `vp run dev`。Playground 的名称与稳定 ID 位于 `apps/playground/vite.config.ts`，其中保留旧 ID 以兼容已有反馈。手动挂载/卸载的生命周期测试使用 `tests/manual-entry.ts` 夹具，不再提供单独的开发模式。旧版共享服务需要升级时，可先运行 `node packages/mcp/dist/cli.mjs service --stop`，再启动开发服务器；Agent 也需重新加载新的 MCP 进程。

### 手动兼容入口

```sh
vp run build
node packages/mcp/dist/cli.mjs
```

服务提供 stdio MCP 和默认 `http://127.0.0.1:4748` 的浏览器接口，启动时将配对 token 打印到 stderr。点击 toolbar 的 **Settings**，填写 MCP connection 下的 Endpoint 与 Token 后连接。token 只保存在当前标签页的 sessionStorage 和内存，不进入反馈文档或导出文件；点击 Disconnect 清除该连接凭据。

Agent 应直接以 `node` 启动 `packages/mcp/dist/cli.mjs`，并使用该文件的绝对路径。不要将会输出任务日志的 `vp run` 作为 Agent 的 stdio transport 命令。服务应由 Agent 启动一次；手工启动用于联调，不能再让 Agent 启动第二个占用相同端口的实例。

可通过 `AINOTATION_TOKEN` 环境变量指定配对 token；用于 Agent 启动配置时，浏览器填写相同值。不要把实际 token 提交到代码仓库。其它参数：

```sh
node packages/mcp/dist/cli.mjs --port 4748 --origin http://127.0.0.1:5173
node packages/mcp/dist/cli.mjs --store /path/to/feedback.json
node packages/mcp/dist/cli.mjs --memory
```

默认允许 `http://127.0.0.1:5173` 与 `http://localhost:5173`。显式的 `--origin` 会替换默认列表，可重复指定。服务仅绑定 loopback，验证 Host、精确 Origin、Bearer token、JSON 请求和会话归属。页面 origin 与连接服务的允许列表必须一致；请求正文上限为 1 MiB。

MCP 工具包括 `ainotation_list_sessions`、`ainotation_get_feedback`、`ainotation_get_annotation`、`ainotation_create_annotation`、`ainotation_update_annotation`、`ainotation_delete_annotation` 和 `ainotation_get_schema`。浏览器连接建立页面会话后，Agent 可读取 sessionId 与标注上下文。修改操作必须明确 sessionId 与 annotationId，CRUD 变化通过 SSE 同步到浏览器并保存。

创建需要客户端提供 UUID、comment、page 和 targets，相同内容的重试不会重复创建。更新使用非空 `patch`，只接受 comment、page、targets，不能修改对话或处理状态；删除保留墓碑。`ainotation_reply`、`ainotation_acknowledge`、`ainotation_resolve`、`ainotation_dismiss` 和按处理状态筛选的工具暂不注册。内部存储层的对话能力及对应测试继续保留。

反馈同步使用稳定的客户端 ID 和持久化操作队列，重试不会重复创建，已删除 ID 有服务端墓碑，编辑不会覆盖内部保留的历史对话数据。断线期间继续编辑，重连后重试；新 SSE 连接先触发一次快照同步，漏掉的通知通过完整内部文档恢复。切换不同 MCP endpoint 时，以当前反馈创建新会话并保留标注 ID，避免另一服务的旧快照覆盖数据；旧服务的历史会话不会自动删除。

服务端默认保存到 `~/.ainotation/<port>/feedback.json`，写入采用私有权限和原子替换。一个数据文件仅支持一个写入进程，不提供文件锁或多人协作。每个服务最多 100 个会话，每个会话最多 1000 条反馈、10000 个操作 ID/墓碑；达到限制时拒绝新增，浏览器保留本地数据供导出。

## 版本管理

已配置 Changesets。实现需要记录版本影响的变更时运行 `vp run changeset`；发布准备阶段使用 `vp run version-packages`。当前未自动提交、打 tag 或发布包。

`AGENTS.md` 记录已确定的技术栈与边界。测试截图和其它本机产物位于 git 忽略目录，不参与发布。当前自动化覆盖 Chrome；里程碑一已通过 Firefox/Safari 手动验收。新增自动接入流程的浏览器回归目前使用 Chrome。闭合 Shadow DOM、iframe 内部、源码定位、动画和图片附件尚未纳入此里程碑。

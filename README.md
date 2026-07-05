# Jarvis Reader

当前版本：v1.1.1

中文说明 | [English](./README.en.md)

Jarvis Reader 是一个面向 Obsidian 的个人 EPUB 阅读插件。它把图书库、阅读进度、目录导航、划线、笔记、离线查词、AI 翻译、词汇卡片和单词本整合到同一条阅读工作流中。

插件内置 ECDICT 离线词典。选中英文单词后可直接查询，无需额外导入词典或配置本地路径。词典数据按 26 个字母分片加载，来源与许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## v1.1.1

- 取消 EPUB 正文中的浮动笔记气泡，避免分页和跨段落时出现随机漂移。
- 有笔记的划线直接通过点击下划线本身打开只读笔记窗口；右上角功能按钮保持不变，用于打开 Markdown 笔记块或追加笔记。

## v1.1.0

- 重做 EPUB 划线笔记窗口：有笔记的划线通过下划线本身打开，默认只读展示，点击右上角按钮后再追加新笔记。
- 笔记窗口支持打开对应 Markdown 笔记块，使用 Obsidian 块链接定位到 `notePath#^blockId`。
- 笔记窗口新增“笔记 / AI”分区：默认展示同一划线块中的所有笔记，AI 分区展示智能体输出和双链。
- 新增笔记写入标签统一为 `笔记`，并兼容读取旧的 `想法` 块。
- 笔记窗口视觉收敛为 Obsidian 原生风格，右上角按钮对齐词卡图标按钮样式。

## 功能亮点

- **图书库界面**：支持 Grid、List 和 3D Coverflow 三种浏览方式。
- **Frontmatter 状态同步**：图书的在读、已读、未读、评分、标签等信息可与对应 Markdown 读书笔记对齐。
- **沉浸式 EPUB 阅读**：支持分页或滚动阅读、单页或双页模式、字号、行距、目录导航和阅读位置恢复。
- **划线与笔记**：支持普通高亮、写笔记、追加笔记、打开对应 Markdown 块、侧栏筛选和跳回原文位置。
- **阅读书签**：可在阅读器中保存当前位置，并从图书详情页精确跳回 EPUB CFI 位置。
- **离线查词与 AI 翻译**：单词优先走内置 ECDICT；短语、句子或未命中内容可由用户显式触发 AI 翻译。
- **词汇资产系统**：支持保存单词、短语、句子，并保留下划线来源、悬浮词卡、掌握状态和永久删除能力。
- **词卡侧栏与单词本**：可按当前书籍或全局范围查看词汇卡片。
- **Markdown 单词识别**：已保存单词可在普通 Markdown 笔记当前可视区域内被识别并显示词卡。
- **TypeScript 源码工程**：源码位于 `src/`，根目录 `main.js` 由 esbuild 构建生成。

## 安装

1. 下载或克隆此仓库。
2. 将整个目录复制到你的 Obsidian 仓库：

```text
.obsidian/plugins/jarvis-reader
```

3. 确认目录中至少包含：

```text
main.js
manifest.json
styles.css
dictionaries/ecdict/
THIRD_PARTY_NOTICES.md
```

4. 打开 Obsidian。
5. 进入 `设置 -> 第三方插件`。
6. 如有需要，重新加载插件列表。
7. 启用 `Jarvis Reader`。

## 使用

- 点击 Obsidian 左侧栏中的 Jarvis Reader 图标打开图书库。
- 从图书库中打开 EPUB。
- 阅读时选中文本，可选择 `高亮`、`笔记`、`复制` 或 `翻译`。
- 普通高亮只保存原文；笔记会同时保存原文和你的内容到对应 Markdown 读书笔记。
- 点击有笔记的划线可直接打开只读笔记窗口。
- 笔记窗口右上角的 `pencil` 打开对应 Markdown 块，`file-pen-line` 追加笔记，`x` 关闭窗口。
- 选中英文单词时会优先显示内置 ECDICT 释义。
- 选中短语或句子后点击 `翻译`，可调用 AI 翻译。
- 保存后的翻译结果会进入词汇系统，作为单词、短语或句子卡片管理。
- 在笔记中输入 `[[笔记名]]`，可把阅读笔记连接到你的知识库。
- 可在插件设置中配置读书笔记路径、模板、AI 翻译接口和发音选项。

## 数据与隐私

Jarvis Reader 默认将数据存储在你的本地 Obsidian 仓库中。

主要数据位置：

- `data.json`：插件设置、阅读位置、阅读进度、封面缓存、书签等轻量数据。
- `index/word-assets.json`：单词、短语、句子等词汇资产的主数据。
- `index/highlights.json`：划线元数据恢复快照。
- `logs/index-changes.jsonl`：索引变更日志。
- 图书对应的 Markdown 笔记：承载划线、笔记与读书笔记投影。

这些本地数据不应提交到公开 GitHub 仓库。仓库中的 `.gitignore` 已排除常见本地数据文件。

外部 AI 翻译只会在用户显式触发时调用。内置 ECDICT 查词不需要网络连接。

## 开发

当前仓库是 TypeScript 源码工程。

常用命令：

```powershell
npm install
npm run verify
```

`npm run verify` 会依次执行：

1. TypeScript 类型检查。
2. Node 测试。
3. esbuild 生产构建。
4. `node --check main.js`。

开发规则：

- 功能改动应修改 `src/`。
- 不要手改 `main.js`，它应始终由构建流程生成。
- 发布或提交前执行 `npm run verify`。

## 仓库结构

```text
src/                    TypeScript 源码
styles.css              插件样式
main.js                 构建产物
manifest.json           Obsidian 插件清单
dictionaries/ecdict/    内置 ECDICT 分片词典
tests/                  自动化测试
README.md               中文说明
README.en.md            English README
THIRD_PARTY_NOTICES.md  第三方许可说明
```

## 近期版本

### v1.1.1

- 取消 EPUB 正文浮动气泡，改为点击下划线本身打开只读笔记窗口。
- 保留笔记窗口内打开 Markdown 块、追加笔记和关闭等按钮功能。

### v1.1.0

- EPUB 划线笔记窗口改为只读展示 + 显式追加。
- 支持从笔记窗口打开对应 Markdown 块。
- 笔记窗口新增“笔记 / AI”分区。
- 统一新笔记标签为 `笔记`，兼容旧 `想法`。

### v1.0.9

- 普通正文 DOM 选词可弹出与 Markdown 同款的离线释义、AI 翻译、保存单词卡片。
- 复用现有词卡与词条持久化链路，不新增第三方阅读器专用词条结构。
- 不为第三方阅读器增加已保存单词自动高亮扫描层；长期有价值的内容仍建议保存为本地 Markdown。

### v1.0.8

- 统一排查 Ribbon、View 标签页、侧栏按钮与内联 SVG 图标入口。
- 左侧“打开图书库”入口切回 Obsidian 原生 `library-big` 图标名。
- 补充 Obsidian 插件中使用原生 Lucide 图标的说明与源码示例。

完整历史见项目文档 `03 改动日志.md`。
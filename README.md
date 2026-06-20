# Jarvis Reader

当前版本：v1.0.2

中文说明 | [English](./README.en.md)

Jarvis Reader 是一个面?Obsidian 的个人化 EPUB 阅读插件。它把全景图书库、目录导航、阅读进度、标注想法、读书笔记、划词翻译、词句卡片和词汇本整合到同一个阅读工作流里?
插件内置 ECDICT 离线词典。选中英文单词时可直接查询，无需导入词典或配置本地路径。词典数据按首字母拆?26 个分片加载，来源与许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)?
## 当前亮点

- **全景图书?*：支持网格、列表和 3D Coverflow 三种浏览方式?- **Frontmatter 状态同?*：图书的在读、已读、未读、评分、标签等信息与对?Markdown 读书笔记对齐?- **沉浸阅读**：支?EPUB 分页/滚动、单?双页、字号、行距、目录和阅读位置恢复?- **标注与想?*：支持普通高亮、写想法、编辑、删除、侧栏筛选和跳回原文?- **阅读书签**：可在阅读器中添加书签，并从图书详情页精确跳?EPUB 段落位置?- **离线查词?AI 翻译**：单词优先查内置 ECDICT；短语、句子或未命中内容由用户手动触发 AI?- **词句卡系?*：支持单词、短语、句子保存，原文下划线恢复，悬浮词卡，已掌握标记和彻底删除?- **右侧词卡侧栏与词汇本**：可按当前书籍或全局查看词卡?- **普?Markdown 词卡识别**：已保存单词可在普?Markdown 当前 viewport 内被识别并显示词卡?- **TypeScript 源码工程**：源码位?`src/`，根目录 `main.js` ?esbuild 构建生成?
## 安装

手动安装?
1. 下载或克隆本仓库?2. 将整个文件夹复制?Obsidian 仓库?
```text
.obsidian/plugins/jarvis-reader
```

3. 确认文件夹中至少包含?
```text
main.js
manifest.json
styles.css
dictionaries/ecdict/
THIRD_PARTY_NOTICES.md
```

4. 打开 Obsidian?5. 进入 `设置 -> 第三方插件`?6. 重新加载插件列表?7. 启用 `Jarvis Reader`?
## 使用

- 点击 Obsidian 左侧功能区的 Jarvis Reader 图标打开图书库?- 从图书库打开 EPUB?- 阅读时选中文本，可选择 `高亮`、`写想法`、`复制` ?`翻译`?- 普通高亮只保存原文；写想法会保存原文和你的感想?- 点击阅读器书签按钮可保存当前位置，并可在图书详情中跳回?- 选中英文单词时优先显示内?ECDICT 释义?- 选中短语或句子后点击 `翻译` 可调?AI 翻译?- 保存后的词卡按单词、短语、句子进入词卡系统?- 在想法中输入 `[[笔记名]]`，可把读书想法连接到已有知识库?- 可在插件设置中配置读书笔记路径、模板、AI 翻译接口、发音等选项?
## 数据与隐?
Jarvis Reader 的数据默认保存在你的本地 Obsidian 仓库中?
主要数据位置?
- `data.json`：插件设置、阅读位置、阅读进度、封面缓存、书签等轻量数据?- `index/word-assets.json`：单词、短语、句子资产的主数据?- `index/highlights.json`：标?metadata 辅助恢复快照?- `logs/index-changes.jsonl`：索引变化日志?- 书籍 Markdown 笔记：标注、想法和可读投影?
这些数据不应提交到公开 GitHub 仓库。仓库中?`.gitignore` 已排除常见本地数据文件?
外部 AI 翻译只在用户明确触发时调用。内?ECDICT 查词不需要联网?
## 开?
当前仓库?TypeScript 源码工程?
常用命令?
```powershell
npm install
npm run verify
```

`npm run verify` 会依次执行：

1. TypeScript 类型检查?2. Node 测试?3. esbuild 生产构建?4. `node --check main.js`?
开发规则：

- 修改功能时编?`src/`?- `main.js` 只能由构建流程生成，不手工编辑?- 发布或提交前执行 `npm run verify`?
## 仓库结构

```text
src/                    TypeScript 源码
styles.css              插件样式
main.js                 构建产物
manifest.json           Obsidian 插件清单
dictionaries/ecdict/    内置 ECDICT 分片词典
tests/                  自动测试
README.md               中文说明
README.en.md            English README
THIRD_PARTY_NOTICES.md  第三方许可说?```

## 近期版本

### v0.7.0

- 新增阅读书签?EPUB CFI 精确跳转?- 重构全景图书库，支持 Grid、List?D Coverflow?- 阅读状态、评分、标签与 Markdown Frontmatter 对齐?- 阅读辅助边栏精简为目录和标注?- 增强多书切换时的侧栏联动?
### v0.4.0

- ?`index/word-assets.json` 设为词条唯一持久化主数据?- 内置 400,850 ?ECDICT 离线词典，按首字母分片加载?- 支持词条 Markdown 单向同步、缺失重建和彻底删除?
更完整的历史变更见项目文档中?`03 改动日志.md`?

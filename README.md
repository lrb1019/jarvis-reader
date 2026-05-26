# Jarvis Reader

当前版本：v0.1.6

中文说明 | [English](./README.en.md)

Jarvis Reader 是一个面向 Obsidian 的个人化 EPUB 阅读插件。它把书架、目录导航、阅读进度、高亮标注、读书笔记和双链想法整合到同一个阅读流程里。

## 来源与致谢

Jarvis Reader 是基于 [Awesome Reader](https://github.com/awesomedog/obsidian-awesome-reader) 的个人化改造版本。插件的基础阅读能力、EPUB 阅读框架和部分结构来自 Awesome Reader。

本仓库主要记录我围绕个人读书流做的改造，包括书架与目录布局、标注侧栏、高亮与想法、Obsidian 双链输入、阅读进度显示和界面细节调整。

上游 Awesome Reader 由 awesomedog 创建，并采用 MIT 许可证。若继续公开发布或分发本插件，应保留对原项目的署名与许可证说明。

## 功能

- 在 Obsidian 中直接打开 `.epub` 文件。
- 通过 Jarvis Reader 书架浏览 EPUB 书籍。
- 在书架、目录、标注面板之间切换。
- 支持分页阅读和连续滚动阅读。
- 支持单页和双页阅读模式。
- 按书籍记录阅读进度。
- 显示章节内页码和全书阅读百分比。
- 选中正文后创建高亮，或继续写想法。
- 将高亮原文、想法和块标识符写入同名 Markdown 读书笔记。
- 有想法的高亮在阅读区使用更明显的视觉标记。
- 在想法中使用 Obsidian 风格的 `[[双链]]`。
- 在标注预览中点击双链打开对应笔记。
- 在侧边栏按全部、高亮、想法筛选标注，并通过更多菜单筛选当前章节、有链接或切换排序。
- 单击侧边栏标注定位到正文对应位置，双击打开想法编辑窗口。
- 写入读书笔记的时间使用本地时间格式。

## 阅读进度

Jarvis Reader 使用分层进度机制：

1. 如果 EPUB 自带页表，优先显示真实全书页码。
2. 如果 EPUB 没有页表，则显示当前章节页码和全书百分比。
3. 全书百分比优先使用 EPUB locations。
4. 如果 locations 不可用，则用章节位置和章节内页码估算。

这样可以避免把“章节内页码”误当成“全书页码”。

## 安装

手动安装：

1. 下载或克隆本仓库。
2. 将整个文件夹复制到 Obsidian 仓库：

```text
.obsidian/plugins/jarvis-reader
```

3. 确认文件夹中至少包含：

```text
main.js
manifest.json
styles.css
```

4. 打开 Obsidian。
5. 进入 `设置 -> 第三方插件`。
6. 重新加载插件列表。
7. 启用 `Jarvis Reader`。

## 使用

- 点击 Obsidian 左侧功能区的 Jarvis Reader 图标打开书架。
- 从书架打开 EPUB。
- 阅读时选中文本，可选择 `高亮` 或 `写想法`。
- 普通高亮只保存原文；写想法会保存原文和你的感想。
- 在想法中输入 `[[笔记名]]`，把读书想法连接到已有知识库。
- 可在插件设置中配置读书笔记文件夹和笔记模板。

## 数据与隐私

本仓库应只包含插件代码：

```text
main.js
manifest.json
styles.css
README.md
README.en.md
```

阅读进度、高亮标注、封面缓存、插件设置等本地数据可能由 Obsidian 存储在 `data.json` 中。该文件已被 `.gitignore` 排除，不应提交到 GitHub。

## 开发说明

当前仓库保存的是插件构建后的文件，不是原始源码工程。`main.js` 是打包后的文件。

提交前建议执行：

```powershell
node --check main.js
```

推荐的 Obsidian 验证命令：

```powershell
obsidian plugin:reload id=jarvis-reader
obsidian dev:errors
```

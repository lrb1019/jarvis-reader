# EPUB 与 Claudian 禅模式布局稳定

Task: 保持选词期间正文布局稳定并保留底部禅模式。
Task type: 第三方布局适配。
User scenario: EPUB 选文后 Claudian 出现已选内容标签。
Current behavior: 标签增高输入框，工作区底部留白随之增高，正文缩小。
Reproduction: 用户截图与报告；本轮实机工具无法使用，未独立复现。
Root-cause evidence: 测试库 realclaudian/styles.css 的 claudian-zen-host padding-bottom 使用 --claudian-zen-reserved-height；其 main.js 中禅模式 ResizeObserver 每次按浮层实际高度写入该变量。Jarvis 的容器 ResizeObserver 随之调用 rendition.resize，重新显示 CFI。
Target behavior: 用户选择完全浮层；EPUB 打开时不预留禅模式底部高度，输入框、选文标签与历史向上叠加，不推动正文。
Completion criteria: 自动验证通过；测试库重载后选文标签出现／消失，正文尺寸与选区稳定，禅模式可输入，关闭 EPUB 后恢复第三方原布局。
Scope: styles.css 一条根容器 :has EPUB 的 padding-bottom 覆盖。
Explicitly excluded: 不修改 Claudian 构建文件、不改数据、不发模型请求、不部署日常库、不提交发布。
Affected data and files: styles.css；管理记录。已有 EpubReader.tsx、reader-resize.ts、tests/reader-resize.test.ts 与 main.js 修改保留，并参与本次 verify，不视为本轮新编写。
Automated verification: npm run verify 通过，218 项测试、普通／严格类型检查、生产构建、main.js 语法检查；git diff --check 通过。
Obsidian verification: 未验证；computer_use 返回 Signature verification failed for codex。需要重载测试库检查实际 CSS 优先级、选区、底部遮挡与分栏。
Failure handling: 第三方 class 更名可能使规则失效；仅布局展示，无存储写入。
Rollback: 删除本条 CSS 规则即可恢复第三方动态留白，不回退已有工作区改动。
Documents to update: 03 改动日志、04 接续说明。

## 边界与风险

- 完全浮层会遮挡底部正文，这是用户选择的布局取舍，不人为增加固定留白。
- 条件为同一工作区根内存在 EPUB leaf；分栏中的其他文档亦不再获得禅模式留白。最后一个 EPUB leaf 关闭时规则自动失效；无需监听或清理私有状态。
- 使用私有第三方 CSS 类，已在规则注释中标注不稳定性。没有隐藏已选内容标签、输入控件或历史。
- 已有延迟重排方案只防止选区期间重排，不能独立消除正文容器缩小；本次从动态留白入口处理布局原因。

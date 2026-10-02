# 本轮代码梳理证据

基线5a9be98。工具只读运行，版本与退出码见run-metadata.json。Knip的1表示存在候选；临时noUnused检查的2表示产生诊断，均不等于既有verify失败。

- knip.json：源码、测试与根目录脚本入口联合扫描。
- knip-production.json：main.ts生产入口扫描。不要把仅测试消费视为生产消费。
- dependencies.json：含编译期类型引用；dependencies-runtime.json：不包含这些引用。
- duplicates.json：原始格式扫描；duplicates-cross-format.json：临时副本统一TS/TSX格式后扫描，行号与原文件相同，文件名已映射回源码。不能据原格式零TS重复断言没有重复。
- unused-locals.txt：临时开启noUnused产生的候选，未改tsconfig。
- config-*：此次扫描配置，可供复核。Knip的宿主依赖obsidian、electron、@codemirror已明确排除，未排除epubjs。

工具安装在/private/tmp/jr-code-audit-2026-10-02，不加入项目依赖。重跑应使用run-metadata.json的版本；从项目根运行相应配置，不使用--fix或自动删除。主报告为[代码梳理与整改清单](../../plans/2026-10-02%20代码梳理与整改清单.md)。

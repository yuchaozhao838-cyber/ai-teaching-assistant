# v1.0.0 — 讲解闭环 + 习题练习 + 手机版

第一个可发布版本：把课件变成「知识点详解 + 重点划分」，还能出习题；电脑版和手机版同时提供。

## 下载

| 用途 | 文件 |
| --- | --- |
| Windows 解压即用（推荐） | `AI-Tutor-Assistant-1.0.0-win64.zip` |
| Windows 免安装单文件 | `AI-Tutor-Assistant-1.0.0-portable.exe` |
| Windows 安装版 | `AI-Tutor-Assistant-1.0.0-setup.exe` |
| 手机版（PWA，解压后跑 bat） | `AI-Tutor-Assistant-mobile-web.zip` |

> 未签名，SmartScreen 提示「未知发布者」时点「更多信息 → 仍要运行」。
> **请解压到 `C:\AI-Tutor-Assistant` 或 `D:\...`，不要放在桌面/文档/下载目录**（安全软件的防勒索 ACL 会让 Chromium 崩溃）。

## 这个版本能做什么

- **导入材料**：PDF（文本层）、Word、PPT、Markdown、TXT、HTML、公开网页抓取
- **生成讲解**：流式逐节输出「一句话结论 → 为什么 → 例子 → 易错点」，公式 KaTeX 排版
- **划重点**：必须掌握 / 理解即可 / 了解即可，每条注明出自哪一节
- **习题练习**：按材料出题、整理现成题目（自动补解析）、手写题目；答案默认收起，不强制做题
- **导出**：Word / PowerPoint / PDF / Markdown
- **两个进阶导入**：可登录网页抓取（真实浏览窗口 + 附件下载）、PDF 识图导入（视觉模型逐页转写公式）

## 已知限制

- 未做代码签名（SmartScreen 警告）
- 手机版不支持网页抓取、附件下载、Word/PPT/PDF 导出
- PDF 文本层导入会丢公式排版（用「PDF 识图导入」可保真）
- 演示模型（Demo）只用于跑通流程，不代表教学质量

## 技术栈

Electron 44 + Vue 3 + Naive UI + TypeScript；主进程 esbuild 打包，渲染层单文件 IIFE 产物；`pdfjs-dist`、`mammoth`、`docx`、`pptxgenjs`、`katex`、`zod`。

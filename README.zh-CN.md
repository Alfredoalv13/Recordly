语言: [EN](README.md) | 简中

# VybeClip

<p align="center">
  <img width="160" alt="VybeClip app icon" src="./icons/vybeclip-icon-1024.png" />
</p>

VybeClip 是一款开源桌面屏幕录制器和视频编辑器，用于制作精致的产品演示、操作讲解、教程和品牌短视频。

该应用目前正朝着首个 macOS MVP 版本推进。核心的录制与编辑引擎来自 Recordly，全新的 VybeClip Studio 体验、产品身份、项目格式和工作流程由 Box Creative Studio 维护。

## MVP 功能

- 录制显示器、窗口或应用程序，可选启用麦克风、系统音频和摄像头
- 将已有视频导入编辑器
- 添加自动或手动缩放、光标样式、背景、画面比例、裁剪、字幕、音频和注释
- 保存并重新打开 `.vybeclip` 项目
- 打开旧版 `.recordly` 和 `.openscreen` 项目
- 导出 H.264 MP4 视频，包括源画质 1080p 输出
- 从 VybeClip Studio 重新打开最近的项目

## 开发

前置要求：

- Node.js 20 或更高版本
- npm
- macOS 是当前 MVP 阶段的主要支持平台

安装依赖并启动渲染进程：

```bash
npm install
npm run dev
```

在另一个终端中启动 Electron 应用：

```bash
npx electron .
```

运行验证套件：

```bash
npm test
npx tsc --noEmit
```

构建 macOS 安装包：

```bash
npm run build:mac
```

构建产物会写入 `release/` 目录。

有关验收检查、签名、构建产物和公证的说明，请参阅 [MVP 发布指南](./_documentation/MVP_RELEASE.md)。

## macOS 权限

当录制需要时，VybeClip 会请求屏幕录制和辅助功能权限。仅在启用麦克风或摄像头采集选项时，才会请求相应权限。

在修改 macOS 隐私与安全性权限后，请退出并重新打开 VybeClip，以确保系统一致地应用该权限设置。

## 项目文件

新项目使用 `.vybeclip` 扩展名。项目会保存编辑器状态并引用其源媒体文件，但不会内嵌原始录制内容。重新打开项目时，请确保源媒体文件仍位于其原始路径。

旧版 `.recordly` 和 `.openscreen` 文件仍可用于迁移。旧版项目在被另存为新的 VybeClip 项目之前，会继续原地保存。

## 仓库

问题反馈和 MVP 相关意见请提交至 [GitHub issue 跟踪器](https://github.com/Alfredoalv13/Recordly/issues)。

## 许可证与致谢

VybeClip 基于 [GNU Affero 通用公共许可证 v3.0](./LICENSE.md) 发布。

VybeClip 基于 [Recordly](https://github.com/webadderallorg/Recordly) 开发，而 Recordly 最初由 [OpenScreen](https://github.com/siddharthvaddem/openscreen) 分叉而来。他们的工作仍是本代码库的重要组成部分，并依据本项目许可证和 Git 历史记录得以保留。

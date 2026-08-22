# 离线文字识别 · Capacitor

面向 Android 16 的纯离线证件 OCR 应用。前端使用 HTML/CSS/TypeScript，Android 原生层使用一个 Kotlin Capacitor 插件调用 RapidOCR、ONNX Runtime 和 OpenCV。

## 调用结构

```text
HTML / CSS / TypeScript
        ↓ 小型 JSON 命令与结果
Capacitor Bridge
        ↓
OcrPlugin.kt
        ↓
RapidOCR + ONNX Runtime + OpenCV
```

- Kotlin 调用系统图片选择器并持有 `content://` URI。
- 原图不转换为 Base64，也不传入 JavaScript；前端只接收压缩预览和文字结果。
- `OcrEngine` 首次识别时懒加载，并在应用进程存活期间复用。
- 不申请互联网、网络状态和存储权限，不保存图片、结果或日志历史。
- 身份证号码在 Kotlin 中完成省级代码、日期、顺序码和校验位检查。
- OCR 文字框按纵向位置合并，同一视觉行按从左到右输出；有效身份证号统一放在复制全文的第一行。
- 开发者日志默认关闭，双击页头终端图标后才采集详细阶段耗时和进程内存，关闭时跳过所有深度采样。日志开启后会记录 Java/Native/Graphics/Code/Stack 的 PSS 构成、`/proc/self/smaps` 映射分类、Native 分配区、匿名页、模型文件、线程/FD、ART GC、系统可用内存和进程 trim 状态；识别后自动在 0.5 秒、2 秒、10 秒及进后台/回前台时复测，并输出回收比例、映射增量和高水位/疑似泄漏判断。

## 目录

```text
src/main.ts                 识别主流程编排
src/ui/                     图片、结果、状态等独立界面模块
src/developer-log.ts        隐藏式开发者日志
src/memory-report.ts        内存报告格式化、增量计算和趋势判断
resources/OCR.png            网页及 Android 图标源文件
android/app/src/main/java/   MainActivity、OCR 插件和原生内存诊断
android/app/src/test/        身份证号码过滤单测
.github/workflows/           ARM64 Release 云端构建
```

`android/capacitor.settings.gradle`、`android/app/capacitor.build.gradle` 和 WebView 静态资源由 `npx cap sync android` 生成，不提交。

## GitHub Actions 构建

此目录被上一级 Tauri 仓库忽略，应作为独立仓库提交到 GitHub。进入本目录后初始化 Git，并运行工作流 `Build Capacitor Android APK`。

工作流会自动完成：

1. 安装 Node 22、Java 21、Gradle 8.14.3、Android SDK 36 和 NDK。
2. 构建 Vite 页面并同步 Capacitor Android 资源。
3. 下载官方 `OcrLibrary-0.1.0-release.aar`。
4. 运行 Kotlin 身份证过滤单测并构建 ARM64 Release APK。
5. 检查签名、联网权限、模型、ARM64 原生库和 16 KB 对齐。
6. 上传 `rapidocr-capacitor-arm64-release`，其中包含 APK 和 `apk-size-report.txt`。

未配置签名 Secrets 时会自动生成一次性评测证书。长期覆盖升级需要配置：

- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- `ANDROID_KEY_BASE64`

首次从其他签名或旧 Tauri APK 安装时，需要先卸载旧应用。两个项目使用不同 application ID，可以同时安装用于 A/B 测试。

## 内存诊断流程

1. 强制停止应用后重新打开，在第一次识别前双击页头终端图标启用日志。
2. 固定使用同一张图片，完成一次识别后等待至少 10 秒，让 0.5 秒、2 秒和 10 秒快照全部写入。
3. 重复识别 5～10 轮，每轮都等待 10 秒；不要提前开始下一轮，否则上一轮未执行的延迟采样会主动取消。
4. 完成一轮后切到另一个应用，等待约 30 秒再返回，采集后台和回前台快照。
5. 使用日志右上角复制按钮回传完整日志，重点保留 `单次推理映射增长`、`10 秒回收结论`、`趋势判断` 和 `跨轮判断`。

深度诊断会读取本进程的 `/proc/self/status`、`smaps_rollup` 和 `smaps`，只在日志开启时运行，不需要存储或网络权限。每次采样的耗时会独立写入日志，不计入 OCR 核心推理时间。

## 本机开发

项目不要求本机具备 Android/Rust 环境。具备 Node 22 时可选运行：

```powershell
npm install
npm run dev
```

浏览器中只预览页面，选图和 OCR 必须在 Android APK 中运行。首次生成 `package-lock.json` 后应将它提交到 Capacitor 独立仓库，后续 Actions 会自动改用 `npm ci`。

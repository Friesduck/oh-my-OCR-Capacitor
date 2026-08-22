# 项目交接

## 项目目标

- 使用 Vite、原生 HTML/CSS/TypeScript、Capacitor 和单个 Kotlin 插件构建 Android 16 纯离线证件 OCR。
- 保持现有 RapidOCR 模型和识别参数，展示全部文字并额外提取有效身份证号码。
- 原图由 Kotlin 直接读取，不通过 Base64 或 JavaScript Bridge 传输。
- 项目结构偏向极简、稳健，APK 仅构建 ARM64 Release。

## 当前状态

- 已建立独立 Capacitor 8.5.0 项目，application ID 为 `com.example.rapidocrcapacitor`。
- 前端使用 Vite 7、TypeScript 和 Lucide，包含选图、缩略预览、识别结果、原生剪贴板及性能/内存日志。
- `OcrPlugin.kt` 负责系统选图、25 MB 限额、图片降采样、EXIF、RapidOCR 懒加载、后台推理、身份证校验和 PSS/Heap 快照。
- Android 配置使用 Java 21、SDK 36、ARM64、R8、资源裁剪和 16 KB 兼容检查；Manifest 显式移除联网权限。
- GitHub Actions 支持自动临时签名或固定 Secrets，并输出 APK 包体分类报告。
- 使用根目录现有 `OCR.png` 生成网页图标和 Android 各密度普通/自适应图标。
- 上一级 Tauri 仓库通过 `/oh ocr Capacitor/` 忽略本项目；本项目应作为独立 Git 仓库管理。
- 按项目规则，尚未在本机安装 npm、Gradle 或 Android 依赖，完整编译和真机验证待 GitHub Actions。
- 已通过 Node TypeScript 语法、HTML DOM、Android XML、GitHub Actions YAML、图标哈希、离线调用和忽略规则静态检查；本机没有 Gradle/Kotlin 编译器，未执行原生编译。

## 下一步 TODO

- 将本目录初始化为独立 Git 仓库，推送后运行 `Build Capacitor Android APK`。
- 下载 APK 与 `apk-size-report.txt`，和 Tauri Release 使用相同图片测试冷/热耗时、PSS、准确率及后台返回。
- 根据首次 Actions 日志修复可能存在的 Capacitor/Kotlin/Gradle 集成差异。

## 工作日志

- 2026-08-22：创建 Capacitor 重构项目；新增 Vite/TypeScript 前端、Capacitor 8.5 配置、Android 16 Gradle 工程、单个 Kotlin OCR 插件、身份证过滤测试、OCR.png 各密度图标和 ARM64 Release GitHub Actions；未安装本机依赖，尚待静态检查和云端编译。
- 2026-08-22：完成静态收尾；修改 `src/main.ts`、两个项目交接文档；修复重新选图失败时前后端状态不一致和复制按钮反馈问题，确认 TypeScript 语法、DOM、XML、YAML、图标及根仓库忽略规则通过，尚待 GitHub Actions 完整编译。

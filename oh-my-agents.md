# 项目交接

## 项目目标

- 使用 Vite、原生 HTML/CSS/TypeScript、Capacitor 和单个 Kotlin 插件构建 Android 16 纯离线证件 OCR。
- 保持现有 RapidOCR 模型和识别参数，展示全部文字并额外提取有效身份证号码。
- 原图由 Kotlin 直接读取，不通过 Base64 或 JavaScript Bridge 传输。
- 项目结构偏向极简、稳健，APK 仅构建 ARM64 Release。

## 当前状态

- 已建立独立 Capacitor 8.5.0 项目，application ID 为 `com.example.rapidocrcapacitor`。
- 前端使用 Vite 7、TypeScript 和 Lucide，并按图片选择、结果展示、状态和开发者日志拆分模块；UI 已参考 `demo1.html` 收敛为极简 iOS 磨砂风格，使用紧凑层级、圆角、按压反馈和轻量入场动画。
- 支持单张或多张图片选择，最多 45 张；缩略图按选择顺序网格排列且不显示文件名，点击后由原生全屏展示，点击或返回关闭并回收 Bitmap。
- `OcrPlugin.kt` 负责系统多选、单图 25 MB 限额、逐张降采样/EXIF/推理/回收、剪贴板手机号提取、同行文字框合并、身份证校验和按需 PSS/Heap 快照。
- 已用自维护的 `OptimizedOcrEngine` 替代 AAR 旧 `OcrEngine` 调用路径：模型复制到 `noBackupFilesDir/ocr-models` 后按文件路径创建 Session，关闭 CPU arena 和 memory pattern，复用直接输入缓冲，显式释放 OpenCV `Mat`，并取消未使用的检测框 Bitmap。
- 结果区将身份证号与剪贴板手机号作为同级关键信息单行显示，下方完整展示逐图 OCR 内容；复制全部会同时复制身份证号、手机号和带分隔符的所有图片文字。
- Android 配置使用 Java 21、SDK 36、ARM64、R8、资源裁剪和 16 KB 兼容检查；Manifest 显式移除联网权限。
- GitHub Actions 支持自动临时签名或固定 Secrets，并输出 APK 包体分类报告。
- 使用根目录现有 `OCR.png` 生成网页图标和 Android 各密度普通/自适应图标。
- 上一级 Tauri 仓库通过 `/oh ocr Capacitor/` 忽略本项目；本项目应作为独立 Git 仓库管理。
- 按项目规则，尚未在本机安装 npm、Gradle 或 Android 依赖，完整编译和真机验证待 GitHub Actions。
- 已通过 Node TypeScript 语法、HTML DOM、Android XML、GitHub Actions YAML、图标哈希、离线调用和忽略规则静态检查；本机没有 Gradle/Kotlin 编译器，未执行原生编译。
- GitHub Actions 构建和 Android 真机识别已跑通；热识别端到端约 2.1～2.4 秒，Capacitor Bridge 与线程调度仅约 2～4 ms，性能瓶颈仍是 OCR 核心而非 Web 前端或 Bridge。
- 旧引擎连续识别时 Bitmap 释放后的 PSS 约 946～993 MiB、Native Heap 约 996 MiB，明显高于首次模型加载后的约 620 MiB；第 3 次相对第 2 次没有继续线性上涨，但该数据尚未验证本轮优化引擎。
- 已静态核对上游 `OcrLibrary 0.1.0` 源码：该预发布 AAR 源于 2022 年，识别路径创建大量 OpenCV `Mat` 却几乎没有显式 `release()`，ONNX Session 也使用默认内存池；这是当前 Native Heap 异常的首要嫌疑，不是 Capacitor 框架开销。
- 新一轮第 2 次热识别日志显示：推理前/后 PSS 为 712.3/1003.7 MiB，Java 图片资源释放后为 1046.6 MiB，空闲 0.5 秒为 1101.6 MiB；主要增长位于 Native 分配区和匿名页，内存明显偏高，但因本次日志缺少 2 秒、10 秒及后续轮次采样，仍不能区分稳定高水位与逐轮泄漏。
- 已进一步核实上游 `Det`、`Cls`、`Rec` 均通过 `AssetManager.open(...).readBytes()` 后调用 `createSession(byte[])`，未使用文件路径；但 0.1.0 整个 AAR 仅约 11.9 MiB，且本轮模型早已热加载，mmap 优化不能单独解释或消除本轮约 291 MiB 的推理 PSS 增量，仍应优先修补临时 `Mat` 和 ONNX 推理内存配置。
- 开发者日志默认关闭，双击页头终端图标才启用并显示；关闭时 Kotlin 跳过全部内存诊断，普通识别不承担评测采样开销。日志保留详细图片处理、OCR、Bridge、内存、结果数量和异常信息，并支持一键复制。
- 开发者日志已扩展为深度内存诊断：记录 Java/Native/Graphics/Code/Stack PSS、Native 分配区、`/proc/self/status` 与 `smaps/smaps_rollup`、模型/ONNX/OpenCV/匿名映射分类、线程/FD、ART GC、系统可用内存和进程 trim 状态；识别后自动在 0.5 秒、2 秒、10 秒及进后台/回前台时复测，并计算推理增长、资源释放回落、10 秒回收比例、跨轮稳定值和疑似高水位/泄漏趋势。
- OCR 结果根据检测框纵向重叠合并同行内容，再按横坐标从左到右拼接；多图结果保留分组并按图片编号分隔。
- Android 16 全屏模式改由原生 `WindowInsets` 提供状态栏与挖孔安全距离，WebView 下移后仍保留页面自身顶部留白，避免页头图标和文字与系统状态栏重叠。

## 下一步 TODO

- 上传 GitHub 后先确认 `OptimizedOcrEngine`、OpenCV 4.12 和 ONNX Runtime 1.23.2 云端编译通过，再做真机功能验证。
- 用同一张图片在同一进程连续识别 5～10 次，记录每次 `Java 图片资源释放后` 和 10 秒后的 PSS/Native Heap；再强制停止应用并重开，对比旧引擎并区分高水位与逐次泄漏。
- 获取 `apk-size-report.txt`，和 Tauri Release 使用相同图片比较冷/热耗时、PSS、准确率及后台返回。
- 若优化引擎 10 秒稳定值仍接近 1 GiB 或跨轮持续阶梯上涨，再评估独立 OCR 工作进程并在返回结果后退出进程。
- 不采用每次启动清应用缓存或识别后直接 `System.gc()` 作为正式方案；它们无法可靠释放 ONNX/OpenCV 原生内存。
- 通过 GitHub Actions 构建并在 Android 16 真机确认页头已完全避开状态栏和挖孔区域。
- 另用 2～4 张图片验证选择顺序、逐图结果分隔、复制全文、剪贴板手机号和全屏预览关闭回收。

## 工作日志

- 2026-08-22：创建 Capacitor 重构项目；新增 Vite/TypeScript 前端、Capacitor 8.5 配置、Android 16 Gradle 工程、单个 Kotlin OCR 插件、身份证过滤测试、OCR.png 各密度图标和 ARM64 Release GitHub Actions；未安装本机依赖，尚待静态检查和云端编译。
- 2026-08-22：完成静态收尾；修改 `src/main.ts`、两个项目交接文档；修复重新选图失败时前后端状态不一致和复制按钮反馈问题，确认 TypeScript 语法、DOM、XML、YAML、图标及根仓库忽略规则通过，尚待 GitHub Actions 完整编译。
- 2026-08-22：根据首次 Capacitor 真机日志完成性能与内存归因；修改 `oh-my-agents.md`；确认 Bridge 仅约 2～4 ms、OCR 约 1.9～2.2 秒，异常集中在上游 OCR 库的 Native Heap，静态源码存在大量 OpenCV `Mat` 未显式释放；尚待同图连续 5～10 次曲线决定修补库或隔离进程方案。
- 2026-08-22：按 `design-style-guide.md` 完成 UI 与交互重构；修改 `index.html`、`src/styles.css`、`src/main.ts`、`src/native-ocr.ts`、`OcrPlugin.kt`、Android 主题颜色和文档，新增 `src/ui/`、`src/developer-log.ts`、`TextLineComposerTest.kt`，删除旧 `src/diagnostics.ts`；实现紧凑图片点击缩放、单代码块全文复制、身份证号首行、同行文字合并和双击启用的详细日志，日志关闭时跳过 PSS 采样；TypeScript 语法、HTML ID、CSS、XML、JSON、空白和离线约束静态检查通过，未安装依赖或执行 Android 构建，待 GitHub Actions 与真机验证同行阈值和双击手势。
- 2026-08-22：分析真机约 1 GiB 内存日志并修复 Android 16 顶部安全区；修改 `MainActivity.kt`、`oh-my-agents.md`；确认高占用集中在 OCR 推理 Native Heap，高水位在后续识别中基本稳定，并用原生 `WindowInsets` 避让状态栏，尚待 Actions 编译和真机布局验证。
- 2026-08-23：扩展 Capacitor 开发者日志为深度内存归因和延迟回收测试；新增 `MemoryDiagnostics.kt`、`src/memory-report.ts`，修改 `OcrPlugin.kt`、`src/native-ocr.ts`、`src/developer-log.ts`、`README.md` 和交接文档；增加 PSS 构成、smaps 映射、Native 分配区、ART GC、系统内存、后台生命周期和 0.5/2/10 秒复测，尚待 GitHub Actions 编译与真机回传日志。
- 2026-08-23：分析 `markDown1787446657675.md.txt` 的第 2 次热识别内存数据并复核 RapidOCR 上游源码；修改 `oh-my-agents.md`；确认模型使用 `readBytes()`、推理后异常增长集中在 Native/匿名页，纠正“日志启用基线等于冷启动基线”和“mmap 是本轮最大问题”的判断，尚待完整 10 秒及 5～10 轮同图数据定性高水位或泄漏。
- 2026-08-23：完成多图、剪贴板手机号、全屏原图、极简 iOS UI 和 OCR Native 内存重构；新增 `ocr/OptimizedOcrEngine.kt`、`ocr/OcrInference.kt`、`ocr/OcrOpenCv.kt`、`ClipboardPhoneParserTest.kt`，修改 `OcrPlugin.kt`、前端模块、README 和交接文档；模型改为路径 Session，关闭 ONNX CPU arena/memory pattern，复用直接输入缓冲并显式释放临时 `Mat`，最多 45 张图片逐张识别；已通过 11 个 TypeScript 文件语法、25 个 HTML ID、结果组合样例、HTML/CSS/Kotlin 结构和 `git diff --check` 静态检查，尚待 GitHub Actions 编译及 Android 真机内存验证。

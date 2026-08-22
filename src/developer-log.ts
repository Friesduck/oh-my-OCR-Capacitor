import { NativeOcr, type RecognitionResult } from "./native-ocr";
import { requiredElement } from "./ui/dom";
import { errorMessage, formatFileSize } from "./ui/format";
import type { StatusView } from "./ui/status-view";

export type FrontendMetrics = {
  nativeCallWallMs: number;
  frontendTotalMs: number;
};

const LOG_LINE_LIMIT = 200;
const DOUBLE_CLICK_WINDOW_MS = 450;

function formatDuration(value: number): string {
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ms`;
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatPss(valueKb: number): string {
  return `${(valueKb / 1024).toFixed(1)} MiB`;
}

function memoryStageLabel(stage: string, modelWasLoaded: boolean): string {
  const labels: Record<string, string> = {
    requestReceived: "Kotlin 收到请求",
    imageBytesRead: "原图读取后",
    imageReady: "图片解码后",
    engineReady: modelWasLoaded ? "热模型推理前" : "冷模型加载前",
    inferenceComplete: modelWasLoaded ? "热模型推理后" : "冷模型加载后",
    resourcesReleased: "Bitmap 释放后",
  };
  return labels[stage] ?? stage;
}

export class DeveloperLog {
  private readonly section = requiredElement<HTMLElement>("#developer-log");
  private readonly toggleButton = requiredElement<HTMLButtonElement>("#developer-toggle");
  private readonly copyButton = requiredElement<HTMLButtonElement>("#copy-log");
  private readonly clearButton = requiredElement<HTMLButtonElement>("#clear-log");
  private readonly output = requiredElement<HTMLElement>("#session-log");
  private readonly lines: string[] = [];
  private lastToggleClickAt = 0;
  private active = false;
  private toggling = false;

  constructor(private readonly status: StatusView) {
    this.toggleButton.addEventListener("click", () => this.handleToggleClick());
    this.copyButton.addEventListener("click", () => void this.copy());
    this.clearButton.addEventListener("click", () => this.clear());
  }

  get enabled(): boolean {
    return this.active;
  }

  async initialize(): Promise<void> {
    try {
      await NativeOcr.setDiagnosticsEnabled({ enabled: false });
    } catch {
      // 浏览器预览或原生插件尚未就绪时保持默认关闭即可。
    }
  }

  recordSelection(fileName: string | undefined, sizeBytes: number | undefined): void {
    this.append(`图片已选择：${fileName || "未命名"}，${formatFileSize(sizeBytes)}`);
  }

  recordRecognitionStart(sequence: number): void {
    this.append(`第 ${sequence} 次识别开始`);
  }

  recordRecognitionFailure(sequence: number, elapsedMs: number, message: string): void {
    this.append(`第 ${sequence} 次识别失败（+${formatDuration(elapsedMs)}）：${message}`);
  }

  recordRecognitionSuccess(result: RecognitionResult, frontend: FrontendMetrics): void {
    const { metrics } = result;
    const modelState = metrics.modelWasLoaded ? "热启动" : "冷启动";
    const bridgeOverheadMs = Math.max(0, frontend.nativeCallWallMs - metrics.nativeTotalMs);

    metrics.memorySnapshots.forEach((snapshot) => {
      const stage = memoryStageLabel(snapshot.stage, metrics.modelWasLoaded);
      this.append(
        `内存·${stage}（+${formatDuration(snapshot.elapsedMs)}）：` +
          `PSS ${formatPss(snapshot.totalPssKb)}，` +
          `Java ${formatBytes(snapshot.javaHeapUsedBytes)}/${formatBytes(snapshot.javaHeapMaxBytes)}，` +
          `Native ${formatBytes(snapshot.nativeHeapAllocatedBytes)}`,
      );
    });

    this.append(`模型状态：${modelState}`);
    this.append(
      `图片处理：读取 ${formatDuration(metrics.imageReadMs)}，` +
        `解码 ${formatDuration(metrics.imageDecodeMs)}，方向校正 ${formatDuration(metrics.orientationMs)}`,
    );
    this.append(
      `OCR：引擎 ${formatDuration(metrics.engineInitMs)}，` +
        `推理 ${formatDuration(metrics.inferenceWallMs)}，库内统计 ${formatDuration(result.elapsedMs)}，` +
        `结果处理 ${formatDuration(metrics.postprocessMs)}`,
    );
    this.append(
      `调用：Kotlin ${formatDuration(metrics.nativeTotalMs)}，` +
        `Bridge/线程约 ${formatDuration(bridgeOverheadMs)}，` +
        `端到端 ${formatDuration(frontend.frontendTotalMs)}`,
    );
    this.append(`结果：${result.textLines.length} 行文字，${result.idNumbers.length} 个有效身份证号`);
  }

  append(message: string): void {
    if (!this.active) return;

    const line = `${new Date().toISOString()}  ${message}`;
    this.lines.push(line);
    if (this.lines.length > LOG_LINE_LIMIT) this.lines.splice(0, this.lines.length - LOG_LINE_LIMIT);
    this.output.textContent = this.lines.join("\n");
    this.copyButton.disabled = false;
    this.output.scrollTop = this.output.scrollHeight;
  }

  private handleToggleClick(): void {
    const now = performance.now();
    if (now - this.lastToggleClickAt <= DOUBLE_CLICK_WINDOW_MS) {
      this.lastToggleClickAt = 0;
      void this.toggle();
      return;
    }
    this.lastToggleClickAt = now;
  }

  private async toggle(): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;
    this.toggleButton.disabled = true;
    const nextState = !this.active;

    try {
      await NativeOcr.setDiagnosticsEnabled({ enabled: nextState });
      if (!nextState) this.append("开发者日志已关闭");
      this.active = nextState;
      this.section.hidden = !nextState;
      this.toggleButton.classList.toggle("active", nextState);
      this.toggleButton.setAttribute("aria-pressed", String(nextState));
      if (nextState) this.append("开发者日志已启用；开始采集详细流程和内存数据");
    } catch (error) {
      this.status.show(`日志切换失败：${errorMessage(error)}`, "error");
    } finally {
      this.toggleButton.disabled = false;
      this.toggling = false;
    }
  }

  private clear(): void {
    this.lines.length = 0;
    this.output.textContent = "";
    this.copyButton.disabled = true;
  }

  private async copy(): Promise<void> {
    if (this.lines.length === 0) return;

    try {
      await NativeOcr.copyText({ value: this.lines.join("\n") });
      this.copyButton.classList.add("copied");
      window.setTimeout(() => this.copyButton.classList.remove("copied"), 1200);
    } catch (error) {
      this.status.show(`日志复制失败：${errorMessage(error)}`, "error");
    }
  }
}

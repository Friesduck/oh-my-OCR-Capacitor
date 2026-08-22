import { NativeOcr, type RecognitionResult } from "./native-ocr";

type FrontendMetrics = {
  nativeCallWallMs: number;
  frontendTotalMs: number;
};

const diagnosticsSection = document.querySelector<HTMLElement>("#diagnostics")!;
const metricsSummary = document.querySelector<HTMLElement>("#metrics-summary")!;
const timingDetails = document.querySelector<HTMLElement>("#timing-details")!;
const memoryTableBody = document.querySelector<HTMLElement>("#memory-table-body")!;
const sessionLog = document.querySelector<HTMLOListElement>("#session-log")!;
const copyButton = document.querySelector<HTMLButtonElement>("#copy-diagnostics")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear-diagnostics")!;
const status = document.querySelector<HTMLElement>("#status")!;

const SESSION_LOG_LIMIT = 120;
let sessionLogLines: string[] = [];

export function formatDuration(value: number): string {
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ms`;
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatPss(valueKb: number): string {
  return `${(valueKb / 1024).toFixed(1)} MiB`;
}

function formatLogTime(date: Date): string {
  const milliseconds = date.getMilliseconds().toString().padStart(3, "0");
  return `${date.toLocaleTimeString("zh-CN", { hour12: false })}.${milliseconds}`;
}

export function appendDiagnosticLog(message: string): void {
  const now = new Date();
  const row = document.createElement("li");
  const time = document.createElement("time");
  const content = document.createElement("span");

  time.dateTime = now.toISOString();
  time.textContent = formatLogTime(now);
  content.textContent = message;
  row.append(time, content);
  sessionLog.append(row);

  sessionLogLines.push(`${now.toISOString()}  ${message}`);
  if (sessionLogLines.length > SESSION_LOG_LIMIT) {
    sessionLogLines = sessionLogLines.slice(-SESSION_LOG_LIMIT);
    sessionLog.firstElementChild?.remove();
  }

  copyButton.disabled = false;
  sessionLog.scrollTop = sessionLog.scrollHeight;
}

function renderSummary(items: Array<[string, string]>): void {
  const fragment = document.createDocumentFragment();
  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    item.className = "metric-item";
    term.textContent = label;
    detail.textContent = value;
    item.append(term, detail);
    fragment.append(item);
  });
  metricsSummary.replaceChildren(fragment);
}

function renderTimings(items: Array<[string, number]>): void {
  const fragment = document.createDocumentFragment();
  items.forEach(([label, value]) => {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = formatDuration(value);
    fragment.append(term, detail);
  });
  timingDetails.replaceChildren(fragment);
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

export function beginDiagnostics(sequence: number, startedAt: Date): void {
  diagnosticsSection.hidden = false;
  memoryTableBody.replaceChildren();
  timingDetails.replaceChildren();
  renderSummary([
    ["检测序号", `#${sequence}`],
    ["检测时间", startedAt.toLocaleString("zh-CN", { hour12: false })],
    ["当前状态", "测量中"],
  ]);
  appendDiagnosticLog(`第 ${sequence} 次识别开始`);
}

export function renderDiagnosticFailure(
  sequence: number,
  startedAt: Date,
  elapsedMs: number,
  message: string,
): void {
  renderSummary([
    ["检测序号", `#${sequence}`],
    ["检测时间", startedAt.toLocaleString("zh-CN", { hour12: false })],
    ["当前状态", "失败"],
    ["失败前耗时", formatDuration(elapsedMs)],
  ]);
  appendDiagnosticLog(`第 ${sequence} 次识别失败：${message}`);
}

export function renderDiagnostics(result: RecognitionResult, frontend: FrontendMetrics): void {
  const { metrics } = result;
  const peakPssKb = Math.max(0, ...metrics.memorySnapshots.map((item) => item.totalPssKb));
  const bridgeOverheadMs = Math.max(0, frontend.nativeCallWallMs - metrics.nativeTotalMs);
  const modelState = metrics.modelWasLoaded ? "热启动" : "冷启动";

  renderSummary([
    ["检测时间", new Date(metrics.startedAtEpochMs).toLocaleString("zh-CN", { hour12: false })],
    ["模型状态", modelState],
    ["端到端", formatDuration(frontend.frontendTotalMs)],
    ["OCR 核心", formatDuration(result.elapsedMs)],
    ["峰值 PSS", formatPss(peakPssKb)],
  ]);

  renderTimings([
    ["Capacitor 原生调用", frontend.nativeCallWallMs],
    ["Bridge 与线程调度估算", bridgeOverheadMs],
    ["Kotlin 读取原图", metrics.imageReadMs],
    ["Android 图片解码", metrics.imageDecodeMs],
    ["EXIF 方向校正", metrics.orientationMs],
    ["引擎创建或复用", metrics.engineInitMs],
    [metrics.modelWasLoaded ? "热模型推理" : "冷模型加载及推理", metrics.inferenceWallMs],
    ["OCR 库内部统计", result.elapsedMs],
    ["Kotlin 结果处理", metrics.postprocessMs],
    ["Kotlin 原生总耗时", metrics.nativeTotalMs],
    ["前端端到端总耗时", frontend.frontendTotalMs],
  ]);

  const rows = document.createDocumentFragment();
  metrics.memorySnapshots.forEach((snapshot) => {
    const row = document.createElement("tr");
    const stage = document.createElement("td");
    const pss = document.createElement("td");
    const javaHeap = document.createElement("td");
    const nativeHeap = document.createElement("td");
    const stageLabel = memoryStageLabel(snapshot.stage, metrics.modelWasLoaded);

    stage.textContent = `${stageLabel} (+${formatDuration(snapshot.elapsedMs)})`;
    pss.textContent = formatPss(snapshot.totalPssKb);
    javaHeap.textContent = `${formatBytes(snapshot.javaHeapUsedBytes)} / ${formatBytes(snapshot.javaHeapMaxBytes)}`;
    nativeHeap.textContent = formatBytes(snapshot.nativeHeapAllocatedBytes);
    row.append(stage, pss, javaHeap, nativeHeap);
    rows.append(row);

    appendDiagnosticLog(
      `内存·${stageLabel}（+${formatDuration(snapshot.elapsedMs)}）：` +
        `PSS ${formatPss(snapshot.totalPssKb)}，` +
        `Java ${formatBytes(snapshot.javaHeapUsedBytes)}/${formatBytes(snapshot.javaHeapMaxBytes)}，` +
        `Native ${formatBytes(snapshot.nativeHeapAllocatedBytes)}`,
    );
  });
  memoryTableBody.replaceChildren(rows);

  appendDiagnosticLog(
    `模型状态：${modelState}；${metrics.modelWasLoaded ? "仅执行推理" : "首次推理包含 ONNX 模型加载"}`,
  );
  appendDiagnosticLog(
    `耗时：端到端 ${formatDuration(frontend.frontendTotalMs)}，` +
      `原生调用 ${formatDuration(frontend.nativeCallWallMs)}，OCR ${formatDuration(result.elapsedMs)}`,
  );
  appendDiagnosticLog(`Bridge 与线程调度估算：${formatDuration(bridgeOverheadMs)}；原图未经过 Base64`);
}

copyButton.addEventListener("click", async () => {
  if (sessionLogLines.length === 0) return;

  try {
    await NativeOcr.copyText({ value: sessionLogLines.join("\n") });
    copyButton.classList.add("copied");
    window.setTimeout(() => copyButton.classList.remove("copied"), 1200);
  } catch {
    status.textContent = "日志复制失败，请稍后重试";
    status.dataset.tone = "error";
  }
});

clearButton.addEventListener("click", () => {
  sessionLogLines = [];
  sessionLog.replaceChildren();
  metricsSummary.replaceChildren();
  timingDetails.replaceChildren();
  memoryTableBody.replaceChildren();
  copyButton.disabled = true;
  diagnosticsSection.hidden = true;
});

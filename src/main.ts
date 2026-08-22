import { Capacitor } from "@capacitor/core";
import {
  ClipboardCopy,
  Copy,
  ImagePlus,
  ScanText,
  Trash2,
  X,
  createIcons,
} from "lucide";
import {
  appendDiagnosticLog,
  beginDiagnostics,
  renderDiagnosticFailure,
  renderDiagnostics,
} from "./diagnostics";
import { NativeOcr, type RecognitionResult } from "./native-ocr";
import "./styles.css";

const selectButton = document.querySelector<HTMLButtonElement>("#select-image")!;
const selectLabel = document.querySelector<HTMLElement>("#select-label")!;
const selectDetail = document.querySelector<HTMLElement>("#select-detail")!;
const previewShell = document.querySelector<HTMLElement>("#preview-shell")!;
const preview = document.querySelector<HTMLImageElement>("#preview")!;
const imageName = document.querySelector<HTMLElement>("#image-name")!;
const imageMeta = document.querySelector<HTMLElement>("#image-meta")!;
const removeButton = document.querySelector<HTMLButtonElement>("#remove-image")!;
const recognizeButton = document.querySelector<HTMLButtonElement>("#recognize")!;
const recognizeLabel = document.querySelector<HTMLElement>("#recognize-label")!;
const status = document.querySelector<HTMLElement>("#status")!;
const resultsSection = document.querySelector<HTMLElement>("#results")!;
const idList = document.querySelector<HTMLElement>("#id-list")!;
const idCount = document.querySelector<HTMLElement>("#id-count")!;
const textLines = document.querySelector<HTMLElement>("#text-lines")!;
const copyAllButton = document.querySelector<HTMLButtonElement>("#copy-all")!;

let hasSelection = false;
let latestText = "";
let recognitionSequence = 0;

function refreshIcons(): void {
  createIcons({
    icons: { ClipboardCopy, Copy, ImagePlus, ScanText, Trash2, X },
    attrs: {
      width: "18",
      height: "18",
      "stroke-width": "1.8",
    },
  });
}

function formatFileSize(value?: number): string {
  if (!value || value < 1) return "大小未知";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error || "未知错误");
}

function setStatus(message: string, tone: "normal" | "success" | "error" = "normal"): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

function resetResults(): void {
  resultsSection.hidden = true;
  idList.replaceChildren();
  textLines.replaceChildren();
  copyAllButton.disabled = true;
  latestText = "";
}

async function clearSelection(): Promise<void> {
  hasSelection = false;
  preview.removeAttribute("src");
  previewShell.hidden = true;
  imageName.textContent = "";
  imageMeta.textContent = "";
  selectLabel.textContent = "选择一张图片";
  selectDetail.textContent = "单张 · 最大 25 MB";
  recognizeButton.disabled = true;
  resetResults();
  setStatus("");

  try {
    await NativeOcr.clearSelection();
  } catch {
    // 页面状态已经清空；原生进程重建时可能没有可清理的选择。
  }
}

async function copyValue(value: string, button: HTMLButtonElement): Promise<void> {
  if (!value) return;

  try {
    await NativeOcr.copyText({ value });
    button.classList.add("copied");
    setStatus("文字已复制", "success");
    window.setTimeout(() => button.classList.remove("copied"), 1200);
  } catch (error) {
    setStatus(`复制失败：${errorMessage(error)}`, "error");
  }
}

function appendCopyIcon(button: HTMLButtonElement): void {
  const icon = document.createElement("i");
  icon.dataset.lucide = "copy";
  icon.setAttribute("aria-hidden", "true");
  button.prepend(icon);
}

function renderResult(result: RecognitionResult): void {
  idList.replaceChildren();
  textLines.replaceChildren();

  if (result.idNumbers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-result";
    empty.textContent = "未识别到有效身份证号";
    idList.append(empty);
    idCount.textContent = "0 个";
  } else {
    idCount.textContent = `${result.idNumbers.length} 个`;
    result.idNumbers.forEach((number, index) => {
      const row = document.createElement("div");
      row.className = index === 0 ? "id-row primary" : "id-row";

      const value = document.createElement("span");
      value.className = "id-value";
      value.textContent = number;

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "copy-button";
      copyButton.textContent = "复制";
      copyButton.addEventListener("click", () => void copyValue(number, copyButton));
      appendCopyIcon(copyButton);

      row.append(value, copyButton);
      idList.append(row);
    });
  }

  latestText = result.textLines.join("\n");
  if (result.textLines.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-result";
    empty.textContent = "未识别到文字";
    textLines.append(empty);
    copyAllButton.disabled = true;
  } else {
    result.textLines.forEach((line) => {
      const row = document.createElement("p");
      row.textContent = line;
      textLines.append(row);
    });
    copyAllButton.disabled = false;
  }

  resultsSection.hidden = false;
  refreshIcons();
}

selectButton.addEventListener("click", async () => {
  selectButton.disabled = true;
  selectButton.classList.add("busy");
  selectLabel.textContent = "正在打开图片…";
  setStatus("");

  try {
    const selection = await NativeOcr.pickImage();
    if (selection.cancelled) {
      selectLabel.textContent = hasSelection ? "重新选择图片" : "选择一张图片";
      return;
    }
    if (!selection.previewDataUrl) throw new Error("原生端没有返回图片预览");

    hasSelection = true;
    preview.src = selection.previewDataUrl;
    imageName.textContent = selection.fileName || "已选择图片";
    imageMeta.textContent = `${selection.mimeType || "图片"} · ${formatFileSize(selection.sizeBytes)}`;
    previewShell.hidden = false;
    selectLabel.textContent = "重新选择图片";
    selectDetail.textContent = "图片已就绪";
    recognizeButton.disabled = false;
    resetResults();
    setStatus("图片已就绪", "success");
    appendDiagnosticLog(`已选择图片：${formatFileSize(selection.sizeBytes)}`);
  } catch (error) {
    await clearSelection();
    setStatus(errorMessage(error), "error");
  } finally {
    selectButton.disabled = false;
    selectButton.classList.remove("busy");
  }
});

removeButton.addEventListener("click", () => void clearSelection());

recognizeButton.addEventListener("click", async () => {
  if (!hasSelection) return;

  recognitionSequence += 1;
  const sequence = recognitionSequence;
  const startedAt = new Date();
  const frontendStartedAt = performance.now();
  beginDiagnostics(sequence, startedAt);
  recognizeButton.disabled = true;
  selectButton.disabled = true;
  removeButton.disabled = true;
  recognizeButton.classList.add("busy");
  recognizeLabel.textContent = "正在识别";
  resetResults();
  setStatus("正在加载模型并识别…");

  try {
    const nativeCallStartedAt = performance.now();
    const result = await NativeOcr.recognizeSelected();
    const nativeCallWallMs = performance.now() - nativeCallStartedAt;
    const frontendTotalMs = performance.now() - frontendStartedAt;

    renderResult(result);
    renderDiagnostics(result, { nativeCallWallMs, frontendTotalMs });
    setStatus(`识别完成，用时 ${(frontendTotalMs / 1000).toFixed(2)} 秒`, "success");
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    const message = errorMessage(error);
    const elapsedMs = performance.now() - frontendStartedAt;
    renderDiagnosticFailure(sequence, startedAt, elapsedMs, message);
    setStatus(message, "error");
  } finally {
    recognizeButton.disabled = !hasSelection;
    selectButton.disabled = false;
    removeButton.disabled = false;
    recognizeButton.classList.remove("busy");
    recognizeLabel.textContent = "开始识别";
  }
});

copyAllButton.addEventListener("click", () => void copyValue(latestText, copyAllButton));

refreshIcons();

if (!Capacitor.isNativePlatform()) {
  selectButton.disabled = true;
  setStatus("图片和 OCR 功能仅在 Android APK 中运行", "error");
}

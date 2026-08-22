import { NativeOcr, type RecognitionResult } from "../native-ocr";
import { requiredElement } from "./dom";
import { composeRecognitionText, errorMessage } from "./format";
import type { StatusView } from "./status-view";

export class ResultPanel {
  private readonly section = requiredElement<HTMLElement>("#results");
  private readonly output = requiredElement<HTMLElement>("#ocr-output");
  private readonly copyButton = requiredElement<HTMLButtonElement>("#copy-all");
  private text = "";

  constructor(private readonly status: StatusView) {
    this.copyButton.addEventListener("click", () => void this.copy());
  }

  reset(): void {
    this.text = "";
    this.output.textContent = "";
    this.copyButton.disabled = true;
    this.section.hidden = true;
  }

  render(result: RecognitionResult): void {
    this.text = composeRecognitionText(result);
    this.output.textContent = this.text || "未识别到文字";
    this.copyButton.disabled = !this.text;
    this.section.hidden = false;
  }

  scrollIntoView(): void {
    this.section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  private async copy(): Promise<void> {
    if (!this.text) return;

    try {
      await NativeOcr.copyText({ value: this.text });
      this.copyButton.classList.add("copied");
      this.status.show("全文已复制", "success");
      window.setTimeout(() => this.copyButton.classList.remove("copied"), 1200);
    } catch (error) {
      this.status.show(`复制失败：${errorMessage(error)}`, "error");
    }
  }
}

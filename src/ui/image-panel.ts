import { NativeOcr, type PickImageResult } from "../native-ocr";
import { requiredElement } from "./dom";
import { errorMessage, formatFileSize } from "./format";

type ImagePanelHooks = {
  onSelected: (selection: PickImageResult) => void;
  onCleared: () => void;
  onError: (message: string) => void;
};

export class ImagePanel {
  private readonly selectButton = requiredElement<HTMLButtonElement>("#select-image");
  private readonly selectLabel = requiredElement<HTMLElement>("#select-label");
  private readonly selectDetail = requiredElement<HTMLElement>("#select-detail");
  private readonly previewShell = requiredElement<HTMLElement>("#preview-shell");
  private readonly previewToggle = requiredElement<HTMLButtonElement>("#preview-toggle");
  private readonly preview = requiredElement<HTMLImageElement>("#preview");
  private readonly imageName = requiredElement<HTMLElement>("#image-name");
  private readonly imageMeta = requiredElement<HTMLElement>("#image-meta");
  private readonly removeButton = requiredElement<HTMLButtonElement>("#remove-image");
  private selected = false;

  constructor(private readonly hooks: ImagePanelHooks) {
    this.selectButton.addEventListener("click", () => void this.pickImage());
    this.removeButton.addEventListener("click", () => void this.clear());
    this.previewToggle.addEventListener("click", () => this.togglePreview());
  }

  get hasSelection(): boolean {
    return this.selected;
  }

  setLocked(locked: boolean): void {
    this.selectButton.disabled = locked;
    this.removeButton.disabled = locked;
  }

  private async pickImage(): Promise<void> {
    this.selectButton.disabled = true;
    this.selectLabel.textContent = "正在打开图片";

    try {
      const selection = await NativeOcr.pickImage();
      if (selection.cancelled) {
        this.selectLabel.textContent = this.selected ? "更换图片" : "选择图片";
        return;
      }
      if (!selection.previewDataUrl) throw new Error("原生端没有返回图片预览");

      this.selected = true;
      this.preview.src = selection.previewDataUrl;
      this.imageName.textContent = selection.fileName || "已选择图片";
      this.imageMeta.textContent = `${selection.mimeType || "图片"} · ${formatFileSize(selection.sizeBytes)}`;
      this.previewShell.hidden = false;
      this.selectLabel.textContent = "更换图片";
      this.selectDetail.textContent = "已选择，可直接开始识别";
      this.collapsePreview();
      this.hooks.onSelected(selection);
    } catch (error) {
      this.resetView();
      await this.clearNativeSelection();
      this.hooks.onError(errorMessage(error));
    } finally {
      this.selectButton.disabled = false;
    }
  }

  private async clear(): Promise<void> {
    this.resetView();
    this.hooks.onCleared();
    await this.clearNativeSelection();
  }

  private async clearNativeSelection(): Promise<void> {
    try {
      await NativeOcr.clearSelection();
    } catch {
      // 页面已经清空；原生进程重建时可能没有可清理的选择。
    }
  }

  private togglePreview(): void {
    const expanded = !this.previewShell.classList.contains("expanded");
    this.previewShell.classList.toggle("expanded", expanded);
    this.previewToggle.setAttribute("aria-expanded", String(expanded));
    this.previewToggle.setAttribute("aria-label", expanded ? "缩小图片预览" : "放大图片预览");
  }

  private collapsePreview(): void {
    this.previewShell.classList.remove("expanded");
    this.previewToggle.setAttribute("aria-expanded", "false");
    this.previewToggle.setAttribute("aria-label", "放大图片预览");
  }

  private resetView(): void {
    this.selected = false;
    this.preview.removeAttribute("src");
    this.previewShell.hidden = true;
    this.imageName.textContent = "";
    this.imageMeta.textContent = "";
    this.selectLabel.textContent = "选择图片";
    this.selectDetail.textContent = "JPG、PNG、WEBP · 最大 25 MB";
    this.collapsePreview();
  }
}

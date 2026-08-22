import { registerPlugin } from "@capacitor/core";

export type MemorySnapshot = {
  stage: string;
  elapsedMs: number;
  javaHeapUsedBytes: number;
  javaHeapMaxBytes: number;
  nativeHeapAllocatedBytes: number;
  totalPssKb: number;
};

export type RecognitionMetrics = {
  startedAtEpochMs: number;
  modelWasLoaded: boolean;
  imageReadMs: number;
  imageDecodeMs: number;
  orientationMs: number;
  engineInitMs: number;
  inferenceWallMs: number;
  postprocessMs: number;
  nativeTotalMs: number;
  memorySnapshots: MemorySnapshot[];
};

export type RecognitionResult = {
  idNumbers: string[];
  textLines: string[];
  elapsedMs: number;
  metrics: RecognitionMetrics;
};

export type PickImageResult = {
  cancelled: boolean;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  previewDataUrl?: string;
};

type NativeOcrPlugin = {
  pickImage(): Promise<PickImageResult>;
  recognizeSelected(): Promise<RecognitionResult>;
  clearSelection(): Promise<void>;
  copyText(options: { value: string }): Promise<void>;
};

export const NativeOcr = registerPlugin<NativeOcrPlugin>("NativeOcr");

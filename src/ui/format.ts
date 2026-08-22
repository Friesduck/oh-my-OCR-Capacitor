import type { RecognitionResult } from "../native-ocr";

export function formatFileSize(value?: number): string {
  if (!value || value < 1) return "大小未知";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error || "未知错误");
}

function cleanLine(value: string): string {
  return value.replace(/[\t ]+/g, " ").trim();
}

function isIdentifierOnly(value: string, identifiers: Set<string>): boolean {
  const compact = value.replace(/[\s\-－—·]/g, "").toUpperCase();
  return identifiers.has(compact);
}

export function composeRecognitionText(result: RecognitionResult): string {
  const identifiers = [...new Set(result.idNumbers.map(cleanLine).filter(Boolean))];
  const identifierSet = new Set(identifiers.map((value) => value.toUpperCase()));
  const bodyLines = result.textLines
    .map(cleanLine)
    .filter((line) => line && !isIdentifierOnly(line, identifierSet));

  const lines = identifiers.length > 0 ? [identifiers.join(" "), ...bodyLines] : bodyLines;
  return lines.join("\n");
}

import { API_BASE } from "./config";

function filenameFromPath(path: string): string {
  const filename = path.replaceAll("\\", "/").split("/").at(-1)?.trim();
  return filename || "session.jsonl";
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;

  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
    } catch {
      // Fall through to the plain filename parameter when a server sends malformed metadata.
    }
  }

  const plain = value.match(/filename="?([^";]+)"?/i)?.[1]?.trim();
  return plain || null;
}

export async function downloadSession(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/session/download?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((body as { error?: string }).error ?? response.statusText);
  }

  const blob = await response.blob();
  const filename =
    filenameFromContentDisposition(response.headers.get("Content-Disposition")) ??
    filenameFromPath(path);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

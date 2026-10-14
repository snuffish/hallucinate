// Hands a file to the browser's download (recordings, settings exports and their backups).

export function downloadFile(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// A file-name-safe timestamp, e.g. 2026-10-14T21-03-11-123Z.
export const fileStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-');

// A cheap fingerprint of a scene's code (FNV-1a), enough to tell "unchanged" from "changed".
export function codeHash(code: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) h = Math.imul(h ^ code.charCodeAt(i), 0x01000193);
  return `${code.length.toString(36)}-${(h >>> 0).toString(36)}`;
}

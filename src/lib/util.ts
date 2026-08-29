export function normalizeEnvValue(value: string | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^\[|\]$/g, "");
}

export function formatTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function maskValue(value: string, visible = 4): string {
  if (!value) return "";
  if (value.length <= visible) return "•".repeat(value.length);
  return value.slice(0, visible) + "•".repeat(Math.min(value.length - visible, 20));
}

export function isDebug(): boolean {
  return (
    normalizeEnvValue(process.env.DEBUG) === "1" ||
    normalizeEnvValue(process.env.DEBUG)?.toLowerCase() === "true"
  );
}

export function debugLog(...args: unknown[]): void {
  if (isDebug()) console.log(...args);
}

export function digitCount(value: string): number {
  return (value.match(/\d/g) || []).length;
}

export function isValidPhone(value: string): boolean {
  return digitCount(value) >= 10;
}

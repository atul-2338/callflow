export async function parseWebhookFields(
  request: Request
): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const out: Record<string, string> = {};
    formData.forEach((value, key) => {
      out[key] = String(value);
    });
    return out;
  }

  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, string>;
  }

  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

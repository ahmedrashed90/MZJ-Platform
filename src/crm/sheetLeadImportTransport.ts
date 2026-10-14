/**
 * Bounded CRM sheet-import transport. An aborted request can still have committed
 * a lead in Neon; retrying is safe because the server deduplicates by phone
 * BEFORE choosing a representative. A request must never spin indefinitely.
 */
export class SheetLeadTransportError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly status: number = 0) {
    super(message);
    this.name = "SheetLeadTransportError";
  }
}

export type SheetLeadTransportOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, maxAttempts: number, error: SheetLeadTransportError) => void;
};

const sleep = (duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration));
const DEFAULT_TIMEOUT_MS = 25_000;

export async function postSheetLeadRequest<T extends { ok?: boolean }>(
  body: Record<string, unknown>,
  options: SheetLeadTransportOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl || fetch)("/api/crm/sheet-leads", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body), signal: controller.signal,
      });
    } catch {
      const timedOut = controller.signal.aborted;
      throw new SheetLeadTransportError(timedOut
        ? `انتهت مهلة انتظار دفعة CRM بعد ${Math.round(timeoutMs / 1000)} ثانية؛ سيُعاد التحقق من الأرقام بأمان.`
        : "انقطع الاتصال بخادم CRM؛ ستتم إعادة التحقق من الأرقام دون تغيير توزيعها.", true);
    }
    let payload: (T & { error?: string; message?: string }) | null;
    try { payload = await response.json(); }
    catch { payload = null; }
    if (!response.ok || !payload || payload.ok === false) {
      const status = response.status;
      const reference = response.headers.get("x-vercel-id") || response.headers.get("x-request-id");
      const fallback = [502, 503, 504].includes(status)
        ? "انتهت مهلة خادم CRM أو تعذر الاتصال به مؤقتًا"
        : `تعذر الاستيراد (HTTP ${status})`;
      const reason = payload?.error || payload?.message || fallback;
      const retryable = !payload || [408, 423, 429, 500, 502, 503, 504].includes(status);
      throw new SheetLeadTransportError(`${reason} (HTTP ${status}${reference ? `، مرجع: ${reference}` : ""})`, retryable, status);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function retrySheetLeadRequest<T extends { ok?: boolean }>(
  body: Record<string, unknown>,
  options: SheetLeadTransportOptions = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(6, options.maxAttempts ?? 4));
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await postSheetLeadRequest<T>(body, options);
    } catch (error) {
      const failure = error instanceof SheetLeadTransportError
        ? error : new SheetLeadTransportError(error instanceof Error ? error.message : "تعذر الاتصال", true);
      if (!failure.retryable || index === attempts - 1) throw failure;
      options.onRetry?.(index + 2, attempts, failure);
      await (options.sleep || sleep)(Math.min(7_000, 1_500 * (index + 1)));
    }
  }
  throw new SheetLeadTransportError("تعذر إكمال دفعة CRM", true);
}

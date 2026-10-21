/** Google Ads REST access. No developer-token header is required after the 2026 sunset. */
const BASE = 'https://googleads.googleapis.com/v26';
const clean = (value: unknown) => String(value ?? '').trim();

export type GoogleAdsAccount = {
  id: string;
  name: string;
  currency: string;
  timeZone: string;
  manager: boolean;
  loginCustomerId: string;
};

export function googleAdsCustomerId(value: unknown): string {
  const id = clean(value).replace(/-/g, '');
  return /^[0-9]{10}$/.test(id) ? id : '';
}

function errorMessage(payload: any, status: number) {
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
  const diagnostic = details.flatMap((part: any) => Array.isArray(part.errors) ? part.errors : [])
    .map((part: any) => clean(part.message)).filter(Boolean).slice(0, 2).join('؛ ');
  return (diagnostic || clean(payload?.error?.message) || `Google Ads API HTTP ${status}`).slice(0, 550);
}

export async function googleAdsRequest(accessToken: string, endpoint: string, options: {
  method?: 'GET' | 'POST'; body?: unknown; loginCustomerId?: string;
} = {}): Promise<any> {
  if (!accessToken) throw new Error('انتهى تفويض حساب Google Ads، أعد ربط الحساب.');
  if (!endpoint.startsWith('/') || endpoint.startsWith('//')) throw new Error('مسار Google Ads غير صالح');
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const loginId = googleAdsCustomerId(options.loginCustomerId);
  if (loginId) headers['login-customer-id'] = loginId;
  const response = await fetch(`${BASE}${endpoint}`, {
    method: options.method || 'GET', headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(22_000),
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    if (response.status === 401) throw new Error('انتهت صلاحية Google Ads OAuth. أعد ربط Google Ads من إعدادات التسويق.');
    if (response.status === 403) throw new Error(`لا توجد صلاحية Google Ads للحساب أو API: ${errorMessage(payload, response.status)}`);
    throw new Error(errorMessage(payload, response.status));
  }
  return payload;
}

export async function googleAdsSearch(accessToken: string, accountId: string, query: string, loginCustomerId = '', maxPages = 4): Promise<{ rows: any[]; incomplete: boolean }> {
  const id = googleAdsCustomerId(accountId);
  if (!id) throw new Error('رقم حساب Google Ads غير صالح');
  const rows: any[] = [];
  let pageToken = '';
  let incomplete = false;
  for (let page = 0; page < maxPages; page++) {
    const payload = await googleAdsRequest(accessToken, `/customers/${id}/googleAds:search`, {
      method: 'POST', body: { query, ...(pageToken ? { pageToken } : {}) }, loginCustomerId,
    });
    rows.push(...(Array.isArray(payload.results) ? payload.results : []));
    const next = clean(payload.nextPageToken);
    if (!next || next === pageToken) break;
    if (page === maxPages - 1) { incomplete = true; break; }
    pageToken = next;
  }
  return { rows, incomplete };
}

export async function googleAdsDiscover(accessToken: string): Promise<{ accounts: GoogleAdsAccount[]; warnings: string[] }> {
  const result = await googleAdsRequest(accessToken, '/customers:listAccessibleCustomers');
  const ids = [...new Set((Array.isArray(result.resourceNames) ? result.resourceNames : [])
    .map((name: unknown) => googleAdsCustomerId(clean(name).replace(/^customers\//, '')))
    .filter(Boolean))].slice(0, 30);
  const found = new Map<string, GoogleAdsAccount>();
  const warnings: string[] = [];
  for (const id of ids) {
    try {
      const details = await googleAdsSearch(accessToken, id, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1');
      const c = details.rows[0]?.customer;
      found.set(id, { id, name: clean(c?.descriptiveName) || id, currency: clean(c?.currencyCode), timeZone: clean(c?.timeZone), manager: Boolean(c?.manager), loginCustomerId: '' });
    } catch (reason) {
      warnings.push(`تعذر قراءة الحساب ${id}: ${reason instanceof Error ? reason.message : 'خطأ غير معروف'}`);
    }
  }
  // MCC direct access can hide child accounts from listAccessibleCustomers.
  const managers = [...found.values()].filter(account => account.manager).slice(0, 6);
  for (const manager of managers) {
    try {
      const children = await googleAdsSearch(accessToken, manager.id,
        "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager, customer_client.level, customer_client.status FROM customer_client WHERE customer_client.level <= 2 AND customer_client.status = 'ENABLED' LIMIT 250",
        manager.id, 2);
      for (const row of children.rows) {
        const client = row.customerClient || {};
        const id = googleAdsCustomerId(client.id);
        if (!id || id === manager.id || found.has(id)) continue;
        found.set(id, { id, name: clean(client.descriptiveName) || id, currency: clean(client.currencyCode), timeZone: clean(client.timeZone), manager: Boolean(client.manager), loginCustomerId: manager.id });
      }
      if (children.incomplete) warnings.push(`نتائج حساب المدير ${manager.id} أكثر من حد القراءة الحالي`);
    } catch (reason) {
      warnings.push(`تعذر قراءة عملاء حساب المدير ${manager.id}: ${reason instanceof Error ? reason.message : 'خطأ غير معروف'}`);
    }
  }
  if (ids.length === 30) warnings.push('عدد حسابات Google المتاحة كبير؛ تم الاكتفاء بأول 30 حسابًا مباشرًا');
  return { accounts: [...found.values()].sort((a, b) => Number(a.manager) - Number(b.manager) || a.name.localeCompare(b.name, 'ar')), warnings };
}

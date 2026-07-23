function required(value, name) {
  if (!String(value || "").trim()) throw new Error(`${name}_REQUIRED`);
  return String(value).trim();
}

export class MarketingAgentApi {
  constructor({ baseUrl, deviceToken }) {
    this.baseUrl = required(baseUrl, "MZJ_MARKETING_API_BASE").replace(/\/$/, "");
    this.deviceToken = required(deviceToken, "MZJ_MARKETING_DEVICE_TOKEN");
  }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-mzj-marketing-device-token": this.deviceToken,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
    return payload;
  }

  heartbeat(metadata) {
    return this.request("/api/marketing?resource=agent-runtime&action=heartbeat", { method: "POST", body: JSON.stringify(metadata) });
  }

  importPlan(plan) {
    return this.request("/api/marketing?resource=agent-runtime&action=import-plan", { method: "POST", body: JSON.stringify(plan) });
  }
}

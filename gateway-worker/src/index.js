const routes = new Map([
  ["/webhooks/facebook", "facebook"],
  ["/webhooks/instagram", "instagram"],
  ["/webhooks/tiktok", "tiktok"],
  ["/webhooks/whatsapp", "whatsapp"],
  ["/imports/tiktok-snapchat", "tiktok-snapchat"],
  ["/imports/installment-calculator", "installment-calculator"],
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, service: "mzj-integration-gateway", routes: [...routes.keys()] });
    }

    const source = routes.get(url.pathname);
    if (!source) return json({ ok: false, error: "Not found" }, 404);

    const payload = await request.text();
    const signatureHeaders = {};
    for (const name of ["x-hub-signature-256", "x-webhook-secret", "authorization", "content-type"]) {
      const value = request.headers.get(name);
      if (value) signatureHeaders[name] = value;
    }

    const upstream = await fetch(`${env.PLATFORM_API_BASE_URL}/integrations/${source}`, {
      method: request.method,
      headers: {
        ...signatureHeaders,
        "x-mzj-source": source,
        "x-mzj-gateway-secret": env.GATEWAY_SECRET || "",
        "content-type": request.headers.get("content-type") || "application/json",
      },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : payload,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...corsHeaders(), "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  },
};

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-webhook-secret,x-hub-signature-256,x-mzj-gateway-secret",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

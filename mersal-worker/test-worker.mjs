import worker from './src/index.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const originalFetch = globalThis.fetch;

async function invoke(path, body, env = {}, headers = {}) {
  const request = new Request(`https://worker.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mzj-gateway-secret': 'secret', ...headers },
    body: JSON.stringify(body),
  });
  return worker.fetch(request, {
    MZJ_GATEWAY_SECRET: 'secret',
    MERSAL_TOKEN: 'token',
    MERSAL_API_ENDPOINT: 'https://w-mersal.com',
    MERSAL_SEND_URL: 'https://w-mersal.com/api/wpbox/sendmessage',
    MERSAL_TEMPLATE_URL: 'https://w-mersal.com/api/wpbox/sendtemplatemessage',
    PLATFORM_INBOUND_URL: 'https://mzj-platform.vercel.app/api/integrations/whatsapp',
    ...env,
  }, { waitUntil() {} });
}

// 1) Template arrived but provider HTTP is non-2xx: a real WAMID must win.
{
  let calledUrl = '';
  globalThis.fetch = async (url, options) => {
    calledUrl = String(url);
    const sent = JSON.parse(options.body);
    assert(sent.template_name === 'status_template', 'template_name was not sent');
    return new Response(JSON.stringify({ status: 'success', message_wamid: 'wamid.template.1' }), { status: 500 });
  };
  const response = await invoke('/send/mersal', { type: 'template', phone: '0541421013', template_name: 'status_template', template_language: 'ar', components: [] });
  const data = await response.json();
  assert(response.status === 200, 'template response should be 200 after provider acceptance');
  assert(data.ok === true && data.status === 'sent', 'template should be marked sent');
  assert(data.provider_message_id === 'wamid.template.1', 'template provider message id missing');
  assert(calledUrl.endsWith('/api/wpbox/sendtemplatemessage'), 'wrong template endpoint');
}

// 2) Free text must use the exact text endpoint and exact message field.
{
  globalThis.fetch = async (url, options) => {
    assert(String(url).endsWith('/api/wpbox/sendmessage'), 'wrong text endpoint');
    const sent = JSON.parse(options.body);
    assert(sent.phone === '966541421013', 'phone was not normalized');
    assert(sent.message === 'رسالة نص حر', 'free text message field is wrong');
    assert(!('template_name' in sent), 'free text payload contains template_name');
    return new Response(JSON.stringify({ ok: true, status: 'success', message_wamid: 'wamid.text.1' }), { status: 200 });
  };
  const response = await invoke('/send/mersal', { type: 'text', phone: '0541421013', message: 'رسالة نص حر' });
  const data = await response.json();
  assert(response.status === 200 && data.ok === true, 'free text should succeed');
  assert(data.provider_message_id === 'wamid.text.1', 'free text provider id missing');
}

// 3) Incoming phone reply must be forwarded to PostgreSQL endpoint.
{
  let platformBody = null;
  let platformHeaders = null;
  globalThis.fetch = async (url, options) => {
    assert(String(url) === 'https://mzj-platform.vercel.app/api/integrations/whatsapp', 'wrong platform inbound URL');
    platformBody = JSON.parse(options.body);
    platformHeaders = options.headers;
    return new Response(JSON.stringify({ ok: true, result: { conversationId: 'conv-1', messageId: 'msg-db-1' } }), { status: 202 });
  };
  const payload = {
    entry: [{
      changes: [{
        value: {
          contacts: [{ wa_id: '966541421013', profile: { name: 'عميل اختبار' } }],
          messages: [{ id: 'wamid.in.1', from: '966541421013', timestamp: '1784310000', type: 'text', text: { body: 'رد من التليفون' } }],
        },
      }],
    }],
  };
  const response = await invoke('/webhook/mersal', payload);
  const data = await response.json();
  assert(response.status === 200 && data.ok === true && data.processed === 1, 'inbound webhook should be accepted');
  assert(platformBody.eventId === 'wamid.in.1', 'inbound event id changed');
  assert(platformBody.phone === '966541421013', 'inbound phone missing');
  assert(platformBody.text === 'رد من التليفون', 'inbound text missing');
  assert(platformBody.direction === 'in' && platformBody.provider === 'mersal', 'inbound direction/provider wrong');
  assert(platformHeaders['x-mzj-gateway-secret'] === 'secret', 'gateway secret missing');
  assert(platformHeaders['x-event-id'] === 'wamid.in.1', 'x-event-id missing');
}

// 4) A rejected PostgreSQL write must not be acknowledged to Mersal.
{
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'db rejected' }), { status: 500 });
  const response = await invoke('/webhook/mersal', {
    entry: [{ changes: [{ value: { messages: [{ id: 'wamid.in.2', from: '966541421013', type: 'text', text: { body: 'retry me' } }] } }] }],
  });
  const data = await response.json();
  assert(response.status === 502 && data.ok === false, 'rejected inbound event must return 502');
}


// 5) Template synchronization remains available on the exact /templates/mersal route.
{
  globalThis.fetch = async (url, options) => {
    assert(String(url).includes('/api/wpbox/getTemplates?token='), 'wrong templates provider endpoint');
    assert(options.method === 'GET', 'templates provider request must be GET');
    return new Response(JSON.stringify({ data: [{ id: 'tpl-1', name: 'status_template', status: 'APPROVED' }] }), { status: 200 });
  };
  const response = await invoke('/templates/mersal', { action: 'sync_templates' });
  const data = await response.json();
  assert(response.status === 200 && data.ok === true, 'template synchronization should succeed');
  assert(Array.isArray(data.templates) && data.templates.length === 1, 'template synchronization payload missing');
}

globalThis.fetch = originalFetch;
console.log('Mersal worker tests passed');

import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const migration = read('database/migrations/20260722_crm_customer_automation_rebuild_v1187.sql');
const engine = read('server/_crm-customer-automation.ts');
const settings = read('server/_crm-customer-automation-settings.ts');
const api = read('server/crm/automation-settings.ts');
const admin = read('src/crm/pages/CrmAdminPage.tsx');
const ui = read('src/crm/components/CrmAutomationSettings.tsx');
const router = read('server/_crm-automation.ts');
const messaging = read('server/_crm-messaging.ts');
const lifecycle = read('server/_crm-lifecycle.ts');
const integration = read('server/_integration-processor.ts');

must(migration.includes('drop table if exists crm.customer_automation_runs cascade'), 'old automation runs are not removed');
must(migration.includes('create table crm.customer_automation_sessions'), 'clean session table missing');
must(migration.includes("'awaiting_service','awaiting_name','awaiting_car','awaiting_phone'"), 'fixed active states missing');
must(migration.includes("trigger_policy in ('every_message','every_24_hours','custom_interval')"), 'trigger policies missing');
must(migration.includes('create unique index crm_customer_automation_one_active_contact'), 'one-active-session protection missing');

must(engine.includes('state === "awaiting_name"'), 'name state missing');
must(engine.includes('state === "awaiting_car"'), 'car state missing');
must(engine.includes('state === "awaiting_phone"'), 'phone state missing');
must(engine.includes('update crm.contacts set') && engine.includes('display_name=${customerName}'), 'captured name is not saved to contact');
must(engine.includes('update crm.conversations set customer_name=${customerName}'), 'captured name is not saved to conversation');
must(engine.includes('update crm.leads set customer_name=${customerName}'), 'captured name is not saved to lead');
must(engine.includes('car_name=${carName},car_type=${carName}'), 'car is not saved to customer lead');
must(engine.includes('primary_phone=${phone},primary_phone_normalized=${phoneNormalized}'), 'phone is not saved to contact');
must(engine.includes('phone=${phone},phone_normalized=${phoneNormalized}'), 'phone is not saved to lead');
must(engine.includes('tokens.includes(candidate)'), 'service choices are not exact-match');
must(!engine.includes('candidate.includes('), 'partial service matching is still present');
must(engine.includes('awaitProvider: true'), 'automation messages are not provider-confirmed');

must(settings.includes('every_message') && settings.includes('every_24_hours') && settings.includes('custom_interval'), 'settings policy options missing');
must(api.includes('platformCode') && api.includes('workerCode') && api.includes('worker.platformCode !== binding.platformCode'), 'platform-worker validation missing');
must(admin.includes('إعدادات الأوتوميشن') && admin.includes('<CrmAutomationSettings />'), 'automation settings tab missing');
must(ui.includes('تشغيل الأوتوميشن'), 'automation enable control missing');
must(ui.includes('المنصات والـWorkers'), 'platform-worker controls missing');
must(ui.includes('مع كل رسالة واردة خارج فلو نشط'), 'every-message policy control missing');
must(ui.includes('مرة كل 24 ساعة'), '24-hour policy control missing');
must(ui.includes('مدة مخصصة'), 'custom policy control missing');
must(ui.includes('سؤال الاسم') && ui.includes('سؤال السيارة') && ui.includes('سؤال رقم الجوال'), 'approved finance flow messages missing');
must(router.includes('processCustomerAutomationInbound'), 'central engine is not wired to inbound messages');
must(!router.includes('detectServiceChoice'), 'legacy service-selection engine still exists');
must(messaging.includes('awaitProvider?: boolean') && messaging.includes('await finishWorkerDelivery(deliveryInput)'), 'synchronous provider confirmation missing');
must(lifecycle.includes("metadata->>'automationCapturedName'"), 'captured contact name is not protected from provider overwrite');
must(integration.includes("captured_contact.metadata->>'automationCapturedName'"), 'captured lead name is not protected from provider overwrite');

console.log('CRM customer automation rebuild v1.18.7 checks passed');

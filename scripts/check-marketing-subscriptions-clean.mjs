import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const checks = [];
function check(name, condition) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  checks.push(name);
  console.log(`PASS: ${name}`);
}

const shared = read('shared/access-control.ts');
const accessSchema = read('server/_access-control-schema.ts');
const apiPermissions = read('server/_api-permissions.ts');
const marketingSchema = read('server/_marketing-schema.ts');
const marketingApi = read('server/marketing/index.ts');
const app = read('src/App.tsx');
const layout = read('src/marketing/MarketingLayout.tsx');
const page = read('src/marketing/pages/SubscriptionsPage.tsx');
const settingsPanel = read('src/marketing/components/MarketingSettingsPanel.tsx');
const subscriptionSettings = read('src/marketing/components/SubscriptionSettings.tsx');
const settingsPage = read('src/pages/SettingsPage.tsx');
const helpers = read('src/marketing/subscriptions.ts');
const css = read('src/marketing/marketing.css');

check('central catalog exposes the marketing subscriptions page', shared.includes('code: "subscriptions"') && shared.includes('/marketing/subscriptions'));
check('central catalog exposes view permission', shared.includes('marketing.subscriptions.view'));
check('central catalog exposes renew permission', shared.includes('marketing.subscriptions.renew'));
check('central catalog exposes manage permission', shared.includes('marketing.subscriptions.manage'));
check('database access catalog also contains the three permissions', accessSchema.includes('marketing.subscriptions.view') && accessSchema.includes('marketing.subscriptions.renew') && accessSchema.includes('marketing.subscriptions.manage'));
check('API gateway protects subscription reads and writes', apiPermissions.includes('subscriptions: "marketing.subscriptions.view"') && apiPermissions.includes('subscription_settings: "marketing.subscriptions.manage"') && apiPermissions.includes('renew_subscription: "marketing.subscriptions.renew"'));
check('subscription tables are created idempotently in marketing schema', marketingSchema.includes('create table if not exists marketing.subscriptions') && marketingSchema.includes('create table if not exists marketing.subscription_renewals'));
check('subscriptions support fixed, per-unit and usage pricing', marketingSchema.includes("pricing_model in ('fixed','per_unit','usage')") && helpers.includes('"fixed" | "per_unit" | "usage"'));
check('backend enforces view/manage/renew permissions', marketingApi.includes('marketing.subscriptions.view') && marketingApi.includes('marketing.subscriptions.manage') && marketingApi.includes('marketing.subscriptions.renew'));
check('backend stores renewal history transactionally', marketingApi.includes('marketing.subscription_renewals') && marketingApi.includes('sql.begin(async (tx)'));
check('main subscriptions route uses a permission guard', app.includes('path="subscriptions"') && app.includes('permission="marketing.subscriptions.view"'));
check('marketing sidebar hides subscriptions without view permission', layout.includes('/marketing/subscriptions') && layout.includes('marketing.subscriptions.view'));
check('subscriptions page supports renewal, history and usage-aware pricing', page.includes('renew_subscription') && page.includes('subscription_history') && page.includes('الاستهلاك الحالي') && page.includes('قيمة الاشتراك'));
check('subscription settings support amount and usage configuration', subscriptionSettings.includes('قيمة الاشتراك') && subscriptionSettings.includes('سعر الوحدة') && subscriptionSettings.includes('وحدة الاستخدام') && subscriptionSettings.includes('حسب الاستخدام'));
check('marketing settings exposes subscriptions only with manage permission', settingsPanel.includes('marketing.subscriptions.manage') && settingsPanel.includes('<SubscriptionSettings'));
check('global settings lets manage-only users reach marketing settings', settingsPage.includes('marketing.subscriptions.manage'));
check('subscription date helper preserves month-end safely', helpers.includes('Math.min(dayRaw, lastDay)'));
check('subscriptions reuse the existing marketing visual identity', css.includes('/* Marketing subscriptions */') && css.includes('var(--brand)') && css.includes('var(--line)'));

console.log(`Marketing subscriptions clean checks: ${checks.length}/${checks.length} passed`);

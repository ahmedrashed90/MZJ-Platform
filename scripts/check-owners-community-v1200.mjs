import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
function expect(name, condition) {
  const ok = Boolean(condition);
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
}

const app = read("src/App.tsx");
const sidebar = read("src/components/Sidebar.tsx");
const settingsPage = read("src/pages/SettingsPage.tsx");
const settingsPanel = read("src/owners/OwnersSettingsPanel.tsx");
const portal = read("src/owners/OwnersPortalPage.tsx");
const invite = read("src/owners/OwnersInvitePage.tsx");
const adminPage = read("src/owners/OwnersCommunityPage.tsx");
const catalog = read("shared/access-control.ts");
const accessSchema = read("server/_access-control-schema.ts");
const api = read("api/index.ts");
const permissions = read("server/_api-permissions.ts");
const schema = read("server/_owners-schema.ts");
const core = read("server/_owners.ts");
const publicApi = read("server/owners-public.ts");
const adminApi = read("server/owners.ts");
const welcomeApi = read("server/_owners-welcome.ts");
const erp = read("server/_erpnext-sales-order-sync.ts");
const mersalSync = read("server/crm/mersal-templates.ts");
const crmMessaging = read("server/_crm-messaging.ts");
const crmSettings = read("server/crm/settings.ts");
const packageJson = JSON.parse(read("package.json"));

expect("public Owners portal and invite routes exist", app.includes('path="/owners"') && app.includes('path="/owners/invite/:code"'));
expect("internal Owners route is permission guarded", app.includes('permission="owners.community.view"') && app.includes('path="/owners-community"'));
expect("sidebar entry is hidden without Owners permission", sidebar.includes('permission: "owners.community.view"'));
expect("settings has a permission-scoped Owners section", settingsPage.includes('key: "owners"') && settingsPage.includes("settings.owners.view") && settingsPage.includes("OwnersSettingsPanel"));
expect("authorized Owners-only user has a valid default route", read("src/systemAccess.ts").includes('hasPermission(user, "owners.community.view")'));
expect("central permission catalog includes all four Owners permissions", ["owners.community.view", "owners.community.manage", "settings.owners.view", "settings.owners.manage"].every((code) => catalog.includes(code)));
expect("runtime access schema includes Owners page and permissions for existing databases", accessSchema.includes("owners_community") && accessSchema.includes("mzj:access-control-required-page-permissions:v2") && accessSchema.includes("settings.owners.manage"));
const centralMigration = read("database/migrations/20260724_central_access_control_v1190.sql");
expect("base central access migration includes Owners page and all four permissions", centralMigration.includes("owners_community") && ["owners.community.view", "owners.community.manage", "settings.owners.view", "settings.owners.manage"].every((code) => centralMigration.includes(code)));
expect("public Owners API bypasses employee authentication only for the public route", permissions.includes('"owners/public"') && api.includes('["owners/public", ownersPublicHandler]'));
expect("internal Owners API requires view/manage permissions", permissions.includes("owners.community.view") && permissions.includes("owners.community.manage") && permissions.includes("settings.owners.manage"));
expect("Owners schema is idempotent and version-gated", schema.includes("owners.schema_state") && schema.includes("withDatabaseAdvisoryLock") && schema.includes("runSqlScript"));
expect("Owners schema readiness is independent from deprecated Mersal OTP columns", !schema.includes("column_name='otp_channel'") && schema.includes(">= 1218"));
expect("Owners schema contains settings, members, referrals, visits, points, rewards, redemptions, OTP and sessions", ["owners.settings", "owners.members", "owners.referrals", "owners.referral_visits", "owners.points_ledger", "owners.rewards", "owners.redemptions", "owners.otp_challenges", "owners.sessions"].every((table) => schema.includes(table)));
expect("Owners Community keeps its data in PostgreSQL and reuses the centralized SMS+ queue only as a delivery channel", publicApi.includes("queueFirebaseSms") && ![schema, core, adminApi].some((source) => /firestore\.googleapis|sms_outbox/i.test(source)) && !/firestore\.googleapis|sms_outbox/i.test(publicApi));
expect("JSON metadata uses the postgres JSONValue type instead of Record<string, unknown>", core.includes('export type OwnerJson = Parameters<SqlClient["json"]>[0]') && core.includes("metadata?: OwnerJson"));
expect("OTP uses the centralized SMS+ queue only", publicApi.includes("queueFirebaseSms") && !publicApi.includes("otp_channel") && !publicApi.includes("deliverDirectWhatsapp") && !publicApi.includes("otp_template_id"));
expect("Mersal sync uses the same canonical gateway secret as the shipped worker", mersalSync.includes("process.env.MZJ_GATEWAY_SECRET") && mersalSync.indexOf("process.env.MZJ_GATEWAY_SECRET") < mersalSync.indexOf("process.env[secretName]") && mersalSync.includes("x-mzj-gateway-secret"));
expect("CRM gateway sends prefer the canonical shared gateway secret", crmMessaging.includes("clean(process.env.MZJ_GATEWAY_SECRET) || clean(process.env[configuredName])"));
expect("WhatsApp endpoint settings persist the canonical gateway secret name", crmSettings.includes('["whatsapp", "mersal"].includes(sourceCode)') && crmSettings.includes('"MZJ_GATEWAY_SECRET"'));
expect("OTP is HMAC-hashed, expires, is attempt-limited and is hourly rate-limited", core.includes("createHmac") && publicApi.includes("otp_expiry_minutes") && publicApi.includes("otp_max_attempts") && publicApi.includes("otp_hourly_limit"));
expect("OTP expiry is evaluated by PostgreSQL clock with no artificial SMS grace", publicApi.includes("expires_at>now() as is_unexpired") && !publicApi.includes("OTP_SMS_QUEUE_GRACE_MINUTES"));
expect("purchase award runtime parameters are typed once before JSON construction", core.includes("with runtime_values as (") && core.includes("${configuredPoints}::integer as purchase_award_points") && core.includes("'purchaseAwardPoints',runtime.purchase_award_points") && !core.includes("'purchaseAwardPoints',${configuredPoints}"));
expect("purchase award summary keeps the full returned row array before reduce", core.includes("const summary = await tx<{ awards: number }[]>`") && core.includes("summary.reduce((total: number, row: any)") && !core.includes("const [summary] = await tx"));
expect("customer identity is based on canonical sold phone", publicApi.includes("ensureOwnerMemberByPhone") && core.includes("crm.sales_transactions"));
expect("customer session is separate from the public referral link", core.includes("OWNER_SESSION_COOKIE") && schema.includes("owners.sessions") && !portal.includes("phone_normalized}/owners"));
expect("referral registration creates or links a CRM lead using the centralized assignment flow", publicApi.includes("'owners_referral'") && publicApi.includes("chooseAssignment") && publicApi.includes("attachLeadToContactAndOpenRequest"));
expect("self-referrals, duplicate owners and previous buyers are rejected", publicApi.includes("لا يمكن استخدام رابط الدعوة لنفس صاحب العضوية") && publicApi.includes("سبق له الشراء") && publicApi.includes("عضو بالفعل"));
expect("unique opens and registration award configurable idempotent points", publicApi.includes("points_unique_open") && publicApi.includes("points_registration") && core.includes("on conflict(event_key) do nothing"));
expect("qualification and sale milestones are synchronized from CRM and canonical sales", core.includes("points_qualified") && core.includes("points_sale") && core.includes("syncOwnerReferralProgress"));
expect("a referred buyer becomes a new Owner automatically", core.includes("ensureOwnerMemberForLead(referral.crm_lead_id, referral.sale_id)") || core.includes("ensureOwnerMemberForLead(referral.crm_lead_id, referral.sale_id);"));
expect("new canonical NEXT ERP sales trigger Owners enrollment", erp.includes("processOwnerSaleForLead(crm.leadId)"));
expect("historical canonical sales can be synchronized from the admin page", adminApi.includes("syncMembersFromCanonicalSales") && adminPage.includes("sync_members"));
expect("reward catalog supports gift, discount, service and voucher", schema.includes("reward_type") && adminApi.includes('"voucher"') && adminPage.includes('value="discount"'));
expect("reward catalog can expose separate new-customer, existing-customer and friend-referral rewards to website purchases", schema.includes("available_for_referral_purchase") && schema.includes("available_for_existing_customer_purchase") && schema.includes("available_for_friend_referral_purchase") && adminApi.includes("availableForFriendReferralPurchase") && adminPage.includes("متاحة للعميل الجديد عند استخدام كود الدعوة في طلب الشراء") && adminPage.includes("متاحة للعميل القديم عند استخدام كود الدعوة في طلب الشراء") && adminPage.includes("متاحة دعوة من صديق عند استخدام كود الدعوة في طلب الشراء"));
expect("website discount rewards support either a fixed SAR amount or a percentage", schema.includes("checkout_discount_type") && schema.includes("checkout_discount_value") && adminApi.includes("checkoutDiscountType") && adminApi.includes("checkoutDiscountValue") && publicApi.includes("discountPercent") && adminPage.includes("طريقة الخصم في طلب الموقع"));
expect("reward catalog supports safe reward deletion without erasing used audit history", adminApi.includes('action === "delete_reward"') && adminApi.includes("لا يمكن حذف مكافأة لها استخدامات سابقة") && adminPage.includes("deleteReward(item)"));
expect("referral purchase benefits allow repeat customer rewards across separate website orders while preserving per-order idempotency", schema.includes("owners.referral_purchase_benefits") && schema.includes("drop constraint if exists referral_purchase_benefits_referred_phone_normalized_key") && !schema.includes("unique(referred_phone_normalized)") && schema.includes("unique(website_order_id)") && publicApi.includes("priorBenefit") && publicApi.includes("existingOwner || priorSale || priorBenefit"));
expect("commerce API classifies website buyers as new or existing without replacing the canonical website CRM ownership", publicApi.includes('action === "commerce_rewards"') && publicApi.includes("customerKind") && publicApi.includes("ensureWebsitePurchaseReferral") && publicApi.includes("crmOwnershipPreserved"));
expect("commerce API is server-to-server protected and reuses the same Owners public endpoint", publicApi.includes("OWNERS_COMMERCE_API_KEY") && publicApi.includes("x-mzj-owners-api-key") && api.includes('["owners/public", ownersPublicHandler]'));
expect("commerce reward confirmation records only the Owners referral and leaves website CRM source branch and assignee to the canonical website order flow", publicApi.includes('action === "commerce_confirm"') && publicApi.includes("ensureWebsitePurchaseReferral(") && publicApi.includes("processOwnerSaleForLead() links it") && !publicApi.includes("ownerReferralWebsiteOrderId"));
expect("existing real owners may use their own referral code once for an old-customer reward", publicApi.includes("selfUse") && publicApi.includes("سبق استخدام كود الدعوة الخاص بك للاستفادة من مكافأة عميل قديم") && publicApi.includes("metadata->>'selfUse'"));
expect("personal old-customer code has a global one-use ledger and server-side 1 percent calculation", schema.includes("owners.personal_code_uses") && publicApi.includes('action === "commerce_personal_code_use"') && publicApi.includes("personalCodeDiscountAmount") && publicApi.includes("تم استخدام الكود الشخصي مسبقًا في طلب شراء"));
expect("website checkout can redeem issued points reward codes once", schema.includes("website_order_id text") && publicApi.includes('action === "commerce_redemption_lookup"') && publicApi.includes('action === "commerce_redemption_confirm"') && publicApi.includes("used_channel='website_purchase'"));
expect("repurchase rewards are exposed and confirmed as a separate catalog audience", schema.includes("available_for_repurchase") && publicApi.includes("repurchaseRewardIds") && publicApi.includes("repurchaseEligible") && publicApi.includes("repurchaseReward"));
expect("commerce API maps buyer-owned and friend-owned codes to separate reward audiences", publicApi.includes("rewardAvailableForReferrerKind") && publicApi.includes("referrerKind === \"legacy\"") && publicApi.includes("available_for_referral_purchase === true") && publicApi.includes("available_for_existing_customer_purchase === true") && publicApi.includes("available_for_friend_referral_purchase === true") && publicApi.includes("eligibility.selfUse === true") && publicApi.includes("مكافأة العميل الجديد المختارة لم تعد متاحة") && publicApi.includes("مكافأة العميل القديم أو إعادة الشراء المختارة لم تعد متاحة") && publicApi.includes("مكافأة دعوة من صديق المختارة لم تعد متاحة") && publicApi.includes('action === "commerce_confirm_bundle"'));
expect("reward catalog exposes auditable usage details with the customer, phone, order and Next ERP reference", adminApi.includes('action === "reward_usage"') && adminApi.includes("websitePurchases") && adminApi.includes("memberRedemptions") && adminPage.includes("عرض من استخدم المكافأة") && adminPage.includes("استخدامات المكافأة"));
expect("bundle rewards can be linked to the final Next ERP Sales Order without changing the referral flow", publicApi.includes('action === "commerce_link_order"') && publicApi.includes("handleCommerceLinkOrder") && publicApi.includes("next_erp_sales_order"));
expect("reward stock accounts for both member redemptions and referral-purchase benefits", publicApi.includes("redeemed_quantity+referral_purchase_redeemed_quantity") && adminPage.includes("referral_purchase_redeemed_quantity"));
expect("redemption is transactional and can refund rejected or cancelled requests", publicApi.includes("sql.begin") && adminApi.includes("redemption_refund") && adminApi.includes("transitionAllowed"));
expect("admin settings keep SMS+ verification, point rules, levels and benefit copy without Mersal dependencies", ["otpHourlyLimit", "pointsUniqueOpen", "silverPoints", "friendBenefitTitle", "SMS+ عبر تطبيق التراكينج"].every((field) => settingsPanel.includes(field)) && !settingsPanel.includes("otpTemplateId") && !settingsPanel.includes("welcomeTemplateId"));
expect("member portal exposes points, invite link, referrals, rewards and ledger", ["member.inviteUrl", "owners-public-rewards", "owners-referral-list", "owners-ledger"].every((text) => portal.includes(text)));
expect("public invite uses the full company name and no deprecated special-benefit headline", invite.includes("مجموعة محمد بن ذعار العجمي") && !invite.includes("ميزة خاصة من عميل MZJ"));
expect("member portal keeps the referral link inside the customer page without the points-explanation note", portal.includes("شارك رابطك مع أصدقائك") && !portal.includes("كل صديق جديد يفتح الرابط أو يسجل أو يتأهل أو يشتري يضيف نقاطًا حسب إعدادات البرنامج."));
expect("welcome SMS contains only the customer portal link and trusted-history slogan", welcomeApi.includes("تاريخ تثق به") && !welcomeApi.includes("رابط دعوتك الخاص لمشاركته مع أصدقائك") && !welcomeApi.includes("مع MZJ أنت نجم الطريق"));
expect("welcome SMS status is visible and repeat sending is locked", adminPage.includes("حالة الترحيب") && adminPage.includes("welcome_sent_at") && adminPage.includes("لم يتم الإرسال") && adminApi.includes("تم إرسال رسالة الترحيب لهذا العضو مسبقًا"));
expect("membership card uses a compact bank-card ratio and branded brown front", read("src/styles.css").includes("aspect-ratio:1.586/1") && read("src/styles.css").includes("#6a4437") && read("src/styles.css").includes("#8a5a49"));
expect("member portal removes public referral KPI cards and generic dashboard note", !portal.includes("أصدقاء مسجلون") && !portal.includes("عملاء مؤهلون") && !portal.includes("مبيعات ناجحة") && !portal.includes("كل شيء في حسابك أمامك بشكل واضح"));
expect("membership back uses the concise admin-managed benefits message", portal.includes("مزايا جديدة قريبًا تخصصها الإدارة لبطاقة العضوية") && !portal.includes("تظهر هنا المكافآت التي تخصصها الإدارة لبطاقة العضوية."));
expect("invite page registers a friend through the public referral endpoint", invite.includes("register_referral") && invite.includes("ownersPublicPost"));
expect("admin can create and delete isolated test members", adminApi.includes('action === "create_test_member"') && adminApi.includes('"delete_test_member"') && adminApi.includes('"delete_member"') && adminPage.includes("إضافة عضو تجريبي"));
expect("test members are excluded from real Owners KPIs", adminApi.includes("memberKind','real')<>'test") && adminPage.includes('member.member_kind === "test"'));
expect("test referrals never create CRM leads", publicApi.includes('referrer.member_kind === "test"') && publicApi.includes("تم تسجيل الصديق التجريبي بدون إضافة بيانات إلى CRM"));
expect("historical customers can be imported from xlsx with explicit column mapping", adminPage.includes("readXlsx") && adminPage.includes("import_members") && adminPage.includes("استيراد العملاء السابقين من Excel"));
expect("Excel import deduplicates by normalized phone and matches canonical sales", adminApi.includes("seen = new Set") && adminApi.includes("excel_import_matched") && adminApi.includes("ensureOwnerMemberForLead(sale.lead_id, sale.sale_id)"));
expect("internal Owners API independently enforces employee permissions", adminApi.includes('hasPermission(actor, "owners.community.view")') && adminApi.includes('hasPermission(actor, "owners.community.manage")') && adminApi.includes('hasPermission(actor, "settings.owners.manage")'));
expect("focused Owners check runs before the existing baseline checks", String(packageJson.scripts?.typecheck || "").startsWith("node scripts/check-owners-community-v1200.mjs && "));
expect("no release-specific Owners migration or patch file was added", !fs.readdirSync("database/migrations").some((name) => /owners|1200/i.test(name)));

const sourceRoots = ["api", "server", "shared", "src", "scripts"];
let conflictFound = false;
for (const root of sourceRoots) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(?:ts|tsx|js|mjs|css|json)$/.test(entry.name)) {
        const text = read(full);
        if (/^(?:<{7}|>{7})(?:\s|$)/m.test(text)) conflictFound = true;
      }
    }
  }
}
expect("no unresolved merge-conflict marker exists", !conflictFound);

const passed = checks.filter((check) => check.ok).length;
console.log(`\nMZJ Owners Community checks: ${passed}/${checks.length} passed.`);
if (passed !== checks.length) process.exit(1);

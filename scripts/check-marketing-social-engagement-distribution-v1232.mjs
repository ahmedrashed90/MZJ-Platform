import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const checks = [];
const check = (name, value) => checks.push({ name, ok: Boolean(value) });

const engagement = read('server/_marketing-engagement.ts');
const crmUtils = read('server/_crm-utils.ts');
const lifecycle = read('server/_crm-lifecycle.ts');
const page = read('src/marketing/pages/EngagementPage.tsx');

check('social post source aliases resolve to canonical distribution sources',
  crmUtils.includes('if (source === "facebook_post") return "facebook"')
  && crmUtils.includes('if (source === "instagram_post") return "instagram"'));
check('assignment rules match either stored source or canonical routing source',
  crmUtils.includes('${source}=any(r.source_codes) or ${routingSource}=any(r.source_codes)'));
check('cash rules with the same configured order participate in one central round-robin pool',
  crmUtils.includes('const activeRules = matchingRules.filter')
  && crmUtils.includes('Number(rule.sort_order || 0) === Number(firstRule.sort_order || 0)')
  && crmUtils.includes('m.rule_id=any(${ruleIds}::uuid[])'));
check('selected branch comes from the selected eligible rep/rule, not from marketing hardcoding',
  crmUtils.includes('const selectedBranch = clean(selected.primary_branch_code) || clean(selected.rule_branch_code) || requested')
  && !engagement.includes('requestedBranchCode: "hall"')
  && !engagement.includes('requestedBranchCode: "multaqa"')
  && !engagement.includes('requestedBranchCode: "qadisiyah"'));
check('social engagement CRM uses the existing central lifecycle distribution engine',
  engagement.includes('createCrmLeadFromSocialEngagement')
  && engagement.includes('classifyConversationService({')
  && engagement.includes('serviceKey: "cash"')
  && engagement.includes('assignPrimary: true'));
check('central lifecycle writes selected rep and branch to lead request and conversation',
  lifecycle.includes('assigned_to=${assignment.assignedTo}::uuid')
  && lifecycle.includes('branch_code=${branchCode}')
  && lifecycle.includes('responsible_name_snapshot=${assignment.assignedName||null}'));
check('Facebook reactions with actor identity create or reuse CRM customers',
  engagement.includes('item.platform === "facebook" && item.metric === "reaction"')
  && engagement.includes('engagementType: "like"')
  && engagement.includes('upsertSocialEngagementAndCrm'));
check('Facebook reaction removal only retires the engagement event and keeps CRM history',
  engagement.includes('markSocialEngagementRemoved(sql, post, "like", item.eventId)'));
check('Facebook and Instagram comments use the same routed CRM entry point',
  engagement.includes('upsertCommentAndCrm')
  && engagement.includes('{ ...item, engagementType: "comment" }'));
check('existing unassigned social leads are rechecked through central assignment rules',
  engagement.includes('ensureExistingSocialLeadAssignment')
  && engagement.includes('if (!row || row.assigned_to || !row.conversation_id) return;'));
check('Instagram likes are not fabricated as identifiable customers when Meta only supplies aggregate counts',
  !engagement.includes('object === "instagram" && field === "likes"')
  && page.includes('إعجابات Instagram تبقى رقمًا مجمعًا'));
check('engagement UI shows assigned branch and sales rep from CRM',
  page.includes('{item.branch_code || "جارٍ التوزيع"} — {item.assigned_name || "غير موزع"}'));

const failed = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);

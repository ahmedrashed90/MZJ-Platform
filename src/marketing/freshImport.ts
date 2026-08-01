import type {
  CreativeDraft,
  MarketingDepartment,
  MarketingMeta,
  MarketingPlatform,
  MarketingUser,
  PlatformPostType,
  StockCar,
} from "./types";

export type FreshImportUserMapping = {
  legacyId?: string;
  legacyEmail?: string;
  legacyName?: string;
  targetEmail?: string;
  targetName?: string;
};

export type FreshImportReference = {
  email?: string;
  name?: string;
  legacyId?: string;
  dueOn?: string;
  note?: string;
};

export type FreshImportExecutionReference = FreshImportReference & {
  contentUserEmails?: string[];
  contentUserNames?: string[];
  contentUserLegacyIds?: string[];
  departmentRole?: string;
  departmentName?: string;
};

export type FreshImportPlatformReference = {
  platformName: string;
  postTypes: Array<{ code?: string; name?: string }>;
};

export type FreshImportCreative = {
  legacyId: string;
  creativeTypeName: string;
  quantity?: number;
  cars?: string[];
  contentUsers?: FreshImportReference[];
  primaryDepartmentRole?: string;
  primaryDepartmentName?: string;
  primaryUsers?: FreshImportExecutionReference[];
  optionalDepartments?: Array<{
    legacyId?: string;
    departmentRole?: string;
    departmentName?: string;
    users?: FreshImportExecutionReference[];
  }>;
  platforms?: FreshImportPlatformReference[];
  notes?: Record<string, string>;
  publishDate?: string;
};

export type FreshMarketingImportBundle = {
  format: "mzj-marketing-fresh-import";
  version: number;
  migrationKey: string;
  createdFrom?: Record<string, unknown>;
  userMappings?: FreshImportUserMapping[];
  campaigns?: Array<{
    legacyId?: string;
    legacyCode?: string;
    name: string;
    campaignTypeName: string;
    campaignDate: string;
    publishStart: string;
    publishEnd: string;
    objective?: string;
    requiredFromContent?: string;
    creatives: FreshImportCreative[];
    budgets?: Array<{
      creativeLegacyIds?: string[];
      adsCount?: number;
      contentGoal?: string;
      expectedGoal?: string;
      platformAmounts?: Array<{ platformName: string; amount: number }>;
    }>;
    schedule?: Array<{
      date: string;
      creativeLegacyIds?: string[];
      platforms?: FreshImportPlatformReference[];
    }>;
  }>;
  agendas?: Array<{
    legacyId?: string;
    legacyCode?: string;
    name: string;
    monthKey: string;
    publishStart: string;
    publishEnd: string;
    days: Array<{ date: string; creatives?: FreshImportCreative[] }>;
  }>;
};

export type ResolvedFreshMarketingImport = {
  format: FreshMarketingImportBundle["format"];
  version: number;
  migrationKey: string;
  source: FreshMarketingImportBundle["createdFrom"];
  campaigns: Array<Record<string, unknown>>;
  agendas: Array<Record<string, unknown>>;
  errors: string[];
  summary: {
    campaigns: number;
    agendas: number;
    creatives: number;
    taskTemplates: number;
    executionTasks: number;
    cars: number;
  };
};

const platformAliases: Record<string, string[]> = {
  snapchat: ["snapchat", "سناب شات", "سناب"],
  instagram: ["instagram", "انستجرام", "انستغرام"],
  tiktok: ["tiktok", "tik tok", "تيك توك"],
  facebook: ["facebook", "فيس بوك", "فيسبوك"],
  linkedin: ["linkedin", "linked in", "لينكد ان", "لينكدإن"],
  youtube: ["youtube", "يوتيوب"],
};

const postTypeAliases: Record<string, string[]> = {
  story: ["story", "ستوري", "قصه", "قصة"],
  spotlight: ["spotlight", "سبوت لايت", "سبوتلايت"],
  reel: ["reel", "ريل", "ريل فيديو", "ريل short", "short", "شورت", "فيديو قصير"],
  photo_post: ["photo post", "photo", "منشور صور", "بوست صور", "صوره", "صورة", "كاروسيل", "carousel"],
  post: ["post", "منشور", "بوست", "photo post", "صوره", "صورة"],
};

const departmentRoleAliases: Record<string, string[]> = {
  montage: ["montage", "قسم المونتاج", "المونتاج", "مونتاج"],
  design: ["design", "قسم التصميم", "التصميم", "تصميم"],
  shooting: ["shooting", "قسم التصوير", "التصوير", "تصوير"],
  content: ["content", "قسم المحتوى", "المحتوى", "محتوى"],
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function matchOne<T>(items: T[], predicate: (item: T) => boolean) {
  const matches = items.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function resolveUser(
  reference: FreshImportReference,
  mappings: FreshImportUserMapping[],
  meta: MarketingMeta,
  errors: string[],
  context: string,
) {
  const legacyId = normalized(reference.legacyId);
  const legacyEmail = normalized(reference.email);
  const legacyName = normalized(reference.name);
  const matchingMappings = mappings.filter((mapping) => {
    if (mapping.legacyId && legacyId && normalized(mapping.legacyId) === legacyId) return true;
    if (mapping.legacyEmail && legacyEmail && normalized(mapping.legacyEmail) === legacyEmail) return true;
    return Boolean(mapping.legacyName && legacyName && normalized(mapping.legacyName) === legacyName);
  });

  if (matchingMappings.length > 1) {
    errors.push(`${context}: يوجد أكثر من ربط لنفس اليوزر القديم (${reference.name || reference.legacyId || "بدون اسم"})`);
    return null;
  }

  const mapping = matchingMappings[0];
  const targetEmail = normalized(mapping?.targetEmail);
  const targetName = normalized(mapping?.targetName || mapping?.legacyName || reference.name);
  let matches: MarketingUser[] = [];

  if (mapping && targetEmail) {
    matches = meta.users.filter((item) => normalized(item.email) === targetEmail);
  } else if (targetName) {
    matches = meta.users.filter((item) => normalized(item.full_name || item.fullName) === targetName);
  }

  if (matches.length > 1) {
    errors.push(`${context}: الاسم أو البريد مربوط بأكثر من يوزر في النظام الجديد (${mapping?.targetEmail || mapping?.targetName || reference.name || "بدون اسم"})`);
    return null;
  }

  const user = matches[0] || null;
  if (!user) {
    errors.push(`${context}: اليوزر غير موجود في النظام الجديد (${mapping?.targetEmail || mapping?.targetName || reference.name || reference.legacyId || "بدون اسم"})`);
    return null;
  }

  if (targetName && normalized(user.full_name || user.fullName) !== targetName) {
    errors.push(`${context}: البريد المحدد لا يطابق الاسم العربي المطلوب (${mapping?.targetName || mapping?.legacyName || reference.name})`);
    return null;
  }

  return user;
}

function resolveCreativeType(name: string, meta: MarketingMeta, errors: string[], context: string) {
  const target = normalized(name);
  const creativeType = matchOne(meta.creativeTypes, (item) => normalized(item.name) === target);
  if (!creativeType) errors.push(`${context}: نوع الكرييتيف غير موجود (${name})`);
  return creativeType;
}

function resolveCampaignType(name: string, meta: MarketingMeta, errors: string[], context: string) {
  const target = normalized(name);
  const campaignType = matchOne(meta.campaignTypes, (item) => normalized(item.name) === target);
  if (!campaignType) errors.push(`${context}: نوع الحملة غير موجود (${name})`);
  return campaignType;
}

function resolveDepartment(name: string | undefined, role: string | undefined, meta: MarketingMeta, errors: string[], context: string) {
  const targetName = normalized(name);
  let department: MarketingDepartment | null = null;
  if (targetName) department = matchOne(meta.departments, (item) => normalized(item.name) === targetName);
  if (!department && role) {
    const aliases = departmentRoleAliases[normalized(role)] || [role];
    const aliasValues = aliases.map(normalized);
    department = matchOne(meta.departments, (item) => aliasValues.includes(normalized(item.name)));
  }
  if (!department) errors.push(`${context}: القسم غير موجود (${name || role || "غير محدد"})`);
  return department;
}

function platformAliasGroup(value: string) {
  const target = normalized(value);
  const entry = Object.entries(platformAliases).find(([, aliases]) => aliases.map(normalized).includes(target));
  return entry?.[0] || target;
}

function resolvePlatform(name: string, meta: MarketingMeta, errors: string[], context: string) {
  const targetGroup = platformAliasGroup(name);
  const platform = matchOne(meta.platforms, (item) => {
    const currentGroup = platformAliasGroup(`${item.code || ""} ${item.name || ""}`);
    if (currentGroup === targetGroup) return true;
    const values = platformAliases[targetGroup] || [name];
    const current = normalized(`${item.code || ""} ${item.name || ""}`);
    return values.map(normalized).some((value) => current === value || current.includes(value));
  });
  if (!platform) errors.push(`${context}: المنصة غير موجودة (${name})`);
  return platform;
}

function resolvePostType(reference: { code?: string; name?: string }, platform: MarketingPlatform, meta: MarketingMeta, errors: string[], context: string) {
  const candidates = meta.postTypes.filter((item) => item.platform_id === platform.id);
  const exactTargets = [reference.code, reference.name].map(normalized).filter(Boolean);
  let postType = matchOne(candidates, (item) => exactTargets.includes(normalized(item.name)));
  if (!postType) {
    const code = normalized(reference.code);
    const aliases = (postTypeAliases[code] || [reference.code || "", reference.name || ""]).map(normalized).filter(Boolean);
    const matches = candidates.filter((item) => {
      const current = normalized(item.name);
      return aliases.some((alias) => current === alias || current.includes(alias) || alias.includes(current));
    });
    postType = matches.length === 1 ? matches[0] : null;
  }
  if (!postType) errors.push(`${context}: نوع النشر غير موجود على ${platform.name} (${reference.name || reference.code || "غير محدد"})`);
  return postType;
}

function resolvePlatforms(references: FreshImportPlatformReference[] | undefined, meta: MarketingMeta, errors: string[], context: string) {
  const output: Array<{ platformId: string; postTypeIds: string[] }> = [];
  for (const reference of references || []) {
    const platform = resolvePlatform(reference.platformName, meta, errors, context);
    if (!platform) continue;
    const postTypes = uniqueById((reference.postTypes || [])
      .map((postType) => resolvePostType(postType, platform, meta, errors, context))
      .filter((postType): postType is PlatformPostType => Boolean(postType)));
    if (postTypes.length) output.push({ platformId: platform.id, postTypeIds: postTypes.map((item) => item.id) });
  }
  return output;
}

function carParts(value: string) {
  const parts = String(value || "").split("|").map((part) => part.trim());
  const interiorPart = String(parts[3] || "").split(/\+|\|\|/)[0].trim();
  return {
    name: normalized(parts[0]),
    statement: normalized(parts[1]),
    exterior: normalized(parts[2]),
    interior: normalized(interiorPart),
  };
}

function stockCarParts(car: StockCar) {
  return {
    name: normalized(car.car_name),
    statement: normalized(car.statement),
    exterior: normalized(car.exterior_color),
    interior: normalized(car.interior_color),
  };
}

function resolveCar(label: string, meta: MarketingMeta, usedCarIds: Set<string>, errors: string[], context: string) {
  const target = carParts(label);
  const exact = meta.cars.filter((car) => {
    const current = stockCarParts(car);
    return Boolean(target.name && target.statement && target.exterior && target.interior)
      && current.name === target.name
      && current.statement === target.statement
      && current.exterior === target.exterior
      && current.interior === target.interior;
  });
  const availableExact = exact.filter((car) => !usedCarIds.has(car.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (availableExact.length) { usedCarIds.add(availableExact[0].id); return availableExact[0]; }

  const loose = meta.cars.filter((car) => {
    const current = stockCarParts(car);
    return Boolean(target.name && target.statement && target.exterior)
      && current.name === target.name
      && current.statement === target.statement
      && current.exterior === target.exterior
      && (!target.interior || current.interior === target.interior);
  });
  const availableLoose = loose.filter((car) => !usedCarIds.has(car.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (availableLoose.length) { usedCarIds.add(availableLoose[0].id); return availableLoose[0]; }
  if (exact.length || loose.length) errors.push(`${context}: لا توجد نسخة إضافية مطابقة من السيارة داخل المخزون (${label})`);
  else errors.push(`${context}: السيارة غير موجودة في المخزون (${label})`);
  return null;
}

function resolveCreative(creative: FreshImportCreative, mappings: FreshImportUserMapping[], meta: MarketingMeta, errors: string[], context: string): CreativeDraft | null {
  const creativeType = resolveCreativeType(creative.creativeTypeName, meta, errors, context);
  if (!creativeType) return null;

  const resolvedContentUsers = (creative.contentUsers || []).map((reference, index) => ({
    reference,
    user: resolveUser(reference, mappings, meta, errors, `${context} / كاتب المحتوى ${index + 1}`),
  }));
  const contentAssignments = resolvedContentUsers.flatMap(({ reference, user }) => user ? [{
    userId: user.id,
    dueOn: String(reference.dueOn || "").slice(0, 10),
    note: String(reference.note || ""),
  }] : []);
  const contentByEmail = new Map<string, string>();
  const contentByName = new Map<string, string>();
  resolvedContentUsers.forEach(({ reference, user }) => {
    if (!user) return;
    if (reference.email) contentByEmail.set(normalized(reference.email), user.id);
    if (reference.name) contentByName.set(normalized(reference.name), user.id);
  });
  const contentIds = new Set(contentAssignments.map((item) => item.userId));

  const resolveContentLinks = (reference: FreshImportExecutionReference) => {
    const linked = [
      ...(reference.contentUserEmails || []).map((value) => contentByEmail.get(normalized(value))),
      ...(reference.contentUserNames || []).map((value) => contentByName.get(normalized(value))),
    ].filter((value): value is string => Boolean(value));
    return Array.from(new Set(linked.filter((id) => contentIds.has(id))));
  };

  const primaryAssignments = (creative.primaryUsers || []).flatMap((reference, index) => {
    const user = resolveUser(reference, mappings, meta, errors, `${context} / يوزر القسم الأساسي ${index + 1}`);
    if (!user) return [];
    const contentUserIds = resolveContentLinks(reference);
    if (!contentUserIds.length) errors.push(`${context}: اليوزر ${reference.name || reference.email} غير مربوط بكاتب محتوى`);
    return [{ userId: user.id, contentUserIds, dueOn: String(reference.dueOn || "").slice(0, 10), note: String(reference.note || "") }];
  });

  const optionalAssignments = (creative.optionalDepartments || []).flatMap((group, groupIndex) => {
    const department = resolveDepartment(group.departmentName, group.departmentRole, meta, errors, `${context} / القسم الاختياري ${groupIndex + 1}`);
    if (!department) return [];
    const assignments = (group.users || []).flatMap((reference, userIndex) => {
      const user = resolveUser(reference, mappings, meta, errors, `${context} / ${department.name} / يوزر ${userIndex + 1}`);
      if (!user) return [];
      const contentUserIds = resolveContentLinks(reference);
      if (!contentUserIds.length) errors.push(`${context}: اليوزر ${reference.name || reference.email} غير مربوط بكاتب محتوى`);
      return [{ userId: user.id, contentUserIds, dueOn: String(reference.dueOn || "").slice(0, 10), note: String(reference.note || "") }];
    });
    return assignments.length ? [{ departmentId: department.id, assignments }] : [];
  });

  const covered = new Set([...primaryAssignments, ...optionalAssignments.flatMap((group) => group.assignments)].flatMap((item) => item.contentUserIds));
  for (const assignment of contentAssignments) if (!covered.has(assignment.userId)) errors.push(`${context}: يوجد Task Template غير مربوط بتاسك تنفيذي`);

  const usedCarIds = new Set<string>();
  const cars = (creative.cars || []).flatMap((label, index) => {
    const car = resolveCar(label, meta, usedCarIds, errors, `${context} / السيارة ${index + 1}`);
    return car ? [car] : [];
  });

  return {
    tempId: creative.legacyId,
    creativeTypeId: creativeType.id,
    quantity: Math.max(1, Number(creative.quantity || 1)),
    cars,
    contentAssignments,
    primaryAssignments,
    optionalAssignments,
    platforms: resolvePlatforms(creative.platforms, meta, errors, `${context} / جدول النشر`),
    notes: creative.notes || {},
  };
}

function countTasks(creative: CreativeDraft) {
  const templates = creative.contentAssignments.length;
  const executions = [...creative.primaryAssignments, ...creative.optionalAssignments.flatMap((group) => group.assignments)]
    .reduce((sum, assignment) => sum + assignment.contentUserIds.length, 0);
  return { templates, executions };
}

export function resolveFreshMarketingImport(bundle: FreshMarketingImportBundle, meta: MarketingMeta): ResolvedFreshMarketingImport {
  const errors: string[] = [];
  if (bundle?.format !== "mzj-marketing-fresh-import") errors.push("ملف النقل غير معتمد");
  if (Number(bundle?.version) !== 1) errors.push("إصدار ملف النقل غير مدعوم");
  if (!String(bundle?.migrationKey || "").trim()) errors.push("مفتاح عملية النقل غير موجود");

  const mappings = Array.isArray(bundle.userMappings) ? bundle.userMappings : [];
  const summary = { campaigns: 0, agendas: 0, creatives: 0, taskTemplates: 0, executionTasks: 0, cars: 0 };
  const campaigns = (bundle.campaigns || []).flatMap((campaign, campaignIndex) => {
    const context = `الحملة ${campaign.name || campaignIndex + 1}`;
    const campaignType = resolveCampaignType(campaign.campaignTypeName, meta, errors, context);
    if (!campaignType) return [];
    const creatives = campaign.creatives.flatMap((creative, creativeIndex) => {
      const resolved = resolveCreative(creative, mappings, meta, errors, `${context} / كرييتيف ${creativeIndex + 1}`);
      return resolved ? [resolved] : [];
    });
    const byLegacyId = new Map(creatives.map((creative) => [creative.tempId, creative]));
    const budgets = (campaign.budgets || []).map((budget) => ({
      creativeTempIds: (budget.creativeLegacyIds || []).filter((id) => byLegacyId.has(id)),
      funnelId: "",
      adsCount: Math.max(1, Number(budget.adsCount || 1)),
      contentGoal: String(budget.contentGoal || ""),
      expectedGoal: String(budget.expectedGoal || ""),
      platformAmounts: (budget.platformAmounts || []).flatMap((part) => {
        const platform = resolvePlatform(part.platformName, meta, errors, `${context} / الميزانية`);
        return platform ? [{ platformId: platform.id, amount: Math.max(0, Number(part.amount || 0)) }] : [];
      }),
    }));
    const schedule = (campaign.schedule || []).map((item) => ({
      date: String(item.date || "").slice(0, 10),
      creativeTempIds: (item.creativeLegacyIds || []).filter((id) => byLegacyId.has(id)),
      platforms: resolvePlatforms(item.platforms, meta, errors, `${context} / نشر ${item.date}`),
    }));
    summary.campaigns += 1;
    summary.creatives += creatives.length;
    summary.cars += creatives.reduce((sum, creative) => sum + creative.cars.length, 0);
    for (const creative of creatives) {
      const counts = countTasks(creative);
      summary.taskTemplates += counts.templates;
      summary.executionTasks += counts.executions;
    }
    return [{
      campaignDate: String(campaign.campaignDate || "").slice(0, 10),
      publishStart: String(campaign.publishStart || "").slice(0, 10),
      publishEnd: String(campaign.publishEnd || "").slice(0, 10),
      campaignTypeId: campaignType.id,
      campaignCode: String(campaign.legacyCode || ""),
      name: campaign.name,
      objective: String(campaign.objective || ""),
      requiredFromContent: String(campaign.requiredFromContent || ""),
      creatives,
      budgets,
      schedule,
    }];
  });

  const agendas = (bundle.agendas || []).map((agenda, agendaIndex) => {
    const context = `الأجندة ${agenda.name || agendaIndex + 1}`;
    const days = (agenda.days || []).map((day) => ({
      date: String(day.date || "").slice(0, 10),
      creatives: (day.creatives || []).flatMap((creative, creativeIndex) => {
        const resolved = resolveCreative(creative, mappings, meta, errors, `${context} / ${day.date} / كرييتيف ${creativeIndex + 1}`);
        if (!resolved) return [];
        summary.creatives += 1;
        summary.cars += resolved.cars.length;
        const counts = countTasks(resolved);
        summary.taskTemplates += counts.templates;
        summary.executionTasks += counts.executions;
        return [resolved];
      }),
    }));
    summary.agendas += 1;
    return {
      monthKey: agenda.monthKey,
      name: agenda.name,
      publishStart: String(agenda.publishStart || "").slice(0, 10),
      publishEnd: String(agenda.publishEnd || "").slice(0, 10),
      days,
    };
  });

  return {
    format: "mzj-marketing-fresh-import",
    version: 1,
    migrationKey: String(bundle.migrationKey || "").trim(),
    source: bundle.createdFrom,
    campaigns,
    agendas,
    errors: Array.from(new Set(errors)),
    summary,
  };
}

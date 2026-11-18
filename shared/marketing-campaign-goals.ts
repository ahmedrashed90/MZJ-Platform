/** Campaign objectives are saved once per platform, never per publication line.
 * Each saved label is a snapshot: renaming/removing an option does not alter an
 * approved campaign or its PDF history. */
export type CampaignGoal = { id: string; name: string };
export type CampaignPlatformGoals = { platformId: string; goals: CampaignGoal[] };
export type CampaignGoalOption = CampaignGoal & { sort_order: number; is_active: boolean };

export function campaignGoalNameKey(value: string): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar');
}

/** Normalize untrusted persisted JSON, including legacy plans with no goals. */
export function campaignPlatformGoalRows(
  lines: ReadonlyArray<{ platform_id?: string | null; platform_name?: string | null; platform_code?: string | null }>,
  saved: unknown,
): Array<{ platformId: string; platformName: string; goals: CampaignGoal[] }> {
  const selections = Array.isArray(saved) ? saved : [];
  const savedByPlatform = new Map<string, CampaignGoal[]>();
  for (const item of selections) {
    if (!item || typeof item !== 'object' || typeof item.platformId !== 'string' || !Array.isArray(item.goals)) continue;
    const previous = savedByPlatform.get(item.platformId) || [];
    const seen = new Set(previous.map(goal => campaignGoalNameKey(goal.name)));
    for (const goal of item.goals) {
      if (!goal || typeof goal.name !== 'string') continue;
      const name = goal.name.trim().slice(0, 120);
      const key = campaignGoalNameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key); previous.push({ id: String(goal.id || ''), name });
    }
    savedByPlatform.set(item.platformId, previous);
  }
  const platforms = new Map<string, { platformId: string; platformName: string; goals: CampaignGoal[] }>();
  for (const line of lines) {
    const platformId = String(line.platform_id || '').trim();
    const fallback = String(line.platform_code || line.platform_name || '').trim();
    const key = platformId || campaignGoalNameKey(fallback);
    if (!key || platforms.has(key)) continue;
    platforms.set(key, { platformId, platformName: String(line.platform_name || 'منصة غير محددة'), goals: savedByPlatform.get(platformId) || [] });
  }
  return [...platforms.values()].sort((a,b) => a.platformName.localeCompare(b.platformName,'ar'));
}

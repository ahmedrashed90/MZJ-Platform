import { useEffect, useMemo, useState } from "react";
import { CurrencyCircleDollar, FloppyDisk, Plus, Trash } from "@phosphor-icons/react";
import { Modal } from "../../components/Modal";
import { marketingFetch } from "../api";
import type { MarketingMeta } from "../types";
import { CreativeMultiPicker } from "./CreativeMultiPicker";
import { FunnelSelect } from "./FunnelSelect";

type PlatformAmount = { platformId: string; amount: number };

type CampaignBudgetDraft = {
  id: string;
  funnelId: string;
  creativeIds: string[];
  adsCount: number;
  contentGoal: string;
  expectedGoal: string;
  platformAmounts: PlatformAmount[];
};

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function detailPlatformAmounts(item: any): PlatformAmount[] {
  const source = Array.isArray(item?.platform_details)
    ? item.platform_details
    : Array.isArray(item?.platform_amounts)
      ? item.platform_amounts
      : [];
  return source
    .map((part: any) => ({
      platformId: String(part?.platformId || part?.platform_id || ""),
      amount: Math.max(0, Number(part?.amount || 0)),
    }))
    .filter((part: PlatformAmount) => Boolean(part.platformId));
}

function draftsFromDetail(items: any[]): CampaignBudgetDraft[] {
  return items.map((item, index) => {
    const linkedIds = Array.isArray(item?.creative_ids)
      ? item.creative_ids.map((id: unknown) => String(id || "")).filter(Boolean)
      : [];
    const legacyCreativeId = String(item?.creative_id || "");
    return {
      id: String(item?.id || `budget-${index}-${uid()}`),
      funnelId: String(item?.funnel_id || ""),
      creativeIds: Array.from(new Set(linkedIds.length ? linkedIds : legacyCreativeId ? [legacyCreativeId] : [])),
      adsCount: Math.max(1, Number(item?.ads_count || 1)),
      contentGoal: String(item?.content_goal || ""),
      expectedGoal: String(item?.expected_goal || ""),
      platformAmounts: detailPlatformAmounts(item),
    };
  });
}

function newBudget(): CampaignBudgetDraft {
  return {
    id: uid(),
    funnelId: "",
    creativeIds: [],
    adsCount: 1,
    contentGoal: "",
    expectedGoal: "",
    platformAmounts: [],
  };
}

function budgetTotal(item: CampaignBudgetDraft) {
  return item.platformAmounts.reduce((sum, platform) => sum + Math.max(0, Number(platform.amount || 0)), 0);
}

export function CampaignBudgetManager({
  open,
  campaignId,
  campaignName,
  budgets: initialBudgets,
  creatives,
  meta,
  onClose,
  onSaved,
  onFunnelCreated,
}: {
  open: boolean;
  campaignId: string;
  campaignName: string;
  budgets: any[];
  creatives: any[];
  meta: MarketingMeta;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
  onFunnelCreated?: (funnel: MarketingMeta["funnels"][number]) => void;
}) {
  const [budgets, setBudgets] = useState<CampaignBudgetDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setBudgets(draftsFromDetail(Array.isArray(initialBudgets) ? initialBudgets : []));
    setError("");
  }, [open, campaignId]);

  const creativeItems = useMemo(() => creatives.map((creative, index) => ({
    id: String(creative.id || ""),
    name: creative.name || creative.creative_type_name || creative.creative_type || `كرييتيف ${index + 1}`,
    code: creative.instance_code || `كرييتيف ${index + 1}`,
  })).filter((item) => item.id), [creatives]);

  const grandTotal = useMemo(() => budgets.reduce((sum, item) => sum + budgetTotal(item), 0), [budgets]);
  const selectedPlatforms = useMemo(() => new Set(budgets.flatMap((item) => item.platformAmounts.map((part) => part.platformId))).size, [budgets]);

  function updateBudget(id: string, update: (item: CampaignBudgetDraft) => CampaignBudgetDraft) {
    setBudgets((current) => current.map((item) => item.id === id ? update(item) : item));
  }

  function validate() {
    for (let index = 0; index < budgets.length; index += 1) {
      const item = budgets[index];
      if (!item.funnelId) return `اختر Funnel داخل بند الميزانية ${index + 1}`;
      if (!item.creativeIds.length) return `اختر كرييتيفًا واحدًا على الأقل داخل بند الميزانية ${index + 1}`;
      if (!item.platformAmounts.length) return `حدد منصة واحدة على الأقل داخل بند الميزانية ${index + 1}`;
    }
    return "";
  }

  async function save() {
    const issue = validate();
    if (issue) {
      setError(issue);
      return;
    }
    if (!budgets.length && initialBudgets.length && !window.confirm("سيتم حذف ميزانية الحملة بالكامل. هل تريد المتابعة؟")) return;
    setSaving(true);
    setError("");
    try {
      const result = await marketingFetch<{ message: string }>("/api/marketing", {
        method: "POST",
        body: JSON.stringify({
          action: "save_campaign_budgets",
          campaignId,
          budgets: budgets.map((item) => ({
            funnelId: item.funnelId,
            creativeIds: item.creativeIds,
            adsCount: Math.max(1, Number(item.adsCount || 1)),
            contentGoal: item.contentGoal,
            expectedGoal: item.expectedGoal,
            platformAmounts: item.platformAmounts.map((part) => ({
              platformId: part.platformId,
              amount: Math.max(0, Number(part.amount || 0)),
            })),
          })),
        }),
      });
      await onSaved(result.message);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "تعذر حفظ ميزانية الحملة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="إدارة ميزانية الحملة"
      subtitle={`${campaignName || "الحملة"} — الحسبة تعتمد على قيمة كل بند Funnel مرة واحدة دون مضاعفة حسب عدد الكرييتيفات أو المنصات.`}
      onClose={onClose}
      className="marketing-campaign-budget-modal"
      level={1}
      footer={<div className="marketing-campaign-budget-footer"><button type="button" className="secondary" disabled={saving} onClick={onClose}>إلغاء</button><button type="button" className="primary" disabled={saving} onClick={() => void save()}><FloppyDisk size={18} />{saving ? "جاري حفظ الميزانية..." : "حفظ الميزانية"}</button></div>}
    >
      <div className="marketing-campaign-budget-manager">
        <section className="marketing-campaign-budget-summary" aria-label="ملخص الميزانية">
          <article><span>بنود الميزانية</span><strong>{budgets.length.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
          <article><span>المنصات المستخدمة</span><strong>{selectedPlatforms.toLocaleString("ar-SA-u-nu-latn")}</strong></article>
          <article className="total"><span>إجمالي الميزانية</span><strong>{grandTotal.toLocaleString("ar-SA-u-nu-latn")} ر.س</strong></article>
        </section>

        {error ? <div className="marketing-campaign-budget-error">{error}</div> : null}

        <div className="marketing-campaign-budget-list">
          {budgets.map((budget, index) => (
            <article key={budget.id} className="marketing-budget-card marketing-campaign-budget-edit-card">
              <header className="marketing-budget-card-head">
                <div><span>بند الميزانية</span><strong>{index + 1}</strong></div>
                <div className="marketing-campaign-budget-card-total"><small>إجمالي البند</small><b>{budgetTotal(budget).toLocaleString("ar-SA-u-nu-latn")} ر.س</b></div>
                <button type="button" className="marketing-card-delete" aria-label={`حذف بند الميزانية ${index + 1}`} onClick={() => setBudgets((current) => current.filter((item) => item.id !== budget.id))}><Trash size={18} /></button>
              </header>

              <div className="marketing-budget-fields marketing-campaign-budget-fields">
                <FunnelSelect
                  value={budget.funnelId}
                  funnels={meta.funnels}
                  onCreated={(funnel) => onFunnelCreated?.(funnel)}
                  onChange={(funnelId) => updateBudget(budget.id, (item) => ({ ...item, funnelId }))}
                />
                <label><span>عدد الإعلانات</span><input type="number" min={1} value={budget.adsCount} onChange={(event) => updateBudget(budget.id, (item) => ({ ...item, adsCount: Math.max(1, Number(event.target.value) || 1) }))} /></label>
                <label><span>هدف المحتوى</span><input value={budget.contentGoal} onChange={(event) => updateBudget(budget.id, (item) => ({ ...item, contentGoal: event.target.value }))} /></label>
                <label><span>الهدف المتوقع</span><input value={budget.expectedGoal} onChange={(event) => updateBudget(budget.id, (item) => ({ ...item, expectedGoal: event.target.value }))} /></label>
              </div>

              <div className="marketing-campaign-budget-creative-picker">
                <CreativeMultiPicker
                  label="المنتج / الكرييتيف"
                  hint="يمكن ربط البند بأكثر من كرييتيف، ويظل إجمالي البند محسوبًا مرة واحدة."
                  items={creativeItems}
                  value={budget.creativeIds}
                  onChange={(creativeIds) => updateBudget(budget.id, (item) => ({ ...item, creativeIds }))}
                />
              </div>

              <div className="marketing-budget-platforms">
                {meta.platforms.map((platform) => {
                  const selected = budget.platformAmounts.find((item) => item.platformId === platform.id);
                  return (
                    <section key={platform.id} className={selected ? "selected" : ""}>
                      <label className="marketing-budget-platform-head">
                        <input
                          type="checkbox"
                          checked={Boolean(selected)}
                          onChange={() => updateBudget(budget.id, (item) => ({
                            ...item,
                            platformAmounts: selected
                              ? item.platformAmounts.filter((part) => part.platformId !== platform.id)
                              : [...item.platformAmounts, { platformId: platform.id, amount: 0 }],
                          }))}
                        />
                        <strong>{platform.name}</strong>
                      </label>
                      <input
                        type="number"
                        min={0}
                        disabled={!selected}
                        value={selected?.amount ?? ""}
                        placeholder={`قيمة ${platform.name}`}
                        onChange={(event) => updateBudget(budget.id, (item) => ({
                          ...item,
                          platformAmounts: item.platformAmounts.map((part) => part.platformId === platform.id
                            ? { ...part, amount: Math.max(0, Number(event.target.value) || 0) }
                            : part),
                        }))}
                      />
                    </section>
                  );
                })}
              </div>
            </article>
          ))}

          {!budgets.length ? <div className="marketing-campaign-budget-empty"><CurrencyCircleDollar size={34} weight="duotone" /><strong>لا توجد بنود ميزانية</strong><span>اضغط على «إضافة بند ميزانية» لإنشاء ميزانية الحملة.</span></div> : null}
        </div>

        <button type="button" className="marketing-add-block marketing-add-budget" onClick={() => setBudgets((current) => [...current, newBudget()])}><Plus size={18} />إضافة بند ميزانية</button>
      </div>
    </Modal>
  );
}

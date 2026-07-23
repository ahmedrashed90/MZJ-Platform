import { CampaignBuilder } from "../components/CampaignBuilder";
import { MarketingAlert, MarketingPageHeader } from "../components/Ui";
import { useMarketingMeta } from "../MarketingLayout";

export function CreateCampaignPage() {
  const { meta } = useMarketingMeta();
  if (!meta.access.campaignsManage) {
    return <div className="marketing-page"><MarketingPageHeader title="إنشاء حملة" description="إنشاء الحملات متاح للمستخدمين المخولين فقط." /><MarketingAlert>لا توجد لديك صلاحية إنشاء الحملات.</MarketingAlert></div>;
  }
  return <CampaignBuilder mode="campaign" />;
}

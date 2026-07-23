import { CampaignBuilder } from "../components/CampaignBuilder";
import { MarketingAlert, MarketingPageHeader } from "../components/Ui";
import { useMarketingMeta } from "../MarketingLayout";

export function CreateAgendaPage() {
  const { meta } = useMarketingMeta();
  if (!meta.access.campaignsManage) {
    return <div className="marketing-page"><MarketingPageHeader title="إنشاء أجندة" description="إنشاء الأجندات متاح للمستخدمين المخولين فقط." /><MarketingAlert>لا توجد لديك صلاحية إنشاء الأجندات.</MarketingAlert></div>;
  }
  return <CampaignBuilder mode="agenda" />;
}

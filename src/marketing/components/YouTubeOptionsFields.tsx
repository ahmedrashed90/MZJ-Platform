import { YoutubeLogo, SpinnerGap } from "@phosphor-icons/react";
import type { YouTubePublishOptions, YouTubeOptionItem } from "../../../shared/youtube-publishing";
export function YouTubeOptionsFields({
  value,
  onChange,
  categories,
  playlists,
  loading,
}: {
  value: YouTubePublishOptions;
  onChange: (value: YouTubePublishOptions) => void;
  categories: YouTubeOptionItem[];
  playlists: Array<YouTubeOptionItem & { privacyStatus?: string }>;
  loading: boolean;
}) {
  return <section className="marketing-publish-edit-section marketing-youtube-publish-section">
    <header><span><YoutubeLogo size={24} weight="fill" /></span><div><h3>إعدادات فيديو YouTube</h3><p>تم تحميل الإعدادات الافتراضية للقناة، ويمكن تخصيص هذا الفيديو فقط قبل النشر.</p></div>{loading ? <SpinnerGap className="marketing-spin" size={19} /> : null}</header>
    <div className="marketing-form-grid">
      <label className="full"><span>عنوان الفيديو</span><input maxLength={100} value={value.title || ""} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="عنوان واضح للفيديو" /><small>{String(value.title || "").length}/100</small></label>
      <label className="full"><span>وصف الفيديو</span><textarea rows={6} value={value.description || ""} onChange={(event) => onChange({ ...value, description: event.target.value })} /></label>
      <label className="full"><span>الكلمات المفتاحية</span><textarea rows={3} value={(value.tags || []).join("، ")} onChange={(event) => onChange({ ...value, tags: event.target.value.split(/[،,\n]+/).map((item) => item.trim()).filter(Boolean) })} placeholder="سيارات، MZJ، عروض" /></label>
      <label><span>حالة الظهور</span><select value={value.privacyStatus || "unlisted"} onChange={(event) => onChange({ ...value, privacyStatus: event.target.value as YouTubePublishOptions["privacyStatus"] })}><option value="unlisted">غير مدرج — بالرابط فقط</option><option value="private">خاص</option><option value="public">عام</option></select></label>
      <label><span>تصنيف الفيديو</span><select value={value.categoryId || "2"} onChange={(event) => onChange({ ...value, categoryId: event.target.value })}>{categories.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label><span>قائمة التشغيل</span><select value={value.playlistId || ""} onChange={(event) => onChange({ ...value, playlistId: event.target.value })}><option value="">بدون قائمة تشغيل</option>{playlists.map((item) => <option key={item.id} value={item.id}>{item.title}{item.privacyStatus ? ` — ${item.privacyStatus}` : ""}</option>)}</select></label>
      <label><span>لغة الفيديو</span><input dir="ltr" value={value.defaultLanguage || "ar"} onChange={(event) => onChange({ ...value, defaultLanguage: event.target.value })} /></label>
      <label><span>الترخيص</span><select value={value.license || "youtube"} onChange={(event) => onChange({ ...value, license: event.target.value as YouTubePublishOptions["license"] })}><option value="youtube">ترخيص YouTube القياسي</option><option value="creativeCommon">Creative Commons</option></select></label>
      <label><span>مخصص للأطفال</span><select value={value.madeForKids ? "true" : "false"} onChange={(event) => onChange({ ...value, madeForKids: event.target.value === "true" })}><option value="false">لا</option><option value="true">نعم</option></select></label>
      <div className="marketing-youtube-task-toggles">
        <label><input type="checkbox" checked={Boolean(value.notifySubscribers)} onChange={(event) => onChange({ ...value, notifySubscribers: event.target.checked })} /><span>إشعار المشتركين</span></label>
        <label><input type="checkbox" checked={Boolean(value.embeddable)} onChange={(event) => onChange({ ...value, embeddable: event.target.checked })} /><span>السماح بالتضمين</span></label>
        <label><input type="checkbox" checked={Boolean(value.publicStatsViewable)} onChange={(event) => onChange({ ...value, publicStatsViewable: event.target.checked })} /><span>إظهار الإحصاءات العامة</span></label>
      </div>
    </div>
  </section>;
}


import { useEffect,useMemo,useState } from 'react';
import { FloppyDisk,Gift,ShieldCheck,WhatsappLogo } from '@phosphor-icons/react';
import { useAuth } from '../auth/AuthContext';
import { hasPermission } from '../systemAccess';
import { ownersAdminGet,ownersAdminPost } from './api';

export function OwnersSettingsPanel(){
 const {user}=useAuth(); const editable=hasPermission(user,'settings.owners.manage')||hasPermission(user,'owners.community.manage');
 const [data,setData]=useState<any>(null); const [form,setForm]=useState<any>({}); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
 async function load(){const x=await ownersAdminGet('settings');setData(x);const s=x.settings||{};setForm({isEnabled:s.is_enabled!==false,otpTemplateId:s.otp_template_id||'',welcomeTemplateId:s.welcome_template_id||'',otpExpiryMinutes:s.otp_expiry_minutes||5,otpResendSeconds:s.otp_resend_seconds||60,otpMaxAttempts:s.otp_max_attempts||5,pointsUniqueOpen:s.points_unique_open??1,pointsRegistration:s.points_registration??10,pointsQualified:s.points_qualified??25,pointsSale:s.points_sale??500,dailyOpenPointsCap:s.daily_open_points_cap??25,referralDefaultService:s.referral_default_service||'cash',referralDefaultBranch:s.referral_default_branch||'online',friendBenefitTitle:s.friend_benefit_title||'',friendBenefitText:s.friend_benefit_text||'',welcomeMessageEnabled:s.welcome_message_enabled===true});}
 useEffect(()=>{void load().catch(e=>setMessage(e.message))},[]);
 const templates=useMemo(()=>data?.templates||[],[data]);
 async function save(){setBusy(true);setMessage('');try{await ownersAdminPost({action:'save_settings',...form});setMessage('تم حفظ إعدادات MZJ Owners Community');await load();}catch(e:any){setMessage(e.message)}finally{setBusy(false)}}
 if(!data)return <div className="owners-panel owners-loading">جاري تحميل إعدادات MZJ Owners Community...</div>;
 return <div className="owners-panel owners-settings" dir="rtl">
  <header className="owners-section-head"><div><ShieldCheck size={28}/><div><h2>إعدادات MZJ Owners Community</h2><p>إدارة التحقق عبر واتساب، قواعد النقاط، ورحلة الدعوة من مكان واحد.</p></div></div><span className={form.isEnabled?'owners-badge ok':'owners-badge'}>{form.isEnabled?'البرنامج مفعل':'البرنامج متوقف'}</span></header>
  {message?<div className="owners-notice">{message}</div>:null}
  <section className="owners-settings-card"><h3><WhatsappLogo size={21}/> واتساب و OTP</h3><div className="owners-form-grid">
   <label><span>حالة البرنامج</span><select disabled={!editable} value={form.isEnabled?'on':'off'} onChange={e=>setForm({...form,isEnabled:e.target.value==='on'})}><option value="on">مفعل</option><option value="off">متوقف مؤقتًا</option></select></label>
   <label><span>قالب OTP المعتمد من مرسال</span><select disabled={!editable} value={form.otpTemplateId} onChange={e=>setForm({...form,otpTemplateId:e.target.value})}><option value="">اختر القالب</option>{templates.map((t:any)=><option key={t.id} value={t.id}>{t.display_name||t.name}</option>)}</select></label>
   <label><span>قالب ترحيب العضو</span><select disabled={!editable} value={form.welcomeTemplateId} onChange={e=>setForm({...form,welcomeTemplateId:e.target.value})}><option value="">بدون قالب</option>{templates.map((t:any)=><option key={t.id} value={t.id}>{t.display_name||t.name}</option>)}</select></label>
   <label><span>صلاحية OTP بالدقائق</span><input disabled={!editable} type="number" min="1" max="30" value={form.otpExpiryMinutes} onChange={e=>setForm({...form,otpExpiryMinutes:Number(e.target.value)})}/></label>
   <label><span>إعادة الإرسال بعد (ثانية)</span><input disabled={!editable} type="number" min="15" value={form.otpResendSeconds} onChange={e=>setForm({...form,otpResendSeconds:Number(e.target.value)})}/></label>
   <label><span>أقصى محاولات للكود</span><input disabled={!editable} type="number" min="1" value={form.otpMaxAttempts} onChange={e=>setForm({...form,otpMaxAttempts:Number(e.target.value)})}/></label>
  </div></section>
  <section className="owners-settings-card"><h3><Gift size={21}/> قواعد النقاط</h3><div className="owners-form-grid four">
   <label><span>فتح رابط فريد</span><input disabled={!editable} type="number" min="0" value={form.pointsUniqueOpen} onChange={e=>setForm({...form,pointsUniqueOpen:Number(e.target.value)})}/></label>
   <label><span>تسجيل صديق</span><input disabled={!editable} type="number" min="0" value={form.pointsRegistration} onChange={e=>setForm({...form,pointsRegistration:Number(e.target.value)})}/></label>
   <label><span>Lead مؤهل</span><input disabled={!editable} type="number" min="0" value={form.pointsQualified} onChange={e=>setForm({...form,pointsQualified:Number(e.target.value)})}/></label>
   <label><span>إتمام البيع</span><input disabled={!editable} type="number" min="0" value={form.pointsSale} onChange={e=>setForm({...form,pointsSale:Number(e.target.value)})}/></label>
   <label><span>حد نقاط فتح الروابط يوميًا</span><input disabled={!editable} type="number" min="0" value={form.dailyOpenPointsCap} onChange={e=>setForm({...form,dailyOpenPointsCap:Number(e.target.value)})}/></label>
   <label><span>مسار العميل الافتراضي</span><select disabled={!editable} value={form.referralDefaultService} onChange={e=>setForm({...form,referralDefaultService:e.target.value})}><option value="cash">مبيعات الكاش</option><option value="finance">مبيعات التمويل</option></select></label>
   <label><span>الفرع الافتراضي للدعوات</span><input disabled={!editable} value={form.referralDefaultBranch} onChange={e=>setForm({...form,referralDefaultBranch:e.target.value})}/></label>
  </div></section>
  <section className="owners-settings-card"><h3>صفحة الصديق المدعو</h3><div className="owners-form-grid"><label><span>عنوان الميزة</span><input disabled={!editable} value={form.friendBenefitTitle} onChange={e=>setForm({...form,friendBenefitTitle:e.target.value})}/></label><label className="wide"><span>وصف الميزة</span><textarea disabled={!editable} value={form.friendBenefitText} onChange={e=>setForm({...form,friendBenefitText:e.target.value})}/></label></div></section>
  {editable?<div className="owners-save-row"><button className="owners-primary" disabled={busy} onClick={()=>void save()}><FloppyDisk size={19}/>{busy?'جاري الحفظ...':'حفظ الإعدادات'}</button></div>:null}
 </div>
}

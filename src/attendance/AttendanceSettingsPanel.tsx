import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  Clock,
  Desktop,
  FloppyDisk,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  ShieldCheck,
  ShieldSlash,
  UsersThree,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { attendanceFetch } from "./api";

type PeriodRow = {
  id?: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  sortOrder?: number;
};

type ScheduleRow = {
  id: string;
  name: string;
  periods: PeriodRow[];
};


type DeviceRow = {
  id: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  agentVersion: string | null;
  status: "pending" | "approved" | "revoked";
  approvedAt: string | null;
  revokedAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
};

type UserRow = {
  id: string;
  employee_no: string | null;
  full_name: string;
  email: string | null;
  mobile: string | null;
  branch_id: string | null;
  branch_name: string;
  assignment_id: string | null;
  schedule_id: string | null;
  period_ids: string[];
  weekly_off_day: number | null;
  schedule_name: string | null;
  device_verification_required: boolean;
  devices: DeviceRow[];
};

type BranchRow = { id: string; code: string; name: string };

type AdminPayload = {
  ok: true;
  settings: { enforcementEnabled: boolean; officialDayEnd: string };
  schedules: ScheduleRow[];
  users: UserRow[];
  branches: BranchRow[];
};

const WEEKLY_OFF_DAYS = [
  { value: "0", label: "الأحد" },
  { value: "1", label: "الاثنين" },
  { value: "2", label: "الثلاثاء" },
  { value: "3", label: "الأربعاء" },
  { value: "4", label: "الخميس" },
  { value: "5", label: "الجمعة" },
  { value: "6", label: "السبت" },
] as const;

function weeklyOffDayLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "بدون إجازة أسبوعية";
  const option = WEEKLY_OFF_DAYS.find((day) => Number(day.value) === Number(value));
  return option?.label || "بدون إجازة أسبوعية";
}

const blankSchedule = (): { id: string; name: string; periods: PeriodRow[] } => ({
  id: "",
  name: "",
  periods: [{ name: "الفترة 1", startTime: "", endTime: "", graceMinutes: 15 }],
});

export function AttendanceSettingsPanel() {
  const [data, setData] = useState<AdminPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleForm, setScheduleForm] = useState(blankSchedule);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [assignmentScheduleId, setAssignmentScheduleId] = useState("");
  const [assignmentPeriodIds, setAssignmentPeriodIds] = useState<string[]>([]);
  const [assignmentBranchId, setAssignmentBranchId] = useState("");
  const [assignmentWeeklyOffDay, setAssignmentWeeklyOffDay] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [deviceUserId, setDeviceUserId] = useState("");
  const [officialDayEnd, setOfficialDayEnd] = useState("21:00");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await attendanceFetch<AdminPayload>("/api/attendance?view=admin");
      setData(payload);
      setOfficialDayEnd(payload.settings?.officialDayEnd || "21:00");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل إعدادات الحضور والانصراف");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    return (data?.users || []).filter((user) => !term || `${user.full_name} ${user.employee_no || ""} ${user.branch_name || ""} ${user.schedule_name || ""} ${weeklyOffDayLabel(user.weekly_off_day)}`.toLowerCase().includes(term));
  }, [data?.users, userSearch]);

  const assignmentSchedule = useMemo(
    () => (data?.schedules || []).find((schedule) => schedule.id === assignmentScheduleId) || null,
    [data?.schedules, assignmentScheduleId],
  );

  function resetMessages() {
    setError("");
    setMessage("");
  }

  function resetAssignmentEditor() {
    setSelectedUsers([]);
    setAssignmentScheduleId("");
    setAssignmentPeriodIds([]);
    setAssignmentBranchId("");
    setAssignmentWeeklyOffDay("");
    setEditingUserId("");
  }

  async function saveEnforcement(enforcementEnabled: boolean) {
    resetMessages();
    if (enforcementEnabled && !window.confirm("تفعيل إلزام الحضور سيُنهي جلسات اليوزرات المعيّن لهم جداول عمل، وبعدها سيطلب منهم تسجيل الحضور حسب فتراتهم. هل تريد المتابعة؟")) return;
    setBusy("settings");
    try {
      const result = await attendanceFetch<{ ok: true; enforcementEnabled: boolean; forcedLogoutUsers?: number }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "save_settings", enforcementEnabled }),
      });
      setMessage(result.enforcementEnabled
        ? `تم تفعيل إلزام الحضور${result.forcedLogoutUsers ? ` وإنهاء جلسات ${result.forcedLogoutUsers} يوزر لبدء دورة حضور جديدة` : ""}`
        : "تم تفعيل الوضع الآمن — الدخول متاح للجميع بدون إلزام حضور أو خروج تلقائي");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ إعداد تطبيق الحضور");
    } finally {
      setBusy("");
    }
  }

  async function saveOfficialDayEnd() {
    resetMessages();
    if (!/^\d{2}:\d{2}$/.test(officialDayEnd)) return;
    setBusy("official-day-end");
    try {
      const result = await attendanceFetch<{ ok: true; officialDayEnd: string }>("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "save_settings", officialDayEnd }),
      });
      setOfficialDayEnd(result.officialDayEnd || officialDayEnd);
      setMessage("تم حفظ نهاية الدوام الرسمية");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ نهاية الدوام الرسمية");
    } finally {
      setBusy("");
    }
  }

  function updatePeriod(index: number, field: keyof PeriodRow, value: string | number) {
    setScheduleForm((current) => ({
      ...current,
      periods: current.periods.map((period, periodIndex) => periodIndex === index ? { ...period, [field]: value } : period),
    }));
  }

  function addPeriod() {
    setScheduleForm((current) => ({
      ...current,
      periods: [...current.periods, { name: `الفترة ${current.periods.length + 1}`, startTime: "", endTime: "", graceMinutes: 15 }],
    }));
  }

  function removePeriod(index: number) {
    setScheduleForm((current) => ({
      ...current,
      periods: current.periods.filter((_, periodIndex) => periodIndex !== index).map((period, periodIndex) => ({
        ...period,
        name: period.name || `الفترة ${periodIndex + 1}`,
      })),
    }));
  }

  function editSchedule(schedule: ScheduleRow) {
    resetMessages();
    setScheduleForm({
      id: schedule.id,
      name: schedule.name,
      periods: schedule.periods.map((period, index) => ({
        id: period.id,
        name: period.name || `الفترة ${index + 1}`,
        startTime: period.startTime,
        endTime: period.endTime,
        graceMinutes: Number(period.graceMinutes || 0),
      })),
    });
  }

  async function saveSchedule(event: React.FormEvent) {
    event.preventDefault();
    resetMessages();
    setBusy("schedule");
    try {
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "save_settings", officialDayEnd }),
      });
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "save_schedule", ...scheduleForm }),
      });
      setScheduleForm(blankSchedule());
      setMessage("تم حفظ جدول وفترات العمل");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ جدول العمل");
    } finally {
      setBusy("");
    }
  }

  async function deleteSchedule(id: string) {
    resetMessages();
    if (!window.confirm("حذف جدول العمل؟")) return;
    setBusy(`delete-schedule:${id}`);
    try {
      await attendanceFetch("/api/attendance", { method: "POST", body: JSON.stringify({ action: "delete_schedule", id }) });
      setMessage("تم حذف جدول العمل");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف جدول العمل");
    } finally {
      setBusy("");
    }
  }

  function toggleUser(id: string) {
    setEditingUserId("");
    setSelectedUsers((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    setEditingUserId("");
    const visible = filteredUsers.map((user) => user.id);
    const allSelected = visible.length > 0 && visible.every((id) => selectedUsers.includes(id));
    setSelectedUsers((current) => allSelected ? current.filter((id) => !visible.includes(id)) : Array.from(new Set([...current, ...visible])));
  }

  function changeAssignmentSchedule(scheduleId: string) {
    setAssignmentScheduleId(scheduleId);
    const schedule = (data?.schedules || []).find((item) => item.id === scheduleId);
    setAssignmentPeriodIds(schedule?.periods.length === 1 && schedule.periods[0]?.id ? [schedule.periods[0].id] : []);
  }

  function toggleAssignmentPeriod(periodId: string) {
    setAssignmentPeriodIds((current) => current.includes(periodId) ? current.filter((id) => id !== periodId) : [...current, periodId]);
  }

  function userPeriodNames(user: UserRow) {
    const schedule = (data?.schedules || []).find((item) => item.id === user.schedule_id);
    if (!schedule) return "—";
    const selected = Array.isArray(user.period_ids) && user.period_ids.length ? user.period_ids : schedule.periods.map((period) => period.id).filter(Boolean) as string[];
    const names = schedule.periods.filter((period) => period.id && selected.includes(period.id)).map((period) => period.name);
    return names.length ? names.join("، ") : "—";
  }

  function editUserAssignment(user: UserRow) {
    resetMessages();
    setSelectedUsers([user.id]);
    setEditingUserId(user.id);
    setAssignmentScheduleId(user.schedule_id || "");
    const schedule = (data?.schedules || []).find((item) => item.id === user.schedule_id);
    const fallbackPeriods = schedule?.periods.map((period) => period.id).filter(Boolean) as string[] | undefined;
    setAssignmentPeriodIds(user.period_ids?.length ? user.period_ids : fallbackPeriods || []);
    setAssignmentBranchId(user.branch_id || "");
    setAssignmentWeeklyOffDay(user.weekly_off_day === null || user.weekly_off_day === undefined ? "" : String(user.weekly_off_day));
    window.setTimeout(() => document.getElementById("attendance-assignment-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  async function applyAssignment(unassign = false) {
    resetMessages();
    if (!selectedUsers.length) {
      setError("اختر اليوزرات أولًا");
      return;
    }
    if (!unassign && !assignmentScheduleId) {
      setError("اختر جدول العمل");
      return;
    }
    if (!unassign && !assignmentPeriodIds.length) {
      setError("اختر فترة عمل واحدة على الأقل");
      return;
    }
    setBusy("assignment");
    try {
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          action: "assign_users",
          userIds: selectedUsers,
          scheduleId: unassign ? "" : assignmentScheduleId,
          periodIds: unassign ? [] : assignmentPeriodIds,
          branchId: unassign ? "" : assignmentBranchId,
          weeklyOffDay: unassign ? "" : assignmentWeeklyOffDay,
        }),
      });
      setMessage(unassign ? "تم إلغاء جدول العمل من اليوزرات المحددين" : editingUserId ? "تم تعديل بيانات دوام الموظف" : "تم تطبيق جدول العمل والفترات والفرع ويوم الإجازة على اليوزرات المحددين");
      resetAssignmentEditor();
      await load();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "تعذر تطبيق جدول العمل");
    } finally {
      setBusy("");
    }
  }

  async function saveDevicePolicy(userId: string, required: boolean) {
    resetMessages();
    setBusy(`device-policy:${userId}`);
    try {
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "set_device_policy", userIds: [userId], required }),
      });
      setMessage(required ? "تم تفعيل التحقق من جهاز العمل" : "تم استثناء اليوزر من التحقق من الجهاز");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ إعداد التحقق من الجهاز");
    } finally {
      setBusy("");
    }
  }

  async function approveDevice(deviceRecordId: string) {
    resetMessages();
    setBusy(`approve-device:${deviceRecordId}`);
    try {
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "approve_device", deviceRecordId }),
      });
      setMessage("تم اعتماد جهاز العمل");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر اعتماد الجهاز");
    } finally {
      setBusy("");
    }
  }

  async function revokeDevice(deviceRecordId: string) {
    resetMessages();
    if (!window.confirm("إلغاء اعتماد هذا الجهاز؟")) return;
    setBusy(`revoke-device:${deviceRecordId}`);
    try {
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({ action: "revoke_device", deviceRecordId }),
      });
      setMessage("تم إلغاء اعتماد الجهاز");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر إلغاء اعتماد الجهاز");
    } finally {
      setBusy("");
    }
  }

  const deviceUser = (data?.users || []).find((user) => user.id === deviceUserId) || null;

  if (loading && !data) return <div className="crm-loading-panel">جاري تحميل إعدادات الحضور والانصراف...</div>;

  return (
    <div className="attendance-settings">
      <div className="attendance-settings-intro">
        <div><Clock size={25} weight="duotone" /><span><strong>إعدادات الحضور والانصراف</strong><small>مدير النظام فقط — جداول العمل والفترات والفرع ويوم الإجازة لكل يوزر.</small></span></div>
      </div>

      {error ? <div className="attendance-alert error"><WarningCircle size={19} /><span>{error}</span></div> : null}
      {message ? <div className="attendance-alert success"><FloppyDisk size={19} /><span>{message}</span></div> : null}

      <section className="attendance-settings-card panel attendance-enforcement-card">
        <header><div><WarningCircle size={22} weight="duotone" /><span><h2>تطبيق الحضور على تسجيل الدخول</h2><p>ابدأ بالوضع الآمن أثناء تجهيز جداول اليوزرات، ثم فعّل الإلزام بعد التأكد من الجداول والفترات.</p></span></div></header>
        <div className={`attendance-enforcement-control ${data?.settings?.enforcementEnabled ? "enabled" : "safe"}`}>
          <div>
            <strong>{data?.settings?.enforcementEnabled ? "الإلزام مفعل" : "الوضع الآمن مفعل"}</strong>
            <span>{data?.settings?.enforcementEnabled
              ? "اليوزر المعيّن له جدول يجب أن يسجل الحضور داخل فترته، والانصراف والخروج التلقائي يعملان عند نهاية الفترة."
              : "كل اليوزرات يستطيعون تسجيل الدخول حتى لو لم تكتمل الجداول. لا يتم منع الدخول أو إنهاء الجلسات تلقائيًا بسبب الحضور."}</span>
          </div>
          <button
            className={data?.settings?.enforcementEnabled ? "secondary-button danger" : "attendance-save-button"}
            type="button"
            disabled={busy === "settings"}
            onClick={() => void saveEnforcement(!Boolean(data?.settings?.enforcementEnabled))}
          >
            {busy === "settings" ? "جاري الحفظ..." : data?.settings?.enforcementEnabled ? "إيقاف الإلزام" : "تفعيل الإلزام"}
          </button>
        </div>
      </section>

      <section className="attendance-settings-card panel">
        <header><div><Clock size={22} weight="duotone" /><span><h2>جداول وفترات العمل</h2><p>يمكن أن يحتوي الجدول على فترات بديلة ومتداخلة مثل «متواصل». عند تعيين الموظف تختار فقط الفترة أو الفترات الخاصة به.</p></span></div></header>
        <div className="attendance-settings-two-columns schedules">
          <form className="attendance-schedule-form" onSubmit={saveSchedule}>
            <label className="attendance-wide-field"><span>نهاية الدوام الرسمية</span><input required type="time" value={officialDayEnd} onChange={(event) => setOfficialDayEnd(event.target.value)} onBlur={() => void saveOfficialDayEnd()} disabled={busy === "official-day-end"} /></label>
            <label className="attendance-wide-field"><span>اسم جدول العمل</span><input required value={scheduleForm.name} onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))} placeholder="مثال: المعارض" /></label>
            <div className="attendance-period-editor">
              {scheduleForm.periods.map((period, index) => (
                <div className="attendance-period-row" key={period.id || `new-${index}`}>
                  <div className="attendance-period-title"><strong>الفترة {index + 1}</strong>{scheduleForm.periods.length > 1 ? <button type="button" onClick={() => removePeriod(index)}><Trash size={16} /></button> : null}</div>
                  <label><span>اسم الفترة</span><input value={period.name} onChange={(event) => updatePeriod(index, "name", event.target.value)} placeholder="مثال: الفترة المسائية أو متواصل" /></label>
                  <label><span>بداية الدوام</span><input required type="time" value={period.startTime} onChange={(event) => updatePeriod(index, "startTime", event.target.value)} /></label>
                  <label><span>نهاية الدوام</span><input required type="time" value={period.endTime} onChange={(event) => updatePeriod(index, "endTime", event.target.value)} /></label>
                  <label><span>دقائق السماح للحضور</span><input required type="number" min={0} max={360} value={period.graceMinutes} onChange={(event) => updatePeriod(index, "graceMinutes", Number(event.target.value))} /></label>
                </div>
              ))}
            </div>
            <div className="attendance-form-actions">
              <button className="secondary-button" type="button" onClick={addPeriod}><Plus size={17} /> إضافة فترة</button>
              <button className="attendance-save-button" type="submit" disabled={busy === "schedule"}><FloppyDisk size={18} /> {scheduleForm.id ? "حفظ جدول العمل" : "إنشاء جدول العمل"}</button>
              {scheduleForm.id ? <button className="secondary-button" type="button" onClick={() => setScheduleForm(blankSchedule())}>إلغاء التعديل</button> : null}
            </div>
          </form>

          <div className="attendance-schedule-list">
            {(data?.schedules || []).map((schedule) => (
              <article key={schedule.id}>
                <header><div><strong>{schedule.name}</strong><span>{schedule.periods.length} فترة</span></div><div><button type="button" onClick={() => editSchedule(schedule)}><PencilSimple size={17} /></button><button type="button" onClick={() => void deleteSchedule(schedule.id)} disabled={busy === `delete-schedule:${schedule.id}`}><Trash size={17} /></button></div></header>
                <div>{schedule.periods.map((period, index) => <p key={period.id || index}><b>{period.name || `الفترة ${index + 1}`}</b><span>{period.startTime} → {period.endTime}</span><small>سماح {period.graceMinutes} د</small></p>)}</div>
              </article>
            ))}
            {!data?.schedules?.length ? <p className="attendance-empty">لم يتم إنشاء جداول عمل بعد.</p> : null}
          </div>
        </div>
      </section>

      <section className="attendance-settings-card panel">
        <header><div><UsersThree size={22} weight="duotone" /><span><h2>تحديد مواعيد العمل لليوزرات</h2><p>جداول العمل والفترات والفرع ويوم الإجازة والتحقق من جهاز العمل لكل يوزر.</p></span></div></header>
        <div className="attendance-assignment-toolbar" id="attendance-assignment-editor">
          <label><span>جدول العمل</span><select value={assignmentScheduleId} onChange={(event) => changeAssignmentSchedule(event.target.value)}><option value="">اختر جدول العمل</option>{(data?.schedules || []).map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select></label>
          <label><span>الفرع</span><select value={assignmentBranchId} onChange={(event) => setAssignmentBranchId(event.target.value)}><option value="">استخدام الفرع الحالي للموظف</option>{(data?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label><span>يوم الإجازة</span><select value={assignmentWeeklyOffDay} onChange={(event) => setAssignmentWeeklyOffDay(event.target.value)}><option value="">بدون إجازة أسبوعية</option>{WEEKLY_OFF_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
          <div className="attendance-assignment-actions">
            <button className="attendance-save-button" type="button" onClick={() => void applyAssignment(false)} disabled={busy === "assignment" || !selectedUsers.length}><FloppyDisk size={18} /> {editingUserId ? "حفظ تعديل اليوزر" : `تطبيق على المحدد (${selectedUsers.length})`}</button>
            <button className="secondary-button danger" type="button" onClick={() => void applyAssignment(true)} disabled={busy === "assignment" || !selectedUsers.length}>إلغاء جدول المحدد</button>
            {editingUserId ? <button className="secondary-button" type="button" onClick={resetAssignmentEditor}>إلغاء التعديل</button> : null}
          </div>
          {assignmentSchedule ? (
            <div className="attendance-period-selector">
              <span>فترات العمل لهذا التعيين</span>
              <div>
                {assignmentSchedule.periods.map((period) => (
                  <label key={period.id || period.name} className={period.id && assignmentPeriodIds.includes(period.id) ? "selected" : ""}>
                    <input type="checkbox" checked={Boolean(period.id && assignmentPeriodIds.includes(period.id))} disabled={!period.id} onChange={() => period.id && toggleAssignmentPeriod(period.id)} />
                    <strong>{period.name}</strong>
                    <small>{period.startTime} - {period.endTime}</small>
                  </label>
                ))}
              </div>
              <small>الفترات المتداخلة مسموحة داخل الجدول، لكن لا يمكن تعيين فترتين متداخلتين لنفس اليوزر.</small>
            </div>
          ) : null}
        </div>

        <div className="attendance-user-search">
          <MagnifyingGlass size={18} />
          <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="ابحث باسم الموظف أو رقم الموظف أو الفرع" />
          <button className="secondary-button" type="button" onClick={toggleAllVisible}>تحديد / إلغاء الكل الظاهر</button>
        </div>

        {deviceUser ? (
          <div className="attendance-device-panel">
            <div className="attendance-device-panel-head">
              <div><Desktop size={20} weight="duotone" /><strong>{deviceUser.full_name}</strong></div>
              <button className="secondary-button" type="button" onClick={() => setDeviceUserId("")}>إغلاق</button>
            </div>
            <div className="attendance-device-list">
              {(deviceUser.devices || []).map((device) => (
                <article key={device.id} className={`attendance-device-item ${device.status}`}>
                  <div className="attendance-device-icon"><Desktop size={20} weight="duotone" /></div>
                  <div className="attendance-device-info">
                    <strong>{device.deviceName}</strong>
                    <span dir="ltr">{device.deviceId}</span>
                    <small>{device.lastVerifiedAt ? `آخر تحقق ${new Date(device.lastVerifiedAt).toLocaleString("ar-SA")}` : "لم يسجل دخول بعد"}</small>
                  </div>
                  <div className={`attendance-device-status ${device.status}`}>
                    {device.status === "approved" ? <><CheckCircle size={16} weight="fill" /> معتمد</> : device.status === "pending" ? <><WarningCircle size={16} weight="fill" /> بانتظار الاعتماد</> : <><XCircle size={16} weight="fill" /> ملغي</>}
                  </div>
                  <div className="attendance-device-actions">
                    {device.status !== "approved" ? (
                      <button className="attendance-save-button" type="button" disabled={busy === `approve-device:${device.id}`} onClick={() => void approveDevice(device.id)}><ShieldCheck size={17} /> اعتماد</button>
                    ) : (
                      <button className="secondary-button danger" type="button" disabled={busy === `revoke-device:${device.id}`} onClick={() => void revokeDevice(device.id)}><ShieldSlash size={17} /> إلغاء الاعتماد</button>
                    )}
                  </div>
                </article>
              ))}
              {!deviceUser.devices?.length ? <div className="attendance-device-empty">لا يوجد جهاز مسجل لهذا اليوزر.</div> : null}
            </div>
          </div>
        ) : null}

        <div className="unified-table-wrap attendance-users-table-wrap">
          <table>
            <thead><tr><th>اختيار</th><th>الموظف</th><th>الفرع</th><th>جدول العمل الحالي</th><th>الفترات الحالية</th><th>يوم الإجازة</th><th>التحقق من الجهاز</th><th>أجهزة العمل</th><th>تعديل</th></tr></thead>
            <tbody>
              {filteredUsers.map((user) => {
                const approvedDevices = (user.devices || []).filter((device) => device.status === "approved");
                const pendingDevices = (user.devices || []).filter((device) => device.status === "pending");
                return (
                  <tr key={user.id} className={selectedUsers.includes(user.id) ? "selected" : ""}>
                    <td><input type="checkbox" checked={selectedUsers.includes(user.id)} onChange={() => toggleUser(user.id)} aria-label={`اختيار ${user.full_name}`} /></td>
                    <td><strong>{user.full_name}</strong><small>{user.employee_no || user.email || "—"}</small></td>
                    <td>{user.branch_name || "—"}</td>
                    <td>{user.schedule_name || <span className="attendance-muted">غير محدد</span>}</td>
                    <td>{user.schedule_id ? userPeriodNames(user) : <span className="attendance-muted">غير محدد</span>}</td>
                    <td>{user.weekly_off_day === null || user.weekly_off_day === undefined ? <span className="attendance-muted">بدون إجازة</span> : weeklyOffDayLabel(user.weekly_off_day)}</td>
                    <td>
                      <select
                        className={`attendance-device-policy-select ${user.device_verification_required ? "required" : "exempt"}`}
                        value={user.device_verification_required ? "required" : "exempt"}
                        disabled={busy === `device-policy:${user.id}`}
                        onChange={(event) => void saveDevicePolicy(user.id, event.target.value === "required")}
                      >
                        <option value="required">مطلوب</option>
                        <option value="exempt">مستثنى</option>
                      </select>
                    </td>
                    <td>
                      <button className="attendance-device-manage-button" type="button" onClick={() => setDeviceUserId(user.id)}>
                        <Desktop size={16} />
                        {approvedDevices.length ? `${approvedDevices.length} معتمد` : pendingDevices.length ? `${pendingDevices.length} بانتظار الاعتماد` : "الأجهزة"}
                      </button>
                    </td>
                    <td><button className="attendance-row-edit" type="button" onClick={() => editUserAssignment(user)}><PencilSimple size={16} /> تعديل</button></td>
                  </tr>
                );
              })}
              {!filteredUsers.length ? <tr><td colSpan={9}><div className="unified-empty-row">لا يوجد يوزرات مطابقون للبحث.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

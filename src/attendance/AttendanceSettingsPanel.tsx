import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  FloppyDisk,
  MapPin,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UsersThree,
  WarningCircle,
} from "@phosphor-icons/react";
import { attendanceFetch } from "./api";

type LocationRow = {
  id: string;
  branch_id: string | null;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
};

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

type UserRow = {
  id: string;
  employee_no: string | null;
  full_name: string;
  email: string | null;
  mobile: string | null;
  branch_name: string;
  assignment_id: string | null;
  schedule_id: string | null;
  location_id: string | null;
  weekly_off_day: number | null;
  schedule_name: string | null;
  location_name: string | null;
};

type BranchRow = { id: string; code: string; name: string };

type AdminPayload = {
  ok: true;
  locations: LocationRow[];
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
  if (value === null || value === undefined) return "بدون عطلة أسبوعية";
  const option = WEEKLY_OFF_DAYS.find((day) => Number(day.value) === Number(value));
  return option?.label || "بدون عطلة أسبوعية";
}

const blankLocation = { id: "", branchId: "", name: "", latitude: "", longitude: "", radiusM: "150" };
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
  const [locationForm, setLocationForm] = useState(blankLocation);
  const [scheduleForm, setScheduleForm] = useState(blankSchedule);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [assignmentScheduleId, setAssignmentScheduleId] = useState("");
  const [assignmentLocationId, setAssignmentLocationId] = useState("");
  const [assignmentWeeklyOffDay, setAssignmentWeeklyOffDay] = useState("");
  const [userSearch, setUserSearch] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await attendanceFetch<AdminPayload>("/api/attendance?view=admin"));
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

  function resetMessages() {
    setError("");
    setMessage("");
  }

  async function saveLocation(event: React.FormEvent) {
    event.preventDefault();
    resetMessages();
    setBusy("location");
    try {
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          action: "save_location",
          id: locationForm.id || undefined,
          branchId: locationForm.branchId || undefined,
          name: locationForm.name,
          latitude: Number(locationForm.latitude),
          longitude: Number(locationForm.longitude),
          radiusM: Number(locationForm.radiusM),
        }),
      });
      setLocationForm(blankLocation);
      setMessage("تم حفظ مكان الحضور");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ المكان");
    } finally {
      setBusy("");
    }
  }

  function editLocation(location: LocationRow) {
    resetMessages();
    setLocationForm({
      id: location.id,
      branchId: location.branch_id || "",
      name: location.name,
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      radiusM: String(location.radius_m),
    });
  }

  async function deleteLocation(id: string) {
    resetMessages();
    if (!window.confirm("حذف مكان الحضور؟")) return;
    setBusy(`delete-location:${id}`);
    try {
      await attendanceFetch("/api/attendance", { method: "POST", body: JSON.stringify({ action: "delete_location", id }) });
      setMessage("تم حذف مكان الحضور");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "تعذر حذف المكان");
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
    setSelectedUsers((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    const visible = filteredUsers.map((user) => user.id);
    const allSelected = visible.length > 0 && visible.every((id) => selectedUsers.includes(id));
    setSelectedUsers((current) => allSelected ? current.filter((id) => !visible.includes(id)) : Array.from(new Set([...current, ...visible])));
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
    setBusy("assignment");
    try {
      await attendanceFetch("/api/attendance", {
        method: "POST",
        body: JSON.stringify({
          action: "assign_users",
          userIds: selectedUsers,
          scheduleId: unassign ? "" : assignmentScheduleId,
          locationId: unassign ? "" : assignmentLocationId,
          weeklyOffDay: unassign ? "" : assignmentWeeklyOffDay,
        }),
      });
      setMessage(unassign ? "تم إلغاء جدول العمل من اليوزرات المحددين" : "تم تطبيق جدول العمل والمكان المطلوب ويوم العطلة على اليوزرات المحددين");
      setSelectedUsers([]);
      await load();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "تعذر تطبيق جدول العمل");
    } finally {
      setBusy("");
    }
  }

  if (loading && !data) return <div className="crm-loading-panel">جاري تحميل إعدادات الحضور والانصراف...</div>;

  return (
    <div className="attendance-settings">
      <div className="attendance-settings-intro">
        <div><Clock size={25} weight="duotone" /><span><strong>إعدادات الحضور والانصراف</strong><small>مدير النظام فقط — جداول العمل والفترات ومكان الحضور المطلوب ويوم العطلة لكل يوزر.</small></span></div>
      </div>

      {error ? <div className="attendance-alert error"><WarningCircle size={19} /><span>{error}</span></div> : null}
      {message ? <div className="attendance-alert success"><FloppyDisk size={19} /><span>{message}</span></div> : null}

      <section className="attendance-settings-card panel">
        <header><div><MapPin size={22} weight="duotone" /><span><h2>أماكن الحضور المطلوبة</h2><p>حدد لوكيشن الفرع ونطاق السماح بالمتر. لو لم تختَر مكانًا للموظف لن يتم طلب اللوكيشن منه.</p></span></div></header>
        <div className="attendance-settings-two-columns">
          <form className="attendance-location-form" onSubmit={saveLocation}>
            <label><span>اسم المكان</span><input required value={locationForm.name} onChange={(event) => setLocationForm((current) => ({ ...current, name: event.target.value }))} placeholder="مثال: فرع الملتقى" /></label>
            <label><span>الفرع</span><select value={locationForm.branchId} onChange={(event) => setLocationForm((current) => ({ ...current, branchId: event.target.value }))}><option value="">بدون ربط بفرع</option>{(data?.branches || []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label><span>Latitude</span><input required inputMode="decimal" value={locationForm.latitude} onChange={(event) => setLocationForm((current) => ({ ...current, latitude: event.target.value }))} placeholder="24.000000" /></label>
            <label><span>Longitude</span><input required inputMode="decimal" value={locationForm.longitude} onChange={(event) => setLocationForm((current) => ({ ...current, longitude: event.target.value }))} placeholder="46.000000" /></label>
            <label><span>نطاق السماح بالمتر</span><input required type="number" min={10} max={50000} value={locationForm.radiusM} onChange={(event) => setLocationForm((current) => ({ ...current, radiusM: event.target.value }))} /></label>
            <div className="attendance-form-actions">
              <button className="attendance-save-button" type="submit" disabled={busy === "location"}><FloppyDisk size={18} /> {locationForm.id ? "حفظ التعديل" : "إضافة المكان"}</button>
              {locationForm.id ? <button className="secondary-button" type="button" onClick={() => setLocationForm(blankLocation)}>إلغاء</button> : null}
            </div>
          </form>

          <div className="attendance-compact-list">
            {(data?.locations || []).map((location) => (
              <article key={location.id}>
                <div><strong>{location.name}</strong><span>{Number(location.latitude).toFixed(6)}, {Number(location.longitude).toFixed(6)} • {location.radius_m} م</span></div>
                <div><button type="button" onClick={() => editLocation(location)} title="تعديل"><PencilSimple size={17} /></button><button type="button" onClick={() => void deleteLocation(location.id)} disabled={busy === `delete-location:${location.id}`} title="حذف"><Trash size={17} /></button></div>
              </article>
            ))}
            {!data?.locations?.length ? <p className="attendance-empty">لم تتم إضافة أماكن حضور بعد.</p> : null}
          </div>
        </div>
      </section>

      <section className="attendance-settings-card panel">
        <header><div><Clock size={22} weight="duotone" /><span><h2>جداول وفترات العمل</h2><p>كل جدول يمكن أن يحتوي على فترة واحدة أو أكثر، ولكل فترة بداية ونهاية ودقائق سماح مستقلة.</p></span></div></header>
        <div className="attendance-settings-two-columns schedules">
          <form className="attendance-schedule-form" onSubmit={saveSchedule}>
            <label className="attendance-wide-field"><span>اسم جدول العمل</span><input required value={scheduleForm.name} onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))} placeholder="مثال: دوام التسويق" /></label>
            <div className="attendance-period-editor">
              {scheduleForm.periods.map((period, index) => (
                <div className="attendance-period-row" key={period.id || `new-${index}`}>
                  <div className="attendance-period-title"><strong>الفترة {index + 1}</strong>{scheduleForm.periods.length > 1 ? <button type="button" onClick={() => removePeriod(index)}><Trash size={16} /></button> : null}</div>
                  <label><span>اسم الفترة</span><input value={period.name} onChange={(event) => updatePeriod(index, "name", event.target.value)} /></label>
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
                <div>{schedule.periods.map((period, index) => <p key={period.id || index}><b>الفترة {index + 1}</b><span>{period.startTime} → {period.endTime}</span><small>سماح {period.graceMinutes} د</small></p>)}</div>
              </article>
            ))}
            {!data?.schedules?.length ? <p className="attendance-empty">لم يتم إنشاء جداول عمل بعد.</p> : null}
          </div>
        </div>
      </section>

      <section className="attendance-settings-card panel">
        <header><div><UsersThree size={22} weight="duotone" /><span><h2>تحديد مواعيد العمل لليوزرات</h2><p>اختر اليوزرات ثم جدول الفترات والمكان المطلوب ويوم العطلة الأسبوعية. المكان اختياري لليوزرات الريموت أو خارج السعودية.</p></span></div></header>
        <div className="attendance-assignment-toolbar">
          <label><span>جدول العمل</span><select value={assignmentScheduleId} onChange={(event) => setAssignmentScheduleId(event.target.value)}><option value="">اختر جدول العمل</option>{(data?.schedules || []).map((schedule) => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select></label>
          <label><span>المكان المطلوب</span><select value={assignmentLocationId} onChange={(event) => setAssignmentLocationId(event.target.value)}><option value="">غير محدد — بدون طلب لوكيشن</option>{(data?.locations || []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label><span>يوم العطلة</span><select value={assignmentWeeklyOffDay} onChange={(event) => setAssignmentWeeklyOffDay(event.target.value)}><option value="">بدون عطلة أسبوعية</option>{WEEKLY_OFF_DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}</select></label>
          <button className="attendance-save-button" type="button" onClick={() => void applyAssignment(false)} disabled={busy === "assignment" || !selectedUsers.length}><FloppyDisk size={18} /> تطبيق على المحدد ({selectedUsers.length})</button>
          <button className="secondary-button danger" type="button" onClick={() => void applyAssignment(true)} disabled={busy === "assignment" || !selectedUsers.length}>إلغاء جدول المحدد</button>
        </div>

        <div className="attendance-user-search">
          <MagnifyingGlass size={18} />
          <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="ابحث باسم الموظف أو رقم الموظف أو الفرع" />
          <button className="secondary-button" type="button" onClick={toggleAllVisible}>تحديد / إلغاء الكل الظاهر</button>
        </div>

        <div className="unified-table-wrap attendance-users-table-wrap">
          <table>
            <thead><tr><th>اختيار</th><th>الموظف</th><th>الفرع</th><th>جدول العمل الحالي</th><th>المكان المطلوب</th><th>يوم العطلة</th></tr></thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className={selectedUsers.includes(user.id) ? "selected" : ""}>
                  <td><input type="checkbox" checked={selectedUsers.includes(user.id)} onChange={() => toggleUser(user.id)} aria-label={`اختيار ${user.full_name}`} /></td>
                  <td><strong>{user.full_name}</strong><small>{user.employee_no || user.email || "—"}</small></td>
                  <td>{user.branch_name || "—"}</td>
                  <td>{user.schedule_name || <span className="attendance-muted">غير محدد</span>}</td>
                  <td>{user.location_name || <span className="attendance-muted">غير مطلوب</span>}</td>
                  <td>{user.weekly_off_day === null || user.weekly_off_day === undefined ? <span className="attendance-muted">بدون عطلة</span> : weeklyOffDayLabel(user.weekly_off_day)}</td>
                </tr>
              ))}
              {!filteredUsers.length ? <tr><td colSpan={6}><div className="unified-empty-row">لا يوجد يوزرات مطابقون للبحث.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

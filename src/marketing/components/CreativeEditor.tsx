import { useMemo, useState } from "react";
import { Car, MagnifyingGlass, MinusCircle, Plus, Trash } from "@phosphor-icons/react";
import type {
  CreativeDraft,
  ExecutionAssignment,
  MarketingMeta,
  MarketingUser,
  OptionalDepartmentAssignment,
} from "../types";

function uid() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function displayUserName(user?: MarketingUser) {
  return user?.full_name || user?.fullName || "مستخدم";
}

function userName(meta: MarketingMeta, id: string) {
  return displayUserName(meta.users.find((item) => item.id === id));
}

function departmentUsers(meta: MarketingMeta, departmentId: string) {
  return meta.departments.find((item) => item.id === departmentId)?.users || [];
}

function matchesCarSearch(car: MarketingMeta["cars"][number], search: string) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    car.vin,
    car.car_name,
    car.statement,
    car.model_year,
    car.exterior_color,
    car.interior_color,
    car.location_name,
  ].some((value) => String(value || "").toLowerCase().includes(term));
}

export function newCreativeDraft(): CreativeDraft {
  return {
    tempId: uid(),
    creativeTypeId: "",
    quantity: 1,
    cars: [],
    contentAssignments: [],
    primaryAssignments: [],
    optionalAssignments: [],
    platforms: [],
    notes: {},
  };
}

function UserPicker({
  title,
  users,
  selectedIds,
  onToggle,
}: {
  title: string;
  users: MarketingUser[];
  selectedIds: string[];
  onToggle: (userId: string) => void;
}) {
  return (
    <div className="marketing-user-picker">
      <div className="marketing-user-picker-title">
        <strong>{title}</strong>
        <small>{selectedIds.length.toLocaleString("ar-SA")} محدد</small>
      </div>
      {users.length ? (
        <div className="marketing-chip-picker">
          {users.map((user) => {
            const selected = selectedIds.includes(user.id);
            return (
              <button
                type="button"
                key={user.id}
                className={selected ? "selected" : ""}
                onClick={() => onToggle(user.id)}
              >
                {displayUserName(user)}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="marketing-picker-empty">
          لا يوجد يوزرات مضافون لهذا القسم. تتم إضافة اليوزرات من إعدادات سيستم التسويق ← الأقسام.
        </p>
      )}
    </div>
  );
}

export function CreativeEditor({
  value,
  meta,
  onChange,
  onDelete,
  showPlatforms = false,
}: {
  value: CreativeDraft;
  meta: MarketingMeta;
  onChange: (value: CreativeDraft) => void;
  onDelete: () => void;
  showPlatforms?: boolean;
}) {
  const [carsOpen, setCarsOpen] = useState(false);
  const [carSearch, setCarSearch] = useState("");
  const creativeType = meta.creativeTypes.find((item) => item.id === value.creativeTypeId);
  const contentDepartment = meta.departments.find((item) => item.is_content);
  const primaryUsers = departmentUsers(meta, creativeType?.primary_department_id || "");
  const contentUsers = contentDepartment?.users || [];

  function patch(patchValue: Partial<CreativeDraft>) {
    onChange({ ...value, ...patchValue });
  }

  function toggleContentUser(userId: string) {
    const exists = value.contentAssignments.some((item) => item.userId === userId);
    const contentAssignments = exists
      ? value.contentAssignments.filter((item) => item.userId !== userId)
      : [...value.contentAssignments, { userId, dueOn: "", note: "" }];
    const selected = new Set(contentAssignments.map((item) => item.userId));
    patch({
      contentAssignments,
      primaryAssignments: value.primaryAssignments.map((item) => ({
        ...item,
        contentUserIds: item.contentUserIds.filter((id) => selected.has(id)),
      })),
      optionalAssignments: value.optionalAssignments.map((group) => ({
        ...group,
        assignments: group.assignments.map((item) => ({
          ...item,
          contentUserIds: item.contentUserIds.filter((id) => selected.has(id)),
        })),
      })),
    });
  }

  function toggleExecutionUser(current: ExecutionAssignment[], userId: string) {
    return current.some((item) => item.userId === userId)
      ? current.filter((item) => item.userId !== userId)
      : [...current, { userId, contentUserIds: [], dueOn: "", note: "" }];
  }

  function updateExecution(
    current: ExecutionAssignment[],
    userId: string,
    patchValue: Partial<ExecutionAssignment>,
  ) {
    return current.map((item) => item.userId === userId ? { ...item, ...patchValue } : item);
  }

  function toggleLinkedContent(
    current: ExecutionAssignment[],
    userId: string,
    contentUserId: string,
  ) {
    const assignment = current.find((item) => item.userId === userId);
    if (!assignment) return current;
    const contentUserIds = assignment.contentUserIds.includes(contentUserId)
      ? assignment.contentUserIds.filter((id) => id !== contentUserId)
      : [...assignment.contentUserIds, contentUserId];
    return updateExecution(current, userId, { contentUserIds });
  }

  function addOptional() {
    patch({
      optionalAssignments: [...value.optionalAssignments, { departmentId: "", assignments: [] }],
    });
  }

  function updateOptional(index: number, next: OptionalDepartmentAssignment) {
    patch({
      optionalAssignments: value.optionalAssignments.map((item, itemIndex) => itemIndex === index ? next : item),
    });
  }

  function toggleCar(car: MarketingMeta["cars"][number]) {
    patch({
      cars: value.cars.some((item) => item.id === car.id)
        ? value.cars.filter((item) => item.id !== car.id)
        : [...value.cars, car],
    });
  }

  function togglePlatform(platformId: string) {
    patch({
      platforms: value.platforms.some((item) => item.platformId === platformId)
        ? value.platforms.filter((item) => item.platformId !== platformId)
        : [...value.platforms, { platformId, postTypeIds: [] }],
    });
  }

  function togglePostType(platformId: string, postTypeId: string) {
    patch({
      platforms: value.platforms.map((item) => item.platformId === platformId
        ? {
            ...item,
            postTypeIds: item.postTypeIds.includes(postTypeId)
              ? item.postTypeIds.filter((id) => id !== postTypeId)
              : [...item.postTypeIds, postTypeId],
          }
        : item),
    });
  }

  const filteredCars = useMemo(
    () => meta.cars.filter((car) => matchesCarSearch(car, carSearch)).slice(0, 300),
    [meta.cars, carSearch],
  );

  return (
    <article className="marketing-creative-editor">
      <header>
        <div>
          <strong>تفاصيل الكرييتيف</strong>
          {creativeType ? <span>{creativeType.name} · القسم الأساسي: {creativeType.primary_department_name || "—"}</span> : null}
        </div>
        <button type="button" className="icon-danger" onClick={onDelete}><Trash size={18} /></button>
      </header>

      <div className="marketing-form-grid compact">
        <label>
          <span>نوع الكرييتيف</span>
          <select
            value={value.creativeTypeId}
            onChange={(event) => patch({ creativeTypeId: event.target.value, primaryAssignments: [] })}
          >
            <option value="">اختر الكرييتيف</option>
            {meta.creativeTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          <span>العدد</span>
          <input
            type="number"
            min={1}
            value={value.quantity}
            onChange={(event) => patch({ quantity: Math.max(1, Number(event.target.value) || 1) })}
          />
        </label>
      </div>

      <section className="marketing-assignment-section">
        <h3>قسم المحتوى</h3>
        <UserPicker
          title="اختيار يوزرات قسم المحتوى"
          users={contentUsers}
          selectedIds={value.contentAssignments.map((item) => item.userId)}
          onToggle={toggleContentUser}
        />
        {value.contentAssignments.map((assignment) => (
          <div className="marketing-assignment-row" key={assignment.userId}>
            <strong>{userName(meta, assignment.userId)}</strong>
            <label>
              <span>تاريخ استلام قسم المحتوى</span>
              <input
                type="date"
                value={assignment.dueOn}
                onChange={(event) => patch({
                  contentAssignments: value.contentAssignments.map((item) => item.userId === assignment.userId
                    ? { ...item, dueOn: event.target.value }
                    : item),
                })}
              />
            </label>
            <label className="wide">
              <span>ملاحظات قسم المحتوى</span>
              <input
                value={assignment.note}
                onChange={(event) => patch({
                  contentAssignments: value.contentAssignments.map((item) => item.userId === assignment.userId
                    ? { ...item, note: event.target.value }
                    : item),
                })}
              />
            </label>
          </div>
        ))}
      </section>

      <section className="marketing-assignment-section">
        <h3>القسم الأساسي</h3>
        {creativeType ? (
          <>
            <UserPicker
              title={`اختيار يوزرات ${creativeType.primary_department_name || "القسم الأساسي"}`}
              users={primaryUsers}
              selectedIds={value.primaryAssignments.map((item) => item.userId)}
              onToggle={(userId) => patch({
                primaryAssignments: toggleExecutionUser(value.primaryAssignments, userId),
              })}
            />
            {value.primaryAssignments.map((assignment) => (
              <div className="marketing-execution-box" key={assignment.userId}>
                <div className="marketing-assignment-row">
                  <strong>{userName(meta, assignment.userId)}</strong>
                  <label>
                    <span>تاريخ استلام القسم الأساسي</span>
                    <input
                      type="date"
                      value={assignment.dueOn}
                      onChange={(event) => patch({
                        primaryAssignments: updateExecution(value.primaryAssignments, assignment.userId, { dueOn: event.target.value }),
                      })}
                    />
                  </label>
                  <label className="wide">
                    <span>ملاحظات القسم الأساسي</span>
                    <input
                      value={assignment.note}
                      onChange={(event) => patch({
                        primaryAssignments: updateExecution(value.primaryAssignments, assignment.userId, { note: event.target.value }),
                      })}
                    />
                  </label>
                </div>
                <div className="marketing-link-users">
                  <strong>ربط اليوزر بكاتب المحتوى</strong>
                  {value.contentAssignments.length ? value.contentAssignments.map((content) => (
                    <label key={content.userId}>
                      <input
                        type="checkbox"
                        checked={assignment.contentUserIds.includes(content.userId)}
                        onChange={() => patch({
                          primaryAssignments: toggleLinkedContent(value.primaryAssignments, assignment.userId, content.userId),
                        })}
                      />
                      {userName(meta, content.userId)}
                    </label>
                  )) : <small>اختر يوزرًا من قسم المحتوى أولًا.</small>}
                </div>
              </div>
            ))}
          </>
        ) : <p className="muted">اختر نوع الكرييتيف أولًا.</p>}
      </section>

      <section className="marketing-assignment-section">
        <div className="marketing-section-title">
          <h3>الأقسام الاختيارية</h3>
          <button type="button" className="secondary" onClick={addOptional}><Plus size={16} />إضافة قسم اختياري</button>
        </div>
        {value.optionalAssignments.map((group, index) => {
          const users = departmentUsers(meta, group.departmentId);
          const departmentName = meta.departments.find((item) => item.id === group.departmentId)?.name || "القسم الاختياري";
          return (
            <div className="marketing-optional-box" key={`${index}-${group.departmentId}`}>
              <div className="marketing-optional-head">
                <select
                  value={group.departmentId}
                  onChange={(event) => updateOptional(index, { departmentId: event.target.value, assignments: [] })}
                >
                  <option value="">اختر القسم</option>
                  {meta.departments
                    .filter((item) => !item.is_content && item.id !== creativeType?.primary_department_id)
                    .map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                </select>
                <button
                  type="button"
                  className="icon-danger"
                  onClick={() => patch({
                    optionalAssignments: value.optionalAssignments.filter((_, itemIndex) => itemIndex !== index),
                  })}
                >
                  <MinusCircle size={18} />
                </button>
              </div>
              {group.departmentId ? (
                <UserPicker
                  title={`اختيار يوزرات ${departmentName}`}
                  users={users}
                  selectedIds={group.assignments.map((item) => item.userId)}
                  onToggle={(userId) => updateOptional(index, {
                    ...group,
                    assignments: toggleExecutionUser(group.assignments, userId),
                  })}
                />
              ) : null}
              {group.assignments.map((assignment) => (
                <div className="marketing-execution-box" key={assignment.userId}>
                  <div className="marketing-assignment-row">
                    <strong>{userName(meta, assignment.userId)}</strong>
                    <label>
                      <span>تاريخ الاستلام</span>
                      <input
                        type="date"
                        value={assignment.dueOn}
                        onChange={(event) => updateOptional(index, {
                          ...group,
                          assignments: updateExecution(group.assignments, assignment.userId, { dueOn: event.target.value }),
                        })}
                      />
                    </label>
                    <label className="wide">
                      <span>ملاحظات القسم</span>
                      <input
                        value={assignment.note}
                        onChange={(event) => updateOptional(index, {
                          ...group,
                          assignments: updateExecution(group.assignments, assignment.userId, { note: event.target.value }),
                        })}
                      />
                    </label>
                  </div>
                  <div className="marketing-link-users">
                    <strong>ربط اليوزر بكاتب المحتوى</strong>
                    {value.contentAssignments.length ? value.contentAssignments.map((content) => (
                      <label key={content.userId}>
                        <input
                          type="checkbox"
                          checked={assignment.contentUserIds.includes(content.userId)}
                          onChange={() => updateOptional(index, {
                            ...group,
                            assignments: toggleLinkedContent(group.assignments, assignment.userId, content.userId),
                          })}
                        />
                        {userName(meta, content.userId)}
                      </label>
                    )) : <small>اختر يوزرًا من قسم المحتوى أولًا.</small>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      <section className="marketing-assignment-section">
        <button type="button" className="marketing-cars-toggle" onClick={() => setCarsOpen(!carsOpen)}>
          <Car size={18} />
          <span>السيارات</span>
          <b>{value.cars.length}</b>
        </button>
        {carsOpen ? (
          <div className="marketing-cars-picker">
            <label className="marketing-cars-search">
              <MagnifyingGlass size={18} />
              <input
                value={carSearch}
                onChange={(event) => setCarSearch(event.target.value)}
                placeholder="ابحث برقم الهيكل أو السيارة أو البيان أو اللون أو المكان"
              />
            </label>
            <div className="marketing-cars-grid">
              {filteredCars.map((car) => (
                <label key={car.id} className={value.cars.some((item) => item.id === car.id) ? "selected" : ""}>
                  <input
                    type="checkbox"
                    checked={value.cars.some((item) => item.id === car.id)}
                    onChange={() => toggleCar(car)}
                  />
                  <strong>{car.car_name || "سيارة"}</strong>
                  <span>{car.statement || "—"}</span>
                  <small>{car.exterior_color || "—"} / {car.interior_color || "—"}</small>
                  <code>{car.vin}</code>
                </label>
              ))}
              {!filteredCars.length ? <p className="marketing-picker-empty">لا توجد سيارات مطابقة للبحث.</p> : null}
            </div>
          </div>
        ) : null}
      </section>

      {showPlatforms ? (
        <section className="marketing-assignment-section">
          <h3>المنصات وأنواع النشر</h3>
          <div className="marketing-platform-select">
            {meta.platforms.map((platform) => {
              const selected = value.platforms.find((item) => item.platformId === platform.id);
              return (
                <div key={platform.id}>
                  <label className="platform-head">
                    <input type="checkbox" checked={Boolean(selected)} onChange={() => togglePlatform(platform.id)} />
                    <strong>{platform.name}</strong>
                  </label>
                  {selected ? (
                    <div className="marketing-chip-picker">
                      {meta.postTypes.filter((item) => item.platform_id === platform.id).map((postType) => (
                        <button
                          type="button"
                          key={postType.id}
                          className={selected.postTypeIds.includes(postType.id) ? "selected" : ""}
                          onClick={() => togglePostType(platform.id, postType.id)}
                        >
                          {postType.name}
                          {postType.width && postType.height ? <small>{postType.width}×{postType.height}</small> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </article>
  );
}

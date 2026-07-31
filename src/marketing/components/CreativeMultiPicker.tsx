import { Check, SquaresFour } from "@phosphor-icons/react";

type CreativePickerItem = {
  id: string;
  name: string;
  code?: string;
};

export function CreativeMultiPicker({
  label,
  hint,
  items,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  items: CreativePickerItem[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  return (
    <div className="marketing-creative-multi-picker">
      <div className="marketing-creative-multi-picker-head">
        <div>
          <span>{label}</span>
          {hint ? <small>{hint}</small> : null}
        </div>
        <b>{value.length.toLocaleString("ar-SA")} محدد</b>
      </div>
      {items.length ? (
        <div className="marketing-creative-multi-options">
          {items.map((item, index) => {
            const selected = value.includes(item.id);
            return (
              <button
                type="button"
                key={item.id}
                className={selected ? "selected" : ""}
                aria-pressed={selected}
                onClick={() => toggle(item.id)}
              >
                <span className="marketing-creative-multi-check">{selected ? <Check size={14} weight="bold" /> : index + 1}</span>
                <span className="marketing-creative-multi-copy">
                  <strong>{item.name}</strong>
                  <small>{item.code || `كرييتيف ${index + 1}`}</small>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="marketing-creative-multi-empty"><SquaresFour size={20} />أضف كرييتيفات في الخطوة السابقة أولًا.</div>
      )}
    </div>
  );
}

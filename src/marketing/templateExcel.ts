function xml(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const writerFields = [
  ["proposedName", "الاسم المقترح للكرييتيف"],
  ["goal", "الهدف"],
  ["mainMessage", "الرسالة الأساسية"],
  ["hook", "الهوك"],
  ["mainScript", "السكريبت الأساسي"],
  ["cta", "CTA"],
  ["caption", "Caption"],
  ["hashtags", "Hashtag"],
];

export function downloadTaskTemplate(task: any) {
  const systemRows = [
    ["campaignName", "اسم الحملة", task.source_name || ""],
    ["campaignCode", "رقم الحملة", task.campaign_code || ""],
    ["campaignType", "نوع الحملة", task.campaign_type_name || task.campaign_type || (task.source_type === "agenda" ? "أجندة" : "")],
    ["taskNo", "رقم التاسك", task.task_no || ""],
    ["creativeType", "نوع الكرييتيف", task.creative_name || ""],
    ["dueDate", "تاريخ التسليم", String(task.template_due_on || task.due_at || "").slice(0, 10)],
    ["departmentNote", "ملاحظة القسم", task.template_department_note || task.note || ""],
  ];
  const rows = [...systemRows, ...writerFields.map(([key, label]) => [key, label, task.template_data?.[key] || ""])];
  const table = rows.map(([key, label, value]) => `<Row><Cell><Data ss:Type="String">${xml(key)}</Data></Cell><Cell><Data ss:Type="String">${xml(label)}</Data></Cell><Cell><Data ss:Type="String">${xml(value)}</Data></Cell></Row>`).join("");
  const content = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Task Template"><Table><Row><Cell><Data ss:Type="String">key</Data></Cell><Cell><Data ss:Type="String">الحقل</Data></Cell><Cell><Data ss:Type="String">القيمة</Data></Cell></Row>${table}</Table></Worksheet></Workbook>`;
  const blob = new Blob([content], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${task.task_no || "task-template"}.xls`; anchor.click(); URL.revokeObjectURL(url);
}

export async function parseTaskTemplate(file: File) {
  const text = await file.text();
  if (!text.includes("schemas-microsoft-com:office:spreadsheet")) throw new Error("ارفع نفس ملف Task Template الذي تم تنزيله بصيغة XLS");
  const documentXml = new DOMParser().parseFromString(text, "application/xml");
  const rows = Array.from(documentXml.getElementsByTagNameNS("urn:schemas-microsoft-com:office:spreadsheet", "Row"));
  const output: Record<string, string> = {};
  rows.slice(1).forEach((row) => {
    const values = Array.from(row.getElementsByTagNameNS("urn:schemas-microsoft-com:office:spreadsheet", "Data")).map((cell) => cell.textContent || "");
    if (values[0]) output[values[0]] = values[2] || "";
  });
  return output;
}

export function relationshipCsv(rows: Array<Record<string, unknown>>) {
  const headers = ["اليوم", "الكرييتيف", "القسم", "المسؤول", "كاتب المحتوى", "تاريخ الاستلام", "الملاحظة"];
  const keys = ["day", "creative", "department", "user", "contentUser", "dueOn", "note"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return `\uFEFF${headers.map(escape).join(",")}\n${rows.map((row) => keys.map((key) => escape(row[key])).join(",")).join("\n")}`;
}

type ZipInstance = { file(name: string, content: string | Blob | ArrayBuffer): void; generateAsync(options: { type: "blob" }): Promise<Blob> };
type ZipConstructor = new () => ZipInstance;

declare global { interface Window { JSZip?: ZipConstructor } }

let loading: Promise<ZipConstructor> | null = null;
export async function getJSZip(): Promise<ZipConstructor> {
  if (window.JSZip) return window.JSZip;
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/jszip.min.js";
    script.async = true;
    script.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error("تعذر تحميل أداة ZIP"));
    script.onerror = () => reject(new Error("تعذر تحميل أداة ZIP"));
    document.head.appendChild(script);
  });
  return loading;
}

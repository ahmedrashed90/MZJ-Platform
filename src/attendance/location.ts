export type BrowserAttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export function getBrowserAttendanceLocation() {
  return new Promise<BrowserAttendanceLocation>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("المتصفح أو الجهاز لا يدعم تحديد الموقع"));
      return;
    }

    if (
      typeof window !== "undefined"
      && !window.isSecureContext
      && !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ) {
      reject(new Error("تحديد الموقع يحتاج فتح المنصة من اتصال HTTPS آمن"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
      }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("تم رفض صلاحية الموقع. اسمح للمنصة بالوصول إلى اللوكيشن ثم حاول مرة أخرى."));
          return;
        }
        if (error.code === error.TIMEOUT) {
          reject(new Error("انتهت مهلة تحديد الموقع. فعّل خدمة الموقع وحاول مرة أخرى."));
          return;
        }
        reject(new Error("تعذر تحديد موقع الحضور من الجهاز. فعّل خدمة الموقع ثم حاول مرة أخرى."));
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

export function MarketingLoading({ label = "جاري تحميل بيانات التسويق..." }: { label?: string }) {
  return <div className="marketing-loading"><span className="marketing-spinner" /><b>{label}</b></div>;
}

export function MarketingError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="marketing-error">
      <WarningCircle size={22} />
      <span>{message}</span>
      {onRetry ? <button type="button" onClick={onRetry}><ArrowClockwise size={17} />إعادة المحاولة</button> : null}
    </div>
  );
}

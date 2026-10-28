import { createNumericQrMatrix } from "./numericQr";

export function RedemptionQr({ code, size = 196 }: { code: string; size?: number }) {
  const matrix = createNumericQrMatrix(code);
  if (!matrix.length) return null;
  const quiet = 4;
  const total = matrix.length + quiet * 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${total} ${total}`} role="img" aria-label={`QR كود الاستبدال ${code}`} shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#fff" />
      {matrix.map((row, y) => row.map((dark, x) => dark ? <rect key={`${x}-${y}`} x={x + quiet} y={y + quiet} width="1" height="1" fill="#000" /> : null))}
    </svg>
  );
}

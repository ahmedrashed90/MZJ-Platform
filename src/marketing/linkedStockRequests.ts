import type { StockCar } from "./types";

export type LinkedActiveRequest = {
  id: string;
  requestNo: string;
  requestKind: string;
  status: string;
  requestedAt: string | null;
  requestedByName: string | null;
  sourceLocationName: string | null;
  destinationLocationName: string | null;
  cars: Array<{ id: string; vin: string; carName: string | null; locationName: string | null }>;
};

/**
 * A single transfer request may contain many vehicles; group by its real ID.
 * The stock endpoint supplies only non-deleted, non-cancelled, non-completed
 * requests, so the output mirrors the same lock that blocks photo creation.
 * This is presentation-only: no request is changed or automatically released.
 */
export function collectLinkedActiveRequests(cars: StockCar[]): LinkedActiveRequest[] {
  const byRequest = new Map<string, LinkedActiveRequest>();
  for (const car of cars) {
    for (const request of car.active_request_details || []) {
      if (!request.requestNo || !["transfer", "photography"].includes(request.requestKind)) continue;
      const key = request.requestId || request.requestNo;
      let item = byRequest.get(key);
      if (!item) {
        item = {
          id: key,
          requestNo: request.requestNo,
          requestKind: request.requestKind,
          status: request.status,
          requestedAt: request.requestedAt || null,
          requestedByName: request.requestedByName || null,
          sourceLocationName: request.sourceLocationName || null,
          destinationLocationName: request.destinationLocationName || null,
          cars: [],
        };
        byRequest.set(key, item);
      }
      if (!item.cars.some((existing) => existing.id === car.id)) {
        item.cars.push({ id: car.id, vin: car.vin, carName: car.car_name, locationName: car.location_name });
      }
    }
  }
  return [...byRequest.values()].sort((left, right) => (right.requestedAt || "").localeCompare(left.requestedAt || ""));
}

export function searchLinkedActiveRequests(requests: LinkedActiveRequest[], term: string): LinkedActiveRequest[] {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return requests;
  return requests.filter((request) => [
    request.requestNo, request.requestedByName, request.sourceLocationName, request.destinationLocationName,
    ...request.cars.flatMap((car) => [car.vin, car.carName]),
  ].some((value) => String(value || "").toLowerCase().includes(normalized)));
}

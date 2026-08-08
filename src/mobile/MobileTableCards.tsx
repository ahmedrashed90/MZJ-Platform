import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const MOBILE_QUERY = "(max-width: 820px)";

function headerSource(table: HTMLTableElement) {
  const rows = Array.from(table.tHead?.rows || []);
  if (rows.length) {
    const bodyColumns = table.tBodies[0]?.rows[0]?.cells.length || 0;
    const candidates = [...rows].reverse();
    const best = candidates.find((row) => row.cells.length >= bodyColumns) || candidates[0];
    return { row: best, bodyHeader: false };
  }

  const firstBodyRow = table.tBodies[0]?.rows[0];
  if (firstBodyRow && firstBodyRow.cells.length > 1 && Array.from(firstBodyRow.cells).every((cell) => cell.tagName === "TH")) {
    return { row: firstBodyRow, bodyHeader: true };
  }
  return { row: undefined, bodyHeader: false };
}

function headerLabels(table: HTMLTableElement) {
  const source = headerSource(table);
  return {
    labels: Array.from(source.row?.cells || []).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()),
    bodyHeader: source.bodyHeader ? source.row : undefined,
  };
}

function decorateTable(table: HTMLTableElement) {
  if (table.dataset.mobileCards === "off") return;
  const { labels, bodyHeader } = headerLabels(table);
  if (!labels.length) return;
  table.dataset.mobileCards = "true";
  if (bodyHeader) bodyHeader.dataset.mobileHeaderRow = "true";
  Array.from(table.tBodies).forEach((body) => {
    Array.from(body.rows).forEach((row) => {
      if (row === bodyHeader) return;
      Array.from(row.cells).forEach((cell, index) => {
        if (cell.colSpan > 1) {
          cell.dataset.mobileLabel = "";
          return;
        }
        cell.dataset.mobileLabel = labels[index] || "";
      });
    });
  });
  if (table.tFoot) {
    Array.from(table.tFoot.rows).forEach((row) => {
      Array.from(row.cells).forEach((cell, index) => {
        cell.dataset.mobileLabel = cell.colSpan > 1 ? "" : labels[index] || "";
      });
    });
  }
}

function clearTable(table: HTMLTableElement) {
  if (table.dataset.mobileCards === "true") delete table.dataset.mobileCards;
  table.querySelectorAll<HTMLElement>("[data-mobile-label]").forEach((cell) => delete cell.dataset.mobileLabel);
  table.querySelectorAll<HTMLElement>("[data-mobile-header-row]").forEach((row) => delete row.dataset.mobileHeaderRow);
}

export function MobileTableCards() {
  const location = useLocation();

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    let frame = 0;

    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        document.querySelectorAll<HTMLTableElement>(".page-shell table").forEach((table) => {
          if (media.matches) decorateTable(table);
          else clearTable(table);
        });
      });
    };

    const observer = new MutationObserver(sync);
    const root = document.querySelector(".page-shell");
    if (root) observer.observe(root, { childList: true, subtree: true });
    media.addEventListener("change", sync);
    sync();

    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
      window.cancelAnimationFrame(frame);
    };
  }, [location.pathname, location.search]);

  return null;
}

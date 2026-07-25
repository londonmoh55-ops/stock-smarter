import type { CompanyInfo } from "@/lib/wms/types";
import type { PrintFormat } from "./printTypes";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function companyHeaderHtml(company?: CompanyInfo, format: PrintFormat = "a4"): string {
  if (!company) return "";
  const brand = company.logoText || company.name;
  if (!brand && !company.address && !company.phone) return "";

  if (format === "thermal") {
    const sub = [company.phone, company.address].filter(Boolean).map(esc).join(" · ");
    return `<div class="company">
      <div class="brand">${esc(brand)}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
    </div>
    <div class="sep"></div>`;
  }

  const sub = [company.name && company.logoText ? company.name : "", company.address, company.phone]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
  return `<div class="company">
    <div class="brand">${esc(brand)}</div>
    ${sub ? `<div class="sub">${sub}</div>` : ""}
  </div>`;
}

function formatCss(format: PrintFormat): string {
  if (format === "thermal") {
    return `
@page { size: 80mm auto; margin: 4mm }
body {
  font-family: ui-monospace, Consolas, monospace;
  padding: 4px;
  color: #111;
  max-width: 72mm;
  margin: 0 auto;
  font-size: 13px;
  line-height: 1.35;
}
.company { text-align: center; margin-bottom: 8px; }
.company .brand { font-size: 15px; font-weight: 800; }
.company .sub { font-size: 11px; color: #333; margin-top: 2px; }
h1 { font-size: 14px; margin: 0 0 6px; text-align: center; font-weight: 800; }
.meta { font-size: 11px; margin-bottom: 8px; color: #222; }
.sep { border-top: 1px dashed #111; margin: 8px 0; }
.line { margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px dashed #ccc; }
.line .name { font-weight: 700; }
.line .detail { font-size: 11px; color: #333; }
.line .amt { text-align: right; font-weight: 700; margin-top: 2px; }
.totals { margin-top: 8px; font-size: 13px; font-weight: 700; }
.totals .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
.footer { text-align: center; margin-top: 12px; font-size: 11px; }
.toolbar { margin-bottom: 8px; }
@media print { .toolbar { display: none } }
`;
  }

  return `
@page { size: A4; margin: 12mm }
body { font-family: system-ui, sans-serif; padding: 24px; color: #111 }
.company { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #111 }
.company .brand { font-size: 20px; font-weight: 800; letter-spacing: 0.02em }
.company .sub { font-size: 11px; color: #555; margin-top: 4px }
h1 { font-size: 18px; margin: 0 0 4px }
.meta { color: #555; font-size: 12px; margin-bottom: 16px }
table { width: 100%; border-collapse: collapse; font-size: 12px }
th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left }
th { background: #f3f3f3 }
.right { text-align: right }
.totals { margin-top: 16px; font-size: 13px }
.sep { display: none }
.footer { margin-top: 24px; font-size: 11px; color: #555 }
.toolbar { margin-bottom: 12px }
@media print { .toolbar { display: none } }
`;
}

export interface OpenPrintDocumentOpts {
  title: string;
  format: PrintFormat;
  company?: CompanyInfo;
  /** HTML below company header (includes h1 / meta / body / totals) */
  bodyHtml: string;
  /** Optional footer after body */
  footerHtml?: string;
  /** Auto-open OS print dialog (default true) */
  autoPrint?: boolean;
}

function buildHtml(opts: OpenPrintDocumentOpts): string {
  const header = companyHeaderHtml(opts.company, opts.format);
  const footer =
    opts.footerHtml ??
    (opts.format === "thermal"
      ? `<div class="sep"></div><div class="footer">---<br/>Thank you</div>`
      : "");
  const auto = opts.autoPrint !== false;
  const autoScript = auto
    ? `<script>
    window.addEventListener("load", function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(opts.title)}</title>
<style>${formatCss(opts.format)}</style>
</head><body>
  <div class="toolbar"><button type="button" onclick="window.print()">Print</button></div>
  ${header}
  ${opts.bodyHtml}
  ${footer}
  ${autoScript}
</body></html>`;
}

/**
 * Open a print preview window.
 * Uses a blob URL (not about:blank + document.write) so Electron popups
 * actually show content — noopener/document.write leaves an empty window.
 */
export function openPrintDocument(opts: OpenPrintDocumentOpts): void {
  const width = opts.format === "thermal" ? 360 : 900;
  const height = 700;
  const html = buildHtml(opts);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  // Do NOT use noopener — Electron would open a blank guest with no content.
  const w = window.open(url, "_blank", `width=${width},height=${height}`);
  if (!w) {
    URL.revokeObjectURL(url);
    if (opts.autoPrint !== false) printViaIframe(html);
    return;
  }

  const revoke = () => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  };
  w.addEventListener("load", () => {
    setTimeout(revoke, 60_000);
  });
  // Safety revoke if load never fires
  setTimeout(revoke, 120_000);
}

function printViaIframe(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => iframe.remove(), 1000);
    }
  };
}

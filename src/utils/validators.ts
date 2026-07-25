export function validateInvoice(value: string): { valid: boolean; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, message: "Invoice is required" };
  if (!/^\d{5,8}$/.test(trimmed)) return { valid: false, message: "Invoice must be 5–8 digits only" };
  return { valid: true, message: "" };
}

export function validatePhone(value: string): { valid: boolean; message: string; normalized: string } {
  let d = value.replace(/\D/g, "");
  if (d.length === 9 && /^[567]/.test(d)) d = `0${d}`;
  if (!/^0[567]\d{8}$/.test(d)) {
    return { valid: false, message: "Phone must be 10 digits starting with 05, 06, or 07", normalized: d };
  }
  return { valid: true, message: "", normalized: d };
}

export function validateDate(value: string): { valid: boolean; message: string } {
  const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return { valid: false, message: "Date must be DD/MM/YYYY" };
  const dd = Number.parseInt(m[1], 10);
  const mm = Number.parseInt(m[2], 10);
  const yyyy = Number.parseInt(m[3], 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return { valid: false, message: "Invalid date" };
  if (yyyy < 2020 || yyyy > 2035) return { valid: false, message: "Date year out of range" };
  return { valid: true, message: "" };
}

export function validateQuantity(value: number): { valid: boolean; message: string } {
  if (!Number.isFinite(value) || value <= 0) return { valid: false, message: "Quantity must be greater than zero" };
  return { valid: true, message: "" };
}

export function validateWeight(value: number | null, chargeType: string): { valid: boolean; message: string } {
  if (chargeType !== "weight") return { valid: true, message: "" };
  if (value == null || value <= 0) return { valid: false, message: "Weight must be positive" };
  return { valid: true, message: "" };
}

export function validatePrice(value: number | null): { valid: boolean; message: string } {
  if (value == null || value <= 0) return { valid: false, message: "Price must be positive" };
  return { valid: true, message: "" };
}

export function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

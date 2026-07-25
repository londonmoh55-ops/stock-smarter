# StockFlow WMS — Phase 1 Audit Checklist

> Audited: 2026-07-07. Project was TanStack Start (web) with localStorage — no Electron layer existed yet.

## Assumptions for fixes

- **Persistence:** Single JSON file (`warehouse-data.json`) in `app.getPath('userData')`, not SQLite — avoids native-module packaging; matches the existing monolithic `WmsState` shape.
- **Backups:** Keep last **10** auto-snapshots in `userData/backups/`.
- **IPC:** Monolithic `window.db.load()` / `window.db.save(state)` plus export/import — matches the centralized store; per-entity CRUD would duplicate logic already in route handlers.

---

## Routes (TanStack Router)

| Route | Path | Status | Notes |
|-------|------|--------|-------|
| Dashboard | `/` | OK | No loader needed (client store) |
| Products | `/products` | OK | |
| Inventory | `/inventory` | OK | |
| Sales | `/sales` | OK | Edit/delete reversal via derived stock — correct pattern |
| Bons | `/bons` | OK | |
| Transfers | `/transfers` | OK | |
| Suppliers | `/suppliers` | OK | |
| Customers | `/customers` | OK | |
| Warehouses | `/warehouses` | OK | |
| Daily Cash | `/cash` | OK | |
| History | `/history` | OK | |
| Reports | `/reports` | OK | |
| Settings | `/settings` | **MISSING** | Required for Backup & Restore — to be added |
| 404 | `__root` notFoundComponent | OK | |

No route throws on navigation in static review. React Query is wired but unused (dead wiring, not a runtime bug).

---

## Inventory math

- [x] `computeStock` uses `accepted = received − missing − damaged` for purchases — **correct**
- [x] Sales deduct stock; transfers move stock; adjustments apply delta — **correct**
- [x] Edit sale/transfer removes old record before stock check — **correct** (derived stock auto-reverses)
- [x] Delete sale/transfer/purchase removes record — stock/cash reverse via derivation — **correct**
- [ ] **BUG:** Receive edit (`bons.tsx` `saveReceive`) always sets `date: new Date()` — retroactive cash moves to today instead of preserving original purchase date
- [ ] **BUG:** Receive form has no validation that `missing + damaged ≤ received` or that accepted qty ≥ 0
- [ ] **BUG:** `nextNumber` called inside `setState` updater — counter can increment even if a later validation throws (sales/transfers)

---

## Weight vs Piece

- [x] `QtyInput` used in sales, transfers, bons, receive, inventory — **centralized**
- [ ] **BUG:** Piece products **floor** decimals silently instead of rejecting with an error
- [ ] **BUG:** Inventory adjustment uses `QtyInput` with `min="0"` — cannot enter negative delta despite UI label “+ add, − remove”
- [ ] **BUG:** No save-time validation — direct `setState` could store fractional piece quantities if coercion bypassed

---

## CRUD / dependent state

| Entity | Edit reversal | Delete reversal | Archive guard |
|--------|---------------|-----------------|---------------|
| Products | N/A | N/A | OK via `hasHistory` — **missing adjustments check** |
| Suppliers | N/A | N/A | OK |
| Customers | N/A | N/A | OK |
| Warehouses | N/A | N/A | OK |
| Pre-arrival bons | OK (no stock) | OK | N/A |
| Purchases | Partial — date bug | OK | N/A |
| Sales | OK | OK | N/A |
| Transfers | OK | OK | N/A |
| Cash entries | OK | OK | N/A |

---

## Paid vs unpaid transfers

- [x] `computeDayCash` only adds paid transfers to `moneyInAuto` — **correct**
- [x] Unpaid transfers only affect `computeStock` — **correct**
- [ ] **BUG:** Profit calculation ignores paid transfer margin (only sales counted) — may be intentional but incomplete vs spec “paid transfers write profit”

---

## Daily cash cascade

- [x] `computeDayCash` recomputes from live state per date — **correct**
- [ ] **BUG:** `currentCashBalance` double-counts openings and uses per-day `closing − opening` sum — **incorrect aggregate balance** when multiple days have activity without daily opening entries
- [x] Editing past sale/purchase/transfer date updates that day's cash via derivation — **correct** (once purchase date bug fixed)

---

## Low stock alerts

- [x] `lowStockList` uses per-product `lowStockThreshold` — **correct**
- [x] Dashboard filters `stock <= threshold` — **correct** (redundant filter but harmless)

---

## Archive vs delete

- [x] Products, suppliers, customers, warehouses use `hasHistory` — **correct**
- [ ] **GAP:** `hasHistory` for products does not check `adjustments` — product with only adjustments can be hard-deleted

---

## Persistence (pre-fix)

- [ ] **CRITICAL:** All WMS data in `localStorage` key `wms.state.v1` — not durable, clearable via devtools
- [ ] Theme in `localStorage` key `wms.theme`
- [ ] No IndexedDB usage
- [ ] No Electron main/preload/IPC — **entire desktop layer missing**

---

## Dead code / misc

- [ ] `resetDemo()` in store — defined, no UI
- [ ] TanStack React Query `QueryClient` — initialized, never used for data
- [ ] `console.error` in SSR error handlers only (`__root.tsx`, `server.ts`, `start.ts`) — acceptable

---

## Fix tracking (updated during Phase 2–4)

- [x] Replace localStorage with Electron IPC + JSON file DB
- [x] Add rolling backups (10)
- [x] Add Settings route: export/import
- [x] Fix `currentCashBalance`
- [x] Fix receive edit date preservation
- [x] Fix quantity validation (shared hook + adjustment delta input)
- [x] Fix `hasHistory` for adjustments
- [x] Add `StoreProvider` async hydration
- [x] Remove theme localStorage → IPC preferences

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { replaceState, resetToInitial, setState, useWms } from "@/lib/wms/store";
import { getSettings, normalizeBusinessSettings, paymentMethodLabel } from "@/lib/wms/businessSettings";
import { formatMergeSummary } from "@/lib/wms/mergeImport";
import type { BusinessSettings, PaymentMethod } from "@/lib/wms/types";
import { PageHeader } from "@/components/wms/ui-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/wms/ConfirmDialog";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listUserProfiles, type UserProfile } from "@/lib/wms/firestoreSync";
import { ADMIN_EMAILS } from "@/lib/auth/admin";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

const METHOD_OPTIONS: PaymentMethod[] = ["cash", "ccp", "bank"];

function SettingsPage() {
  const state = useWms((s) => s);
  const settings = getSettings(state);
  const { isAdmin, user, skipAuth } = useAuth();
  const [version, setVersion] = useState("—");
  const [importConfirm, setImportConfirm] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const isElectron = typeof window !== "undefined" && !!window.db;

  useEffect(() => {
    void window.db?.getAppVersion().then(setVersion);
  }, []);

  useEffect(() => {
    if (!isAdmin || skipAuth || isElectron) return;
    setMembersLoading(true);
    void listUserProfiles()
      .then(setMembers)
      .catch((err) => {
        console.error(err);
        toast.error("Could not load team members");
      })
      .finally(() => setMembersLoading(false));
  }, [isAdmin, skipAuth, isElectron]);
  function patchSettings(patch: Partial<BusinessSettings>) {
    setState((s) => ({
      ...s,
      settings: normalizeBusinessSettings({ ...getSettings(s), ...patch }),
    }));
  }

  function toggleMethod(m: PaymentMethod) {
    if (m === "cash") return;
    const cur = settings.paymentMethods;
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
    patchSettings({ paymentMethods: next });
  }

  async function handleExport() {
    if (!window.db) {
      toast.error("Export is only available in the desktop app.");
      return;
    }
    const result = await window.db.exportBackup();
    if (result.cancelled) return;
    if (result.ok && result.path) {
      toast.success(`Backup saved to ${result.path}`);
    } else {
      toast.error(result.error ?? "Export failed");
    }
  }

  async function handleImport() {
    if (!window.db) {
      toast.error("Import is only available in the desktop app.");
      return;
    }
    setImportConfirm(false);
    const result = await window.db.importBackup();
    if (result.cancelled) return;
    if (result.ok && result.state) {
      replaceState(result.state);
      toast.success("Backup imported — all data replaced.");
    } else {
      toast.error(result.error ?? "Import failed");
    }
  }

  async function handleMergeImport() {
    if (!window.db?.importMergeBackup) {
      toast.error("Merge import is only available in the desktop app.");
      return;
    }
    setMergeConfirm(false);
    const result = await window.db.importMergeBackup();
    if (result.cancelled) return;
    if (result.ok && result.state) {
      replaceState(result.state);
      toast.success(
        result.summary
          ? `Merged: ${formatMergeSummary(result.summary)}`
          : "Backup merged — additions only.",
      );
    } else {
      toast.error(result.error ?? "Merge import failed");
    }
  }

  const stockLines = state.customerStock.length;

  return (
    <div className="p-8 max-w-3xl">
      <PageHeader title="Settings" subtitle="Business rules, company profile, and backups." />

      {!isElectron && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground">
          Cloud mode: the whole team shares one warehouse in Firestore. Photos upload to Firebase Storage.
          {isAdmin && (
            <span className="block mt-1 text-muted-foreground">
              Signed in as admin ({user?.email}). You can manage the team below.
            </span>
          )}
        </div>
      )}

      {isAdmin && !isElectron && (
        <section className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
          <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-2">Admin</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Super-admin emails: {ADMIN_EMAILS.join(", ")}. Admins can reset the shared warehouse and see every
            signed-in account.
          </p>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Team</h3>
          {membersLoading ? (
            <p className="text-sm text-muted-foreground">Loading members…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No profiles yet — users appear after they sign in once.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {members.map((m) => (
                <li key={m.uid} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">{m.email || m.uid}</span>
                  {m.isAdmin ? (
                    <span className="shrink-0 rounded bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">
                      Admin
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] uppercase text-muted-foreground">Member</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
        <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">System</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-muted-foreground">App version</dt>
          <dd className="font-mono">{version}</dd>
          <dt className="text-muted-foreground">Schema</dt>
          <dd>v4 (pre-arrival + business settings)</dd>
          <dt className="text-muted-foreground">Runtime</dt>
          <dd>{isElectron ? "Desktop (Electron) — data saved to disk" : "Browser — shared Firestore + Storage"}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{skipAuth ? "Desktop" : isAdmin ? "Admin" : "Member"}</dd>
          <dt className="text-muted-foreground">Products</dt>
          <dd>{state.products.filter((p) => !p.archived).length} active</dd>
          <dt className="text-muted-foreground">Customer stock rows</dt>
          <dd>{stockLines}</dd>
          <dt className="text-muted-foreground">Shipments</dt>
          <dd>{state.preArrivalBons.length}</dd>
        </dl>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
        <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">
          Business rules
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Change how the warehouse pays transporters, handles shortages, and takes payments — without editing code.
        </p>
        <div className="space-y-4 text-sm">
          <div>
            <Label>Transporter payout on arrival</Label>
            <select
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={settings.transporterPayoutMode}
              onChange={(e) =>
                patchSettings({
                  transporterPayoutMode: e.target.value as BusinessSettings["transporterPayoutMode"],
                })
              }
            >
              <option value="immediate">Immediate cash out (net)</option>
              <option value="ledger_only">Ledger only — pay later on transporter page</option>
            </select>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.shortageIncludeDeclaredValue}
              onChange={(e) => patchSettings({ shortageIncludeDeclaredValue: e.target.checked })}
            />
            <span>
              <span className="font-medium">Shortage includes product declared value</span>
              <span className="block text-muted-foreground text-xs">
                Off = shortfall × delivery price only. On = shortfall × (delivery + declared value).
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.walkInRequireFullPayment}
              onChange={(e) => patchSettings({ walkInRequireFullPayment: e.target.checked })}
            />
            <span>
              <span className="font-medium">Walk-in requires full payment</span>
              <span className="block text-muted-foreground text-xs">
                Walk-in never uses customer stock. When on, payment must cover the total.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.pickupRequirePayment}
              onChange={(e) => patchSettings({ pickupRequirePayment: e.target.checked })}
            />
            <span>
              <span className="font-medium">Customer pickup requires full payment</span>
              <span className="block text-muted-foreground text-xs">
                When off, pickup can charge to customer ledger (credit).
              </span>
            </span>
          </label>

          <div>
            <Label>Payment methods</Label>
            <div className="mt-2 flex flex-wrap gap-3">
              {METHOD_OPTIONS.map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.paymentMethods.includes(m)}
                    disabled={m === "cash"}
                    onChange={() => toggleMethod(m)}
                  />
                  {paymentMethodLabel(m)}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={settings.printAutoTrigger}
              onChange={(e) => patchSettings({ printAutoTrigger: e.target.checked })}
            />
            <span>
              <span className="font-medium">Auto-open print dialog</span>
              <span className="block text-muted-foreground text-xs">
                When off, print preview opens with a Print button only.
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
        <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">Company profile</h2>
        <p className="text-sm text-muted-foreground mb-4">Shown on reports and printouts.</p>
        <div className="grid gap-3">
          <div>
            <Label>Name</Label>
            <Input
              value={state.company.name}
              onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, name: e.target.value } }))}
            />
          </div>
          <div>
            <Label>Address</Label>
            <Input
              value={state.company.address}
              onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, address: e.target.value } }))}
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={state.company.phone}
              onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, phone: e.target.value } }))}
            />
          </div>
          <div>
            <Label>Logo initials</Label>
            <Input
              value={state.company.logoText}
              maxLength={3}
              onChange={(e) => setState((s) => ({ ...s, company: { ...s.company, logoText: e.target.value } }))}
            />
          </div>
        </div>
      </section>

      <section className="bg-card border border-border rounded-xl p-6 shadow-sm mb-6">
        <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-4">Backup &amp; restore</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Export creates a JSON backup (schema v4). Use Merge import to add someone else&apos;s new
          bons without wiping your cash and stock. Use Replace import only for a full restore.
          Desktop auto-keeps the last 10 snapshots.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={handleExport} disabled={!isElectron}>
            Export backup
          </Button>
          <Button variant="outline" onClick={() => setMergeConfirm(true)} disabled={!isElectron}>
            Merge import
          </Button>
          <Button variant="outline" onClick={() => setImportConfirm(true)} disabled={!isElectron}>
            Replace import
          </Button>
        </div>
      </section>

      <section className="bg-card border border-destructive/30 rounded-xl p-6 shadow-sm">
        <h2 className="font-bold text-sm uppercase tracking-wider text-destructive mb-4">Danger zone</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {isElectron || isAdmin
            ? "Resets the shared warehouse to an empty seed. This cannot be undone."
            : "Only an admin can reset the shared cloud warehouse."}
        </p>
        <Button
          variant="destructive"
          onClick={() => setResetConfirm(true)}
          disabled={!isElectron && !isAdmin}
        >
          Reset to empty seed
        </Button>
      </section>

      <ConfirmDialog
        open={mergeConfirm}
        onOpenChange={setMergeConfirm}
        title="Merge backup?"
        description="Adds new products, customers, transporters, and open bons. Cash, stock, ledgers, and sales stay as they are. Duplicate invoices are skipped."
        onConfirm={handleMergeImport}
      />
      <ConfirmDialog
        open={importConfirm}
        onOpenChange={setImportConfirm}
        title="Replace all data?"
        description="This will replace ALL current data with the backup file."
        onConfirm={handleImport}
      />
      <ConfirmDialog
        open={resetConfirm}
        onOpenChange={setResetConfirm}
        title="Reset all data?"
        description="This cannot be undone."
        destructive
        onConfirm={() => {
          resetToInitial();
          setResetConfirm(false);
          toast.success("Reset complete");
        }}
      />
    </div>
  );
}

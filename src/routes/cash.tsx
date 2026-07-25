import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { setState, uid, useWms } from "@/lib/wms/store";
import {
  computeDayCash,
  computeRegisterClosing,
  ensureCashRegister,
  formatDZD,
  todayStr,
} from "@/lib/wms/logic";
import type { CashCategory, CashTransaction } from "@/lib/wms/types";
import { PageHeader } from "@/components/wms/ui-bits";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NumericInput } from "@/components/wms/NumericInput";
import { printCashDay } from "@/components/wms/print/CashDayPrint";
import { PrintFormatMenu } from "@/components/wms/print/PrintFormatMenu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assertCashDayOpen, getSettings, paymentMethodLabel } from "@/lib/wms/businessSettings";
import type { PaymentMethod } from "@/lib/wms/types";

export const Route = createFileRoute("/cash")({ component: CashPage });

function CashPage() {
  const state = useWms((s) => s);
  const [date, setDate] = useState(todayStr());
  const day = computeDayCash(state, date);
  const [editOpening, setEditOpening] = useState(false);
  const [openingVal, setOpeningVal] = useState(day.opening);
  const [openingNote, setOpeningNote] = useState("");
  const [newTx, setNewTx] = useState<"in" | "out" | null>(null);
  const [txAmount, setTxAmount] = useState(0);
  const [txDesc, setTxDesc] = useState("");
  const [txCategory, setTxCategory] = useState<CashCategory>("expense");
  const [txMethod, setTxMethod] = useState<PaymentMethod>("cash");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenNote, setReopenNote] = useState("");
  const settings = getSettings(state);

  const reg = state.cashRegisters.find((r) => r.date === date) ?? ensureCashRegister(state, date);

  function ensureRegExists() {
    setState((s) => {
      if (s.cashRegisters.some((r) => r.date === date)) return s;
      const reg = ensureCashRegister(s, date);
      return { ...s, cashRegisters: [...s.cashRegisters, reg] };
    });
  }

  function saveOpening() {
    if (openingNote.trim() === "" && openingVal !== day.opening) {
      toast.error("Note required when changing opening balance");
      return;
    }
    ensureRegExists();
    setState((s) => {
      const regs = s.cashRegisters.filter((r) => r.date !== date);
      return {
        ...s,
        cashRegisters: [
          ...regs,
          {
            date,
            openingBalance: openingVal,
            openingNote: openingNote || undefined,
            isClosed: reg.isClosed,
            closedAt: reg.closedAt,
          },
        ],
      };
    });
    setEditOpening(false);
    toast.success("Opening balance updated");
  }

  function addTransaction() {
    if (txAmount <= 0 || !txDesc.trim()) { toast.error("Amount and description required"); return; }
    try {
      assertCashDayOpen(state, date);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cash day closed");
      return;
    }
    ensureRegExists();
    const tx: CashTransaction = {
      id: uid(),
      date,
      direction: newTx!,
      category: txCategory,
      amount: txAmount,
      description: txDesc,
      paymentMethod: txMethod,
    };
    setState((s) => ({ ...s, cashTransactions: [...s.cashTransactions, tx] }));
    setNewTx(null);
    setTxAmount(0);
    setTxDesc("");
    toast.success("Transaction added");
  }

  function closeDay() {
    const closing = computeRegisterClosing(state, date);
    setState((s) => {
      const regs = s.cashRegisters.filter((r) => r.date !== date);
      const closed: typeof reg = {
        date,
        openingBalance: reg.openingBalance,
        openingNote: reg.openingNote,
        isClosed: true,
        closedAt: new Date().toISOString(),
      };
      const tomorrow = new Date(date);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      const hasTomorrow = s.cashRegisters.some((r) => r.date === tomorrowStr);
      return {
        ...s,
        cashRegisters: [
          ...regs,
          closed,
          ...(hasTomorrow ? [] : [{ date: tomorrowStr, openingBalance: closing, isClosed: false }]),
        ],
      };
    });
    toast.success(`Day closed — closing ${formatDZD(closing)}`);
  }

  function reopenDay() {
    if (!reopenNote.trim()) {
      toast.error("Note required to reopen a closed day");
      return;
    }
    if (!day.isClosed) {
      toast.error("Day is already open");
      return;
    }
    setState((s) => {
      const regs = s.cashRegisters.filter((r) => r.date !== date);
      return {
        ...s,
        cashRegisters: [
          ...regs,
          {
            date,
            openingBalance: reg.openingBalance,
            openingNote: reg.openingNote,
            isClosed: false,
            closedAt: undefined,
            reopenNote: reopenNote.trim(),
            reopenedAt: new Date().toISOString(),
          },
        ],
      };
    });
    setReopenOpen(false);
    setReopenNote("");
    toast.success(`Day ${date} reopened`);
  }

  return (
    <div className="p-8">
      <PageHeader
        title="Daily Cash Register"
        subtitle={day.isClosed ? "Day is closed" : "Live running total"}
        actions={
          <div className="flex gap-2">
            <PrintFormatMenu
              label="Print"
              size="default"
              onSelect={(format) => printCashDay(date, day, state.company, format, getSettings(state).printAutoTrigger)}
            />
            {!day.isClosed ? (
              <>
                <Button variant="outline" onClick={() => setNewTx("in")}>+ Cash In</Button>
                <Button variant="outline" onClick={() => setNewTx("out")}>+ Cash Out</Button>
                <Button onClick={closeDay}>Close Day</Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => { setReopenNote(""); setReopenOpen(true); }}>
                Reopen Day
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-6">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-xs" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Kpi label="Opening" value={formatDZD(day.opening)} onEdit={() => { setOpeningVal(day.opening); setEditOpening(true); }} />
        <Kpi label="Cash In" value={formatDZD(day.cashIn)} accent="success" />
        <Kpi label="Cash Out" value={formatDZD(day.cashOut)} accent="danger" />
        <Kpi label="Closing" value={formatDZD(day.closing)} accent="info" />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8 text-sm">
        <div className="bg-card border rounded-lg p-4">Customer payments: <strong>{formatDZD(day.customerPayments)}</strong></div>
        <div className="bg-card border rounded-lg p-4">Transporter payouts: <strong>{formatDZD(day.transporterPayouts)}</strong></div>
        <div className="bg-card border rounded-lg p-4">Expenses: <strong>{formatDZD(day.expenses)}</strong></div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Direction</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {day.transactions.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3 uppercase font-bold text-[10px]">{t.direction}</td>
                <td className="px-4 py-3 capitalize">{t.category.replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {t.paymentMethod ? paymentMethodLabel(t.paymentMethod) : "—"}
                </td>
                <td className="px-4 py-3">{t.description}</td>
                <td className={"px-4 py-3 text-right font-mono font-bold " + (t.direction === "in" ? "text-success" : "text-destructive")}>
                  {t.direction === "in" ? "+" : "−"}{formatDZD(t.amount)}
                </td>
              </tr>
            ))}
            {day.transactions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No transactions today</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={editOpening} onOpenChange={setEditOpening}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit opening balance</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Opening balance</Label><NumericInput value={openingVal} onChange={setOpeningVal} /></div>
            <div><Label>Note (required if changed)</Label><Textarea value={openingNote} onChange={(e) => setOpeningNote(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpening(false)}>Cancel</Button>
            <Button onClick={saveOpening}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newTx} onOpenChange={() => setNewTx(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{newTx === "in" ? "Cash In" : "Cash Out"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Category</Label>
              <Select value={txCategory} onValueChange={(v) => setTxCategory(v as CashCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {newTx === "in" ? (
                    <>
                      <SelectItem value="customer_payment">Customer Payment</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="transporter_payout">Transporter Payout</SelectItem>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Amount</Label><NumericInput value={txAmount} onChange={setTxAmount} /></div>
            {settings.paymentMethods.length > 0 && (
              <div>
                <Label>Payment method</Label>
                <Select value={txMethod} onValueChange={(v) => setTxMethod(v as PaymentMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {settings.paymentMethods.map((m) => (
                      <SelectItem key={m} value={m}>{paymentMethodLabel(m)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Description</Label><Textarea value={txDesc} onChange={(e) => setTxDesc(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTx(null)}>Cancel</Button>
            <Button onClick={addTransaction}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reopen cash day</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reopening {date} allows new cash in/out again. Enter a reason for the audit trail.
          </p>
          <div>
            <Label>Reason (required)</Label>
            <Textarea
              value={reopenNote}
              onChange={(e) => setReopenNote(e.target.value)}
              placeholder="e.g. Forgot evening sale"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button onClick={reopenDay}>Reopen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, accent = "neutral", onEdit }: { label: string; value: string; accent?: string; onEdit?: () => void }) {
  return (
    <div className="bg-card p-5 rounded-xl border border-border">
      <div className="flex justify-between items-center">
        <div className="text-[10px] font-bold text-muted-foreground uppercase">{label}</div>
        {onEdit && <button className="text-[10px] text-primary font-bold uppercase" onClick={onEdit}>Edit</button>}
      </div>
      <div className="mt-2 text-xl font-bold font-mono">{value}</div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { setState, uid, useWms } from "@/lib/wms/store";
import { formatDZD, formatQty } from "@/lib/wms/logic";
import { getSettings } from "@/lib/wms/businessSettings";
import type { BonException, WmsState } from "@/lib/wms/types";
import { PageHeader, StatusPill } from "@/components/wms/ui-bits";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/exceptions")({ component: ExceptionsPage });

/** Per-unit and line totals: delivery cost + product declared value. */
function exceptionBreakdown(ex: BonException, state: WmsState) {
  const includeDeclared = getSettings(state).shortageIncludeDeclaredValue;
  const product = state.products.find((p) => p.id === ex.productId);
  const bon = state.preArrivalBons.find((b) => b.id === ex.bonId);
  const item = bon?.items.find((i) => i.id === ex.lineItemId);

  const deliveryUnit = item?.price ?? product?.purchasePrice ?? 0;
  const declaredUnit = includeDeclared ? (product?.declaredValue ?? 0) : 0;
  const sf = ex.shortfallQty;
  const deliveryTotal = Math.round(sf * deliveryUnit);
  const declaredTotal = Math.round(sf * declaredUnit);

  return {
    product,
    bon,
    deliveryUnit,
    declaredUnit,
    deliveryTotal,
    declaredTotal,
    /** Stored amount is source of truth for credit/absorb */
    total: ex.compensationAmount,
  };
}

function ExceptionsPage() {
  const state = useWms((s) => s);
  const includeDeclared = getSettings(state).shortageIncludeDeclaredValue;
  const open = state.bonExceptions.filter((e) => !e.resolved);
  const resolved = state.bonExceptions.filter((e) => e.resolved);

  function creditCustomer(exId: string) {
    const ex = state.bonExceptions.find((e) => e.id === exId);
    if (!ex) return;
    const customer = state.customers.find((c) => c.id === ex.customerId);
    const product = state.products.find((p) => p.id === ex.productId);
    const bon = state.preArrivalBons.find((b) => b.id === ex.bonId);

    setState((s) => ({
      ...s,
      bonExceptions: s.bonExceptions.map((e) =>
        e.id === exId
          ? {
              ...e,
              resolved: true,
              customerCredited: true,
              resolvedAt: new Date().toISOString(),
              resolutionNote: "Customer credited",
            }
          : e,
      ),
      customerLedger: [
        ...s.customerLedger,
        {
          id: uid(),
          customerId: ex.customerId,
          date: new Date().toISOString(),
          type: "credit",
          amount: -ex.compensationAmount,
          description: `Compensation — ${product?.name ?? "item"} missing/damaged (Invoice ${bon?.invoice ?? ex.bonId})`,
          relatedBonId: ex.bonId,
        },
      ],
    }));
    toast.success(`Credit posted to ${customer?.name}`);
  }

  function markResolved(exId: string, note: string) {
    setState((s) => ({
      ...s,
      bonExceptions: s.bonExceptions.map((e) =>
        e.id === exId
          ? { ...e, resolved: true, resolvedAt: new Date().toISOString(), resolutionNote: note }
          : e,
      ),
    }));
    toast.success("Marked resolved");
  }

  return (
    <div className="p-8 space-y-8">
      <PageHeader
        title="Exceptions"
        subtitle={
          includeDeclared
            ? "Missing / damaged — amount = delivery cost + product declared value (× shortfall)"
            : "Missing / damaged — amount = delivery cost only (declared value off in Settings)"
        }
      />

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
          Open ({open.length})
        </h2>
        <ExceptionTable
          items={open}
          state={state}
          onCredit={creditCustomer}
          onResolve={(id) => markResolved(id, "Absorbed by warehouse")}
        />
      </section>

      {resolved.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
            Resolved ({resolved.length})
          </h2>
          <ExceptionTable items={resolved} state={state} resolved />
        </section>
      )}
    </div>
  );
}

function ExceptionTable({
  items,
  state,
  onCredit,
  onResolve,
  resolved,
}: {
  items: BonException[];
  state: WmsState;
  onCredit?: (id: string) => void;
  onResolve?: (id: string) => void;
  resolved?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center border rounded-xl">
        No exceptions
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-left text-sm min-w-[900px]">
        <thead className="bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
          <tr>
            <th className="px-4 py-2">Bon</th>
            <th className="px-4 py-2">Customer</th>
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2">Shortfall</th>
            <th className="px-4 py-2 text-right">Delivery</th>
            <th className="px-4 py-2 text-right">Declared</th>
            <th className="px-4 py-2 text-right">Amount</th>
            <th className="px-4 py-2">Status</th>
            {!resolved && <th className="px-4 py-2 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((ex) => {
            const { product, bon, deliveryTotal, declaredTotal, total } = exceptionBreakdown(
              ex,
              state,
            );
            const customer = state.customers.find((c) => c.id === ex.customerId);
            return (
              <tr key={ex.id}>
                <td className="px-4 py-3 font-mono">{bon?.invoice ?? ex.bonId}</td>
                <td className="px-4 py-3">{customer?.name}</td>
                <td className="px-4 py-3">{product?.name}</td>
                <td className="px-4 py-3 font-mono">{formatQty(ex.shortfallQty, product)}</td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                  {formatDZD(deliveryTotal)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                  {formatDZD(declaredTotal)}
                </td>
                <td className="px-4 py-3 text-right font-mono font-bold">{formatDZD(total)}</td>
                <td className="px-4 py-3">
                  {ex.customerCredited ? (
                    <StatusPill tone="success">Credited</StatusPill>
                  ) : ex.resolved ? (
                    <StatusPill tone="neutral">Resolved</StatusPill>
                  ) : (
                    <StatusPill tone="danger">Open</StatusPill>
                  )}
                </td>
                {!resolved && (
                  <td className="px-4 py-3 text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => onCredit?.(ex.id)}>
                      Credit Customer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onResolve?.(ex.id)}>
                      Absorb Loss
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

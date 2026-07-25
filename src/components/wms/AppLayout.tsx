import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { useWms } from "@/lib/wms/store";
import { currentCashBalance } from "@/lib/wms/logic";
import { formatDZD } from "@/lib/wms/logic";

const nav: Array<{ group: string; items: Array<{ to: string; label: string }> }> = [
  {
    group: "Operations",
    items: [
      { to: "/", label: "Dashboard" },
      { to: "/pre-arrival", label: "Pre Arrival Bons" },
      { to: "/arrival", label: "Arrival Verification" },
      { to: "/inventory", label: "Inventory" },
      { to: "/sell", label: "Selling" },
      { to: "/history", label: "Shipment History" },
      { to: "/transporters", label: "Transporters" },
      { to: "/customers", label: "Customers" },
      { to: "/products", label: "Products" },
    ],
  },
  {
    group: "Finance",
    items: [
      { to: "/cash", label: "Daily Cash" },
      { to: "/exceptions", label: "Exceptions" },
      { to: "/reports", label: "Reports" },
      { to: "/settings", label: "Settings" },
    ],
  },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const company = useWms((s) => s.company);
  const balance = useWms((s) => currentCashBalance(s));
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    async function loadTheme() {
      if (window.db) {
        const theme = await window.db.getTheme();
        const isDark = theme === "dark";
        setDark(isDark);
        document.documentElement.classList.toggle("dark", isDark);
        return;
      }
      setDark(document.documentElement.classList.contains("dark"));
    }
    void loadTheme();
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    if (window.db) {
      void window.db.setTheme(next ? "dark" : "light");
    }
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      <aside className="w-64 border-r border-border bg-sidebar flex flex-col shrink-0 sticky top-0 h-screen">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="size-8 bg-primary rounded flex items-center justify-center text-primary-foreground font-bold">
            {company.logoText}
          </div>
          <span className="font-bold text-lg tracking-tight uppercase truncate">{company.name.split(" ")[0]}</span>
        </div>

        <nav className="p-4 space-y-1 flex-1 overflow-y-auto">
          {nav.map((g) => (
            <div key={g.group}>
              <div className="px-3 py-2 mt-4 first:mt-0 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {g.group}
              </div>
              {g.items.map((it) => {
                const active = pathname === it.to || (it.to !== "/" && pathname.startsWith(it.to));
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={
                      "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors " +
                      (active
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground")
                    }
                  >
                    <span
                      className={
                        "size-1.5 rounded-full " + (active ? "bg-primary" : "bg-transparent")
                      }
                    />
                    {it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="bg-foreground text-background p-4 rounded-lg">
            <div className="text-[10px] font-bold text-background/60 uppercase tracking-wider">
              Current Balance
            </div>
            <div className="text-lg font-mono font-bold tracking-tight mt-1">
              {formatDZD(balance)}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-card flex items-center justify-between px-8 sticky top-0 z-10">
          <GlobalSearch />
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-success animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">Live System</span>
            </div>
            <button
              onClick={toggleTheme}
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              {dark ? "Light" : "Dark"}
            </button>
            <div className="size-8 rounded-full bg-secondary outline-1 -outline-offset-1 outline-border" />
          </div>
        </header>
        <div className="flex-1">{children}</div>
        {mounted && <Toaster position="top-right" richColors />}
      </main>
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const state = useWms((s) => s);
  const results = useMemo(() => {
    if (!q.trim()) return [] as Array<{ label: string; to: string; params?: Record<string, string>; kind: string }>;
    const lc = q.toLowerCase();
    const r: Array<{ label: string; to: string; params?: Record<string, string>; kind: string }> = [];
    state.products.filter((p) => p.name.toLowerCase().includes(lc)).slice(0, 3).forEach((p) =>
      r.push({ label: p.name, to: "/products", kind: "Product" }),
    );
    state.customers.filter((x) => x.name.toLowerCase().includes(lc) || x.phone.includes(lc)).slice(0, 3).forEach((x) =>
      r.push({
        label: `${x.name} — ${x.phone}`,
        to: "/customers/$customerId",
        params: { customerId: x.id },
        kind: "Customer",
      }),
    );
    state.transporters.filter((x) => x.name.toLowerCase().includes(lc) || x.phone.includes(lc)).slice(0, 3).forEach((x) =>
      r.push({
        label: `${x.name} — ${x.phone}`,
        to: "/transporters/$transporterId",
        params: { transporterId: x.id },
        kind: "Transporter",
      }),
    );
    state.preArrivalBons.filter((x) => x.invoice.toLowerCase().includes(lc) || x.transporterName.toLowerCase().includes(lc)).slice(0, 3).forEach((x) =>
      r.push({
        label: x.invoice,
        to: "/history/$bonId",
        params: { bonId: x.id },
        kind: "Shipment",
      }),
    );
    return r;
  }, [state, q]);

  return (
    <div className="w-96 relative">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products, invoices, phones..."
        className="w-full bg-secondary border-none rounded-md px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
      />
      {q && results.length > 0 && (
        <div className="absolute top-full mt-1 w-full bg-popover border border-border rounded-md shadow-lg overflow-hidden z-50">
          {results.map((r, i) => (
            <Link
              key={i}
              to={r.to as "/products"}
              params={r.params as never}
              onClick={() => setQ("")}
              className="flex items-center justify-between px-4 py-2 text-sm hover:bg-secondary"
            >
              <span className="truncate">{r.label}</span>
              <span className="text-[10px] uppercase text-muted-foreground font-bold">{r.kind}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

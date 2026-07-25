import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";

export function ListSearchBar({
  value,
  onChange,
  placeholder = "Search...",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Input
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? "max-w-sm"}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1" suppressHydrationWarning>{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-4">
      {(title || actions) && (
        <div className="flex items-center justify-between">
          {title && <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, cta }: { title: string; cta?: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-12 text-center">
      <div className="text-sm text-muted-foreground mb-4">{title}</div>
      {cta}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: "success" | "warning" | "danger" | "info" | "neutral"; children: ReactNode }) {
  const map: Record<string, string> = {
    success: "bg-success/10 text-success ring-success/20",
    warning: "bg-warning/10 text-warning ring-warning/30",
    danger: "bg-destructive/10 text-destructive ring-destructive/20",
    info: "bg-primary/10 text-primary ring-primary/20",
    neutral: "bg-secondary text-secondary-foreground ring-border",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ${map[tone]}`}>
      {children}
    </span>
  );
}

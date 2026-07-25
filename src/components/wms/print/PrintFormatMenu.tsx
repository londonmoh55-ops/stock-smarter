import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PrintFormat } from "./printTypes";

export function PrintFormatMenu({
  onSelect,
  label = "Print",
  size = "sm",
  variant = "outline",
  disabled,
  triggerClassName,
  trigger,
}: {
  onSelect: (format: PrintFormat) => void;
  label?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  disabled?: boolean;
  triggerClassName?: string;
  /** Custom trigger; defaults to Button with label */
  trigger?: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {trigger ?? (
          <Button type="button" size={size} variant={variant} className={triggerClassName} disabled={disabled}>
            {label}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onSelect("a4")}>A4 paper</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect("thermal")}>Thermal (80mm)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

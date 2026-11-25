import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 font-caption text-caption leading-tight",
  {
    variants: {
      variant: {
        neutral: "bg-surface-variant text-text-secondary border-border-subtle",
        brand: "bg-brand-50 text-brand-600 border-brand-200",
        success: "bg-success-surface text-success-text border-emerald-200",
        warning: "bg-warning-surface text-warning-text border-amber-200",
        danger: "bg-danger-surface text-danger-text border-red-200",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

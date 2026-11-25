import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[8px] font-body-bold text-body-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-white hover:bg-primary-hover active:opacity-90 border border-transparent",
        secondary:
          "bg-surface-variant text-text-primary hover:bg-border-subtle active:opacity-90 border border-border-subtle",
        outline:
          "bg-surface text-primary border border-primary hover:bg-brand-50 active:opacity-90",
        danger:
          "bg-danger-base text-white hover:opacity-90 active:opacity-80 border border-transparent",
        ghost:
          "bg-transparent text-text-secondary hover:bg-surface-variant hover:text-text-primary border border-transparent",
      },
      size: {
        default: "min-h-[44px] px-4 py-2",
        sm: "min-h-[36px] px-3 py-1.5 text-[13px]",
        lg: "min-h-[48px] px-5 py-3",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  fullWidth?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          buttonVariants({ variant, size }),
          fullWidth && "w-full",
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

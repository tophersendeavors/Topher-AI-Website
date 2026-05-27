import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost" | "outline" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(function Button({ className, variant = "primary", ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-ghost",
        variant === "outline" && "btn-outline",
        variant === "danger" &&
          "btn bg-red-600/90 text-white hover:bg-red-500",
        className
      )}
      {...rest}
    />
  );
});

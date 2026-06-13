import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";

import { cn } from "@/lib/utils/cn";

const fieldClassName =
  "min-h-11 w-full rounded-sm border border-line bg-surface px-4 text-15 text-ink transition-[background-color,border-color,box-shadow,color] duration-fast ease-stoop placeholder:text-ink-3 focus-visible:border-verdigris focus-visible:shadow-[0_0_0_var(--ab-s-1)_var(--ab-verdigris-3)] disabled:cursor-not-allowed disabled:opacity-40";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { numeric?: boolean }
>(({ className, numeric = false, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(fieldClassName, numeric && "font-mono text-right", className)}
    {...props}
  />
));

Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldClassName, "min-h-20 py-3", className)}
    {...props}
  />
));

Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(fieldClassName, "appearance-none pr-10", className)}
    {...props}
  >
    {children}
  </select>
));

Select.displayName = "Select";

export const Checkbox = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "checkbox", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "h-5 w-5 rounded-xs border-line text-verdigris accent-verdigris focus:ring-verdigris",
      className
    )}
    {...props}
  />
));

Checkbox.displayName = "Checkbox";

export const Toggle = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "checkbox", ...props }, ref) => {
  const ariaChecked =
    props["aria-checked"] ??
    (typeof props.checked === "boolean"
      ? props.checked
      : Boolean(props.defaultChecked));

  return (
    <input
      ref={ref}
      aria-checked={ariaChecked}
      type={type}
      role="switch"
      className={cn(
        "h-6 w-10 appearance-none rounded-pill border border-line bg-paper-3 shadow-inset transition-[background-color,box-shadow] duration-fast ease-stoop checked:bg-verdigris focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris",
        className
      )}
      {...props}
    />
  );
});

Toggle.displayName = "Toggle";

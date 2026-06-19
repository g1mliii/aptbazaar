import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type Ref,
  type ReactElement,
  type ReactNode
} from "react";

import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "ink" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  children: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-transparent bg-verdigris text-surface shadow-sm hover:bg-verdigris-2",
  secondary: "border-line bg-surface text-ink hover:bg-paper-2 hover:text-ink",
  ghost: "border-transparent bg-transparent text-ink hover:bg-paper-2",
  ink: "border-transparent bg-ink text-paper shadow-sm hover:bg-ink-2",
  danger: "border-danger bg-transparent text-danger hover:bg-danger-3 hover:text-danger"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 rounded-sm px-3 text-13",
  md: "h-10 rounded-md px-4 text-14",
  lg: "h-12 rounded-md px-6 text-15"
};

type ButtonChildProps = {
  className?: string;
  ref?: Ref<HTMLElement>;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) {
    return;
  }

  if (typeof ref === "function") {
    ref(value);
    return;
  }

  ref.current = value;
}

function composeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (value: T | null) => {
    refs.forEach((ref) => assignRef(ref, value));
  };
}

export const buttonClassName = ({
  className,
  size = "md",
  variant = "primary"
}: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}) =>
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 border font-sans font-semibold transition-[background-color,border-color,box-shadow,color,transform] duration-fast ease-stoop",
    "active:translate-y-1 active:shadow-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verdigris",
    "[&_svg]:h-5 [&_svg]:w-5 [&_svg]:stroke-[1.5]",
    variants[variant],
    sizes[size],
    className
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      children,
      className,
      size = "md",
      type,
      variant = "primary",
      ...props
    },
    ref
  ) => {
    const classes = buttonClassName({ className, size, variant });

    if (asChild && isValidElement(children)) {
      const child = children as ReactElement<ButtonChildProps>;
      const childProps: ButtonChildProps & typeof props = {
        ...props,
        className: cn(classes, child.props.className)
      };

      if (child.props.ref || ref) {
        childProps.ref = composeRefs(child.props.ref, ref as ForwardedRef<HTMLElement>);
      }

      return cloneElement(child, childProps);
    }

    return (
      <button ref={ref} className={classes} type={type ?? "button"} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

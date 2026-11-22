import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, Icon, Spinner, type IconName } from "../../shared/index.ts";
import "./button.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconAfter?: IconName;
  /** Shows the spinner, keeps the width, and blocks clicks */
  loading?: boolean;
  /** Text read while loading, e.g. "Saving" */
  loadingLabel?: string;
  children?: ReactNode;
}

/**
 * Molded push button. It sits raised on the page and physically presses in while held;
 * loading keeps the label's width so the layout never jumps.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  loading = false,
  loadingLabel,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;
  return (
    <button
      type={type}
      className={cx("kb-btn", className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-icon-only={!children || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className="kb-btn-face">
        {icon ? <Icon name={icon} size={iconSize} /> : null}
        {children ? <span>{children}</span> : null}
        {iconAfter ? <Icon name={iconAfter} size={iconSize} /> : null}
      </span>
      {loading ? (
        <span className="kb-btn-busy">
          <Spinner size={iconSize - 2} label={loadingLabel ?? "Working"} />
          {loadingLabel ? <span>{loadingLabel}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

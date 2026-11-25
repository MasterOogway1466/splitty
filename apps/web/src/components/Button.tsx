import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { focusRing, textLinkClass } from "./styles.js";

// Every action in the app is one of these, so what can be pressed, and how
// much it matters, is recognizable without hovering:
//   primary    the main action of an area (at most one)
//   secondary  anything else you can do there
//   danger     removes or leaves something. Not in rows of balances, where
//              red already means owing; there only the confirmation is red
const VARIANTS = {
  primary: "border-ledger bg-ledger text-paper hover:border-ledger-dark hover:bg-ledger-dark",
  secondary: "border-edge bg-white text-ledger hover:border-ledger hover:bg-wash",
  danger: "border-rust/40 bg-white text-rust hover:border-rust hover:bg-rust/5",
  dangerSolid: "border-rust bg-rust text-paper hover:bg-rust/90",
} as const;
const SIZES = {
  md: "px-3.5 py-2 text-sm",
  sm: "px-2.5 py-1.5 text-sm",
  xs: "px-2 py-1 text-xs",
} as const;

interface Look {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  icon?: IconName;
}

export function Button({
  variant = "secondary",
  size = "sm",
  icon,
  className = "",
  type = "button",
  children,
  ...rest
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${focusRing} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} className={size === "xs" ? "h-3.5 w-3.5" : ""} />}
      {children}
    </button>
  );
}

/** Asks in place before doing something that removes or leaves. */
export function ConfirmButton(
  props: Look & {
    label: string;
    question: string;
    confirmLabel: string;
    pending?: boolean;
    disabled?: boolean;
    onConfirm: () => unknown;
  },
) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const wasAsking = useRef(false);

  // Focus follows the swap. It lands on Cancel, so a stray Enter is harmless.
  useEffect(() => {
    if (asking) panel.current?.querySelector<HTMLButtonElement>("[data-cancel]")?.focus();
    else if (wasAsking.current) trigger.current?.querySelector("button")?.focus();
    wasAsking.current = asking;
  }, [asking]);

  if (!asking) {
    return (
      <span ref={trigger}>
        <Button
          variant={props.variant ?? "danger"}
          size={props.size ?? "sm"}
          {...(props.icon ? { icon: props.icon } : {})}
          disabled={props.disabled}
          onClick={() => setAsking(true)}
        >
          {props.label}
        </Button>
      </span>
    );
  }
  return (
    <span
      ref={panel}
      role="group"
      aria-label={props.question}
      onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
      className="inline-flex flex-wrap items-center gap-2 rounded-md border border-rust/30 bg-rust/5 px-2.5 py-1.5 text-sm text-ink"
    >
      {props.question}
      <span className="inline-flex gap-2">
        <Button
          variant="dangerSolid"
          size="xs"
          disabled={props.pending}
          onClick={async () => {
            await props.onConfirm();
            setAsking(false);
          }}
        >
          {props.confirmLabel}
        </Button>
        <Button size="xs" data-cancel onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </span>
    </span>
  );
}

/** Shows or hides something nearby; the chevron says which. */
export function DisclosureButton({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm font-medium text-ledger transition-colors hover:bg-wash ${focusRing} focus-visible:ring-inset`}
    >
      <Icon name="chevronDown" className={`transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      {children}
    </button>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={`-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-ledger transition-colors hover:bg-ledger/10 ${focusRing}`}
    >
      <Icon name="chevronLeft" />
      {children}
    </Link>
  );
}

export function TextLink({ className = "", ...rest }: LinkProps) {
  return <Link className={`${textLinkClass} ${className}`} {...rest} />;
}

// A row that opens something: the whole row is the target, and the chevron
// says so before anyone hovers. Put RowLink on its title and RowChevron at
// the end; anything else pressable inside needs `relative` to sit above.
export const rowClass = "group relative transition-colors hover:bg-wash";

export function RowLink({ className = "", children, ...rest }: LinkProps) {
  return (
    <Link
      className={`font-medium text-ink outline-none transition-colors group-hover:text-ledger after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ledger ${className}`}
      {...rest}
    >
      {children}
    </Link>
  );
}

export function RowChevron() {
  return <Icon name="chevronRight" className="text-ink-muted transition-colors group-hover:text-ledger" />;
}

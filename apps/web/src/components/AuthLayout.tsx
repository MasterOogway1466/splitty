import type { ReactNode } from "react";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <p className="text-center font-semibold text-ledger text-sm tracking-tight mb-6">Splitty</p>
        <div className="bg-white border border-line rounded-lg p-6">
          <h1 className="text-lg font-semibold text-ink mb-6">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="mb-4 rounded-md bg-rust/10 border border-rust/25 text-rust text-sm px-3 py-2">{message}</div>;
}

export function SuccessBanner({ message }: { message: string }) {
  return <div className="mb-4 rounded-md bg-ledger/10 border border-ledger/25 text-ledger-dark text-sm px-3 py-2">{message}</div>;
}

export function TextField(props: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-ink mb-1">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        required={props.required}
        minLength={props.minLength}
        className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-ledger/40 focus:border-ledger"
      />
    </label>
  );
}

export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full rounded-md bg-ledger text-paper text-sm font-medium py-2 hover:bg-ledger-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

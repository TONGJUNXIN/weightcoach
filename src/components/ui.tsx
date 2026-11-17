import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { copy } from "@/lib/copy";
import { friendlyError } from "@/lib/errors";

type Toast = { id: number; text: string; kind: "info" | "error" };

const ToastContext = createContext<{ show: (text: string, kind?: Toast["kind"]) => void }>({
  show: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex w-[320px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-fade-up rounded-xl px-4 py-3 text-sm shadow-lift ${
              t.kind === "error"
                ? "border border-danger/10 bg-danger text-white"
                : "border border-primary-soft bg-primary text-white"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export function showError(error: unknown, show: (text: string, kind?: Toast["kind"]) => void) {
  show(friendlyError(error), "error");
}

export function Button({
  children, onClick, variant = "primary", type = "button", disabled, className = "", size = "md", ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const styles = {
    primary: "bg-primary text-white shadow-soft hover:bg-primary-deep",
    secondary: "border border-line bg-paper text-ink hover:border-primary/30 hover:bg-primary-soft/40",
    danger: "bg-danger text-white hover:opacity-90",
    ghost: "text-muted hover:bg-primary-soft/50 hover:text-primary",
  }[variant];
  const sizing = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${sizing} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs text-danger">{error}</span> : hint ? (
        <span className="mt-1.5 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none transition-shadow placeholder:text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/10 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-10 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/10 ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink outline-none transition-shadow placeholder:text-muted/60 focus:border-primary focus:ring-2 focus:ring-primary/10 ${props.className ?? ""}`}
    />
  );
}

export function Modal({ title, onClose, children, footer, width = "md", dismissable = true }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  dismissable?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (dismissable && e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector<HTMLElement>("input, select, textarea")
        ?? panelRef.current?.querySelector<HTMLElement>("button");
      first?.focus();
    }, 30);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [dismissable]);

  const widthClass = { sm: "max-w-[420px]", md: "max-w-[560px]", lg: "max-w-[760px]", xl: "max-w-[920px]" }[width];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/35 p-2 backdrop-blur-[2px] sm:p-4" onClick={dismissable ? onClose : undefined}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[calc(100vh-16px)] w-full ${widthClass} animate-fade-up flex-col overflow-hidden rounded-3xl border border-line/80 bg-paper shadow-lift`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-5">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {dismissable && (
            <button
              type="button"
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-bg hover:text-ink"
              onClick={onClose}
              aria-label="关闭"
            >
              <X size={17} />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line/70 px-6 py-3.5"><div className="flex justify-end gap-2">{footer}</div></div>}
      </div>
    </div>,
    document.body,
  );
}

export function Card({ title, children, action, eyebrow, className = "" }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line/80 bg-paper p-5 shadow-card ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          {eyebrow && <div className="mb-1 text-[10px] font-medium uppercase tracking-[2px] text-muted">{eyebrow}</div>}
          <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Badge({ children, tone = "teal", className = "" }: {
  children: ReactNode;
  tone?: "teal" | "coral" | "gold" | "muted";
  className?: string;
}) {
  const tones = {
    teal: "bg-primary-soft text-primary-deep",
    coral: "bg-accent-soft text-accent",
    gold: "bg-[#FBF6E4] text-[#9A7416]",
    muted: "bg-bg text-muted",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${tones} ${className}`}>
      {children}
    </span>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-6">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[2.2px] text-muted">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-.4px] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}

export function Avatar({ name, color, src, size = 34, className = "", style }: {
  name: string;
  color?: string;
  src?: string | null;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color ?? "#1F5A52", fontSize: Math.max(10, size * 0.36), ...style }}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : ([...name][0] ?? "?")}
    </span>
  );
}

export function Progress({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-line/70 ${className}`}>
      <div className="h-full rounded-full bg-gradient-to-r from-primary to-leaf transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted/60" />
      </div>
      <p className="text-sm text-muted">{text || copy.empty.noWeight}</p>
    </div>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
      {action}
    </div>
  );
}

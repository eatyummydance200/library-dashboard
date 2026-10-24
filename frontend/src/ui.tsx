import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import icons from "./icons.json";
import { message } from "./api";

export const NoticeContext = createContext<(value: string) => void>(() => {});
export const useNotice = () => useContext(NoticeContext);
export function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
export function Loading({
  error,
  retry,
}: {
  error?: string;
  retry: () => void;
}) {
  return (
    <div className="resource-state" role={error ? "alert" : "status"}>
      {error || "불러오는 중…"}
      {error && (
        <button className="btn" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  );
}
export function ResourceError({
  error,
  retry,
}: {
  error?: string;
  retry: () => void;
}) {
  return error ? (
    <p className="inline-error" role="alert">
      {error}{" "}
      <button className="text-btn" onClick={retry}>
        다시 시도
      </button>
    </p>
  ) : null;
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={id}
      onCancel={onClose}
    >
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        <button type="button" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Form({
  children,
  onSave,
  onClose,
  submit = "저장하기",
}: {
  children: ReactNode;
  onSave: (data: FormData) => Promise<void>;
  onClose: () => void;
  submit?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const data = new FormData(event.currentTarget);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(data);
    } catch (error) {
      setError(message(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <fieldset disabled={busy} aria-busy={busy}>
        {children}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="btn" type="button" onClick={onClose}>
            취소
          </button>
          <button className="btn primary" type="submit">
            {busy ? "저장 중…" : submit}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}
export const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "");
export const numeric = (data: FormData, key: string) =>
  Number(value(data, key));
export function Action({
  children,
  run,
  className = "btn",
  disabled = false,
}: {
  children: ReactNode;
  run: () => Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const notice = useNotice();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      onClick={async () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        try {
          await run();
        } catch (error) {
          notice(message(error));
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

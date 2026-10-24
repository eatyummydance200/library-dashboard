import { useEffect, useRef, useState } from "react";
import { api, ApiError, message, setCsrf, useResource } from "./api";
import type { Issue, User } from "./types";
import logo from "../../static/inu-logo.png";
import {
  Action,
  Field,
  Form,
  Icon,
  Loading,
  Modal,
  NoticeContext,
  value,
} from "./ui";
import Dashboard from "./Dashboard";
import Schedule from "./Schedule";
import People from "./People";
import Issues from "./Issues";
import Archive from "./Archive";
import Tagging from "./Tagging";

const navigation = [
  ["dashboard", "대시보드", "grid"],
  ["schedule", "시간표", "calendar"],
  ["people", "인적관리", "people"],
  ["issues", "이슈", "message"],
  ["archive", "과월호", "archive"],
  ["tagging", "태깅", "tag"],
] as const;
type View = (typeof navigation)[number][0];
interface Session {
  user: User;
  csrf: string;
}
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function toast(text: string) {
    clearTimeout(timer.current);
    setNotice(text);
    timer.current = setTimeout(() => setNotice(""), 3500);
  }
  async function load() {
    setLoading(true);
    setError("");
    try {
      const session = await api<Session>("/me");
      setCsrf(session.csrf);
      setUser(session.user);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401))
        setError(message(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const expired = () => {
      setUser(null);
      toast("세션이 만료되었습니다. 다시 로그인해주세요.");
    };
    window.addEventListener("session-expired", expired);
    return () => {
      window.removeEventListener("session-expired", expired);
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("auth-page", !user);
  }, [user]);
  return (
    <NoticeContext.Provider value={toast}>
      {loading ? (
        <Loading retry={load} />
      ) : error ? (
        <Loading error={error} retry={load} />
      ) : user ? (
        <Workspace user={user} onLogout={() => setUser(null)} />
      ) : (
        <Login
          onLogin={(session) => {
            setCsrf(session.csrf);
            setUser(session.user);
          }}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </NoticeContext.Provider>
  );
}
function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <main className="auth-card">
      <img className="auth-logo" src={logo} alt="인천대학교 INU 워드마크" />
      <h1>근무 대시보드</h1>
      <p className="auth-description">
        인천대학교 연속간행물실
        <br />
        계정으로 로그인해주세요.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (lock.current) return;
          const data = new FormData(event.currentTarget);
          lock.current = true;
          setBusy(true);
          setError("");
          try {
            const token = await api<{ csrf: string }>("/auth/csrf");
            setCsrf(token.csrf);
            const session = await api<{ csrf: string }>("/auth/login", "POST", {
              username: value(data, "username"),
              password: value(data, "password"),
            });
            setCsrf(session.csrf);
            onLogin(await api<Session>("/me"));
          } catch (error) {
            setError(message(error));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            아이디
            <input
              name="username"
              required
              maxLength={32}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label>
            비밀번호
            <input
              name="password"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit">
            {busy ? "로그인 중…" : "로그인"}
          </button>
        </fieldset>
      </form>
    </main>
  );
}
function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<View>("dashboard");
  const [dialog, setDialog] = useState<"account" | "password" | null>(null);
  const issues = useResource<Issue[]>("/issues");
  useEffect(() => {
    document.body.dataset.page = view;
  }, [view]);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void issues.refresh();
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [issues.refresh]);
  const item = navigation.find((item) => item[0] === view)!;
  return (
    <div className="app">
      <aside className="sidebar" aria-label="주 메뉴">
        <div className="brand">
          <img
            src={logo}
            width={539}
            height={301}
            alt="인천대학교 INU 워드마크"
          />
        </div>
        <nav className="nav" aria-label="화면 이동">
          {navigation.map(([key, label, icon]) => (
            <button
              key={key}
              className={view === key ? "active" : ""}
              aria-current={view === key ? "page" : undefined}
              onClick={() => setView(key)}
            >
              <Icon name={icon} />
              {label}
              {key === "issues" && (
                <span className="count-badge">
                  {issues.data?.filter((issue) => !issue.done).length ?? "…"}
                </span>
              )}
            </button>
          ))}
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <Icon name="home" />
            <span>인천대학교 · 연속간행물실</span>
            <span>/</span>
            <strong>{item[1]}</strong>
          </div>
          <div className="top-actions">
            <button
              className="avatar account-avatar"
              aria-label="내 계정 메뉴"
              onClick={() => setDialog("account")}
            >
              {user.username.slice(0, 1)}
            </button>
          </div>
        </header>
        <section className="intro">
          <h1>{view === "dashboard" ? "근무 대시보드" : item[1]}</h1>
        </section>
        {view === "dashboard" && (
          <Dashboard
            user={user}
            issues={issues}
            showIssues={() => setView("issues")}
          />
        )}
        {view === "schedule" && (
          <Schedule user={user} onIssuesChange={issues.refresh} />
        )}
        {view === "people" && <People user={user} />}
        {view === "issues" && <Issues resource={issues} />}
        {view === "archive" && <Archive user={user} />}
        {view === "tagging" && <Tagging user={user} />}
      </main>
      {dialog === "account" && (
        <Modal title="내 계정" onClose={() => setDialog(null)}>
          <p className="hint">
            {user.username} · {user.role === "admin" ? "관리자" : "근무자"}
          </p>
          <div className="form-actions">
            <button className="btn" onClick={() => setDialog("password")}>
              비밀번호 변경
            </button>
            <Action
              className="btn primary"
              run={async () => {
                await api("/logout", "POST", {});
                onLogout();
              }}
            >
              로그아웃
            </Action>
          </div>
        </Modal>
      )}
      {dialog === "password" && (
        <Modal title="비밀번호 변경" onClose={() => setDialog(null)}>
          <Form
            onClose={() => setDialog(null)}
            onSave={async (data) => {
              if (value(data, "password") !== value(data, "confirm"))
                throw new Error("새 비밀번호가 일치하지 않습니다.");
              await api("/password", "POST", {
                current: value(data, "current"),
                password: value(data, "password"),
              });
              onLogout();
            }}
          >
            <Field label="현재 비밀번호">
              <input
                name="current"
                type="password"
                required
                maxLength={128}
                autoComplete="current-password"
              />
            </Field>
            <Field label="새 비밀번호 (10자 이상)">
              <input
                name="password"
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
              />
            </Field>
            <Field label="새 비밀번호 확인">
              <input
                name="confirm"
                type="password"
                required
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
              />
            </Field>
            <p className="hint">
              변경 후 모든 기기에서 다시 로그인해야 합니다.
            </p>
          </Form>
        </Modal>
      )}
    </div>
  );
}

import { useState } from "react";
import { api, base, useResource } from "./api";
import type { Account, Staff, Teacher, User } from "./types";
import {
  Action,
  Field,
  Form,
  Loading,
  Modal,
  ResourceError,
  numeric,
  useNotice,
  value,
} from "./ui";

type Editor =
  | { kind: "staff"; person?: Staff }
  | { kind: "teacher"; person?: Teacher }
  | { kind: "user" };
export default function People({ user }: { user: User }) {
  const staff = useResource<Staff[]>("/staff");
  const teachers = useResource<Teacher[]>("/teachers");
  const [editor, setEditor] = useState<Editor | null>(null);
  const admin = user.role === "admin";
  const notice = useNotice();
  return (
    <section className="view" aria-label="인적관리">
      <section className="card wide-card">
        <div className="card-head">
          <h2>
            근로{" "}
            <small>
              {staff.data?.filter((person) => person.active).length ?? "…"}명
            </small>
          </h2>
          {admin && (
            <button
              className="btn primary"
              onClick={() => setEditor({ kind: "staff" })}
            >
              근무자 추가
            </button>
          )}
        </div>
        {staff.data ? (
          <>
            <ResourceError error={staff.error} retry={staff.refresh} />
            <div className="table-inset">
              <table className="people-table">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>전화번호</th>
                    <th>소속</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.data.map((person, index) => (
                    <tr key={person.id}>
                      <td>
                        <div className="staff-name">
                          <span className={`avatar av-${index % 7}`}>
                            {person.name.slice(0, 1)}
                          </span>
                          {person.name}
                          {!person.active && <small>비활성</small>}
                        </div>
                      </td>
                      <td>{person.phone || "미등록"}</td>
                      <td>연속간행물실</td>
                      <td>
                        {admin ? (
                          <button
                            className="btn"
                            onClick={() => setEditor({ kind: "staff", person })}
                          >
                            수정
                          </button>
                        ) : (
                          "조회 전용"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Loading error={staff.error} retry={staff.refresh} />
        )}
      </section>
      <section className="card wide-card teachers-card">
        <div className="card-head">
          <h2>
            선생님 <small>{teachers.data?.length ?? "…"}명</small>
          </h2>
          {admin && (
            <button
              className="btn primary"
              onClick={() => setEditor({ kind: "teacher" })}
            >
              선생님 추가
            </button>
          )}
        </div>
        {teachers.data ? (
          <>
            <ResourceError error={teachers.error} retry={teachers.refresh} />
            <div className="table-inset">
              <table className="people-table teachers-table">
                <thead>
                  <tr>
                    {[
                      "이름",
                      "직급",
                      "내선번호",
                      "휴대폰 번호",
                      "근무 장소",
                      "관리",
                    ].map((title) => (
                      <th key={title}>{title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {teachers.data.map((person) => (
                    <tr key={person.id}>
                      <td>{person.name}</td>
                      <td>{person.position || "미등록"}</td>
                      <td>{person.extension || "미등록"}</td>
                      <td>{person.phone || "미등록"}</td>
                      <td>{person.location || "미등록"}</td>
                      <td>
                        {admin ? (
                          <button
                            className="btn"
                            onClick={() =>
                              setEditor({ kind: "teacher", person })
                            }
                          >
                            수정
                          </button>
                        ) : (
                          "조회 전용"
                        )}
                      </td>
                    </tr>
                  ))}
                  {!teachers.data.length && (
                    <tr>
                      <td colSpan={6}>등록된 선생님이 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Loading error={teachers.error} retry={teachers.refresh} />
        )}
      </section>
      {admin && staff.data && <Accounts user={user} staff={staff.data} />}
      <p className="people-note">
        근무자를 비활성화해도 과거 근무 기록은 보존됩니다.
      </p>
      {editor?.kind === "staff" && (
        <Modal
          title={editor.person ? "근무자 정보 수정" : "근무자 추가"}
          onClose={() => setEditor(null)}
        >
          <Form
            onClose={() => setEditor(null)}
            onSave={async (data) => {
              await api(
                editor.person ? `/staff/${editor.person.id}` : "/staff",
                editor.person ? "PUT" : "POST",
                {
                  name: value(data, "name").trim(),
                  phone: value(data, "phone").trim(),
                  active: value(data, "active") === "true",
                },
              );
              setEditor(null);
              await staff.refresh();
              notice("근무자 정보를 저장했어요.");
            }}
          >
            <Field label="이름">
              <input
                name="name"
                required
                maxLength={20}
                autoComplete="name"
                defaultValue={editor.person?.name ?? ""}
              />
            </Field>
            <Field label="전화번호">
              <input
                name="phone"
                type="tel"
                maxLength={20}
                pattern="[0-9+() -]{7,20}"
                autoComplete="tel"
                defaultValue={editor.person?.phone ?? ""}
              />
            </Field>
            <Field label="재직 상태">
              <select
                name="active"
                defaultValue={String(
                  editor.person ? !!editor.person.active : true,
                )}
              >
                <option value="true">재직</option>
                <option value="false">비활성</option>
              </select>
            </Field>
            <p className="hint">
              이름 변경은 시간표와 근무 통계에도 반영됩니다.
            </p>
          </Form>
        </Modal>
      )}
      {editor?.kind === "teacher" && (
        <Modal
          title={editor.person ? "선생님 정보 수정" : "선생님 추가"}
          onClose={() => setEditor(null)}
        >
          <Form
            onClose={() => setEditor(null)}
            onSave={async (data) => {
              await api(
                editor.person ? `/teachers/${editor.person.id}` : "/teachers",
                editor.person ? "PUT" : "POST",
                Object.fromEntries(
                  ["name", "position", "extension", "phone", "location"].map(
                    (key) => [key, value(data, key).trim()],
                  ),
                ),
              );
              setEditor(null);
              await teachers.refresh();
              notice("선생님 정보를 저장했어요.");
            }}
          >
            {(
              ["name", "position", "extension", "phone", "location"] as const
            ).map((key, i) => (
              <Field
                key={key}
                label={
                  ["이름", "직급", "내선번호", "휴대폰 번호", "근무 장소"][i]
                }
              >
                <input
                  name={key}
                  type={key === "phone" || key === "extension" ? "tel" : "text"}
                  required={key === "name"}
                  maxLength={
                    key === "location" ? 80 : key === "position" ? 40 : 20
                  }
                  pattern={
                    key === "extension"
                      ? "[0-9+() -]{1,20}"
                      : key === "phone"
                        ? "[0-9+() -]{7,20}"
                        : undefined
                  }
                  defaultValue={editor.person?.[key] ?? ""}
                />
              </Field>
            ))}
          </Form>
        </Modal>
      )}
    </section>
  );
}
function Accounts({ user, staff }: { user: User; staff: Staff[] }) {
  const accounts = useResource<Account[]>("/users");
  const [adding, setAdding] = useState(false);
  const notice = useNotice();
  return (
    <details className="card account-card">
      <summary>계정 관리</summary>
      <div className="card-head">
        <p className="hint">
          근무자 계정을 본인 이름에 연결하면 담당 과월호만 체크할 수 있습니다.
        </p>
        <button className="btn" onClick={() => setAdding(true)}>
          계정 추가
        </button>
      </div>
      <a className="btn" href={`${base}/api/backup`} download>
        DB 백업 다운로드
      </a>
      {accounts.data ? (
        <>
          <ResourceError error={accounts.error} retry={accounts.refresh} />
          {accounts.data.map((account) => (
            <div className="user-row" key={account.id}>
              <strong>{account.username}</strong>
              <span>
                {account.role === "admin" ? "관리자" : "근무자"} ·{" "}
                {account.active ? "사용 중" : "비활성"}
              </span>
              {account.role === "worker" && (
                <AccountLink
                  account={account}
                  staff={staff}
                  onSaved={accounts.refresh}
                />
              )}
              {account.id === user.id ? (
                <small>내 계정</small>
              ) : (
                <Action
                  run={async () => {
                    if (
                      !confirm(
                        `${account.username} 계정을 ${account.active ? "비활성화" : "활성화"}할까요?`,
                      )
                    )
                      return;
                    await api(`/users/${account.id}`, "PATCH", {
                      active: !account.active,
                    });
                    await accounts.refresh();
                    notice("계정 상태를 변경했어요.");
                  }}
                >
                  {account.active ? "비활성화" : "활성화"}
                </Action>
              )}
            </div>
          ))}
        </>
      ) : (
        <Loading error={accounts.error} retry={accounts.refresh} />
      )}
      {adding && (
        <Modal title="계정 추가" onClose={() => setAdding(false)}>
          <Form
            onClose={() => setAdding(false)}
            onSave={async (data) => {
              await api("/users", "POST", {
                username: value(data, "username"),
                password: value(data, "password"),
                role: value(data, "role"),
                staff_id: numeric(data, "staff_id") || null,
              });
              setAdding(false);
              await accounts.refresh();
              notice("계정을 추가했어요.");
            }}
          >
            <Field label="아이디">
              <input
                name="username"
                required
                pattern="[A-Za-z0-9_.-]{2,32}"
                maxLength={32}
                autoComplete="off"
              />
            </Field>
            <Field label="초기 비밀번호 (10자 이상)">
              <input
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="권한">
              <select name="role">
                <option value="worker">
                  근무자: 조회·이슈 작성·본인 과월호 체크
                </option>
                <option value="admin">관리자: 시간표·인적정보·계정 수정</option>
              </select>
            </Field>
            <Field label="연결 근무자">
              <select name="staff_id">
                <option value="">미연결</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {!person.active && " (비활성)"}
                  </option>
                ))}
              </select>
            </Field>
          </Form>
        </Modal>
      )}
    </details>
  );
}
function AccountLink({
  account,
  staff,
  onSaved,
}: {
  account: Account;
  staff: Staff[];
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const notice = useNotice();
  return (
    <label className="account-link">
      연결 근무자
      <select
        className="select"
        aria-label={`${account.username} 연결 근무자`}
        value={account.staff_id ?? ""}
        disabled={busy}
        onChange={async (event) => {
          const id = Number(event.target.value) || null;
          setBusy(true);
          try {
            await api(`/users/${account.id}`, "PATCH", { staff_id: id });
            await onSaved();
            notice(
              "근무자 연결을 저장했습니다. 해당 계정은 다시 로그인해주세요.",
            );
          } catch (error) {
            notice(
              error instanceof Error ? error.message : "저장하지 못했습니다.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="">미연결</option>
        {staff.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
            {!person.active && " (비활성)"}
          </option>
        ))}
      </select>
    </label>
  );
}

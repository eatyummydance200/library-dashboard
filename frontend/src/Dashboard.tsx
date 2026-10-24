import { useEffect, useState } from "react";
import { api, useResource } from "./api";
import type { Duty, Issue, Staff, Status, Teacher, User } from "./types";
import { dateTime, koreaParts } from "./dates";
import {
  Field,
  Form,
  Loading,
  Modal,
  ResourceError,
  numeric,
  useNotice,
} from "./ui";

export default function Dashboard({
  user,
  issues,
  showIssues,
}: {
  user: User;
  issues: ReturnType<typeof useResource<Issue[]>>;
  showIssues: () => void;
}) {
  const status = useResource<Status>("/status");
  const duty = useResource<Duty>("/duty");
  const staff = useResource<Staff[]>("/staff");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        void status.refresh();
        void duty.refresh();
      }
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [status.refresh, duty.refresh]);
  const open = issues.data?.filter((issue) => !issue.done) ?? [];
  const clock = status.data ? koreaParts(new Date(status.data.at)) : undefined;
  return (
    <section id="dashboard" className="view" aria-label="근무 대시보드">
      <div className="dashboard-duty-layout">
        <section className="card status-card">
          <div className="card-head">
            <h2>근무 현황</h2>
            <span id="shift-date">
              {clock &&
                `${Number(clock.month)}월 ${Number(clock.day)}일 ${clock.hour}:${clock.minute}`}
            </span>
          </div>
          {status.data && staff.data ? (
            <>
              <ResourceError
                error={status.error || staff.error}
                retry={() => {
                  void status.refresh();
                  void staff.refresh();
                }}
              />
              <div className="handoff">
                {(["previous", "current", "next"] as const).map(
                  (key, index) => (
                    <article
                      key={key}
                      className={`shift ${index === 1 ? "current" : ""}`}
                    >
                      <div className="shift-head">
                        <h3>
                          {index === 1 && <i className="dot" />}
                          {["이전 근무", "현재 근무", "다음 근무"][index]}
                        </h3>
                        <time>
                          {dateTime(
                            key === "current"
                              ? status.data!.at
                              : status.data![`${key}_at`],
                          )}
                        </time>
                      </div>
                      {(["desk", "general"] as const).map((role) => {
                        const entries = status.data![key].filter(
                          (shift) => shift.role === role,
                        );
                        return (
                          <div
                            key={role}
                            className={`duty-group ${role === "desk" ? "desk-duty" : "standby-duty"}`}
                          >
                            <h3>
                              {role === "desk" ? "데스크 담당" : "대기 근무"}
                            </h3>
                            <div className="duty-people">
                              {entries.length ? (
                                entries.map((shift) => (
                                  <span className="duty-person" key={shift.id}>
                                    {staff.data!.find(
                                      (person) => person.id === shift.staff_id,
                                    )?.name ?? "근무자"}
                                  </span>
                                ))
                              ) : (
                                <span className="unassigned">배정 없음</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </article>
                  ),
                )}
              </div>
            </>
          ) : (
            <Loading
              error={status.error || staff.error}
              retry={() => {
                void status.refresh();
                void staff.refresh();
              }}
            />
          )}
        </section>
        <section className="card duty-card">
          <div className="card-head">
            <h2>당직</h2>
            {user.role === "admin" && (
              <button className="btn" onClick={() => setEditing(true)}>
                수정
              </button>
            )}
          </div>
          {duty.data ? (
            <>
              <ResourceError error={duty.error} retry={duty.refresh} />
              <dl className="duty-contact">
                {[
                  ["담당쌤", duty.data.teacher],
                  ["내선번호", duty.data.extension],
                  ["휴대폰 번호", duty.data.phone],
                ].map(([label, text]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{text || "미등록"}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <Loading error={duty.error} retry={duty.refresh} />
          )}
        </section>
      </div>
      <section className="card issues-card">
        <div className="card-head">
          <h2>
            이슈 & 인계 <small>{open.length}</small>
          </h2>
          <button className="text-btn" onClick={showIssues}>
            전체 보기 ›
          </button>
        </div>
        {issues.data ? (
          <>
            <ResourceError error={issues.error} retry={issues.refresh} />
            <div className="issue-preview">
              {open.slice(0, 2).map((issue) => (
                <div key={issue.id}>
                  <span
                    className={`pill ${issue.category === "공지" ? "green" : ""}`}
                  >
                    {issue.category}
                  </span>
                  <small>{issue.day}</small>
                  <p>{issue.title}</p>
                </div>
              ))}
              {!open.length && <p>남아 있는 이슈가 없어요.</p>}
            </div>
          </>
        ) : (
          <Loading error={issues.error} retry={issues.refresh} />
        )}
      </section>
      {editing && (
        <DutyEditor onClose={() => setEditing(false)} onSaved={duty.refresh} />
      )}
    </section>
  );
}
function DutyEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const teachers = useResource<Teacher[]>("/teachers");
  const duty = useResource<Duty>("/duty");
  const notice = useNotice();
  return (
    <Modal title="당직 정보 수정" onClose={onClose}>
      {teachers.data && duty.data ? (
        <DutyForm
          teachers={teachers.data}
          duty={duty.data}
          onClose={onClose}
          onSave={async (id) => {
            await api("/duty", "PUT", { teacher_id: id });
            onClose();
            await onSaved();
            notice("당직 정보를 저장했어요.");
          }}
        />
      ) : (
        <Loading
          error={teachers.error || duty.error}
          retry={() => {
            void teachers.refresh();
            void duty.refresh();
          }}
        />
      )}
    </Modal>
  );
}
function DutyForm({
  teachers,
  duty,
  onClose,
  onSave,
}: {
  teachers: Teacher[];
  duty: Duty;
  onClose: () => void;
  onSave: (id: number | null) => Promise<void>;
}) {
  const [id, setId] = useState(duty.teacher_id || 0);
  const selected = teachers.find((teacher) => teacher.id === id);
  return (
    <Form
      onClose={onClose}
      onSave={(data) => onSave(numeric(data, "teacher_id") || null)}
    >
      <Field label="담당쌤">
        <select
          name="teacher_id"
          value={id}
          onChange={(event) => setId(Number(event.target.value))}
        >
          <option value={0}>미등록</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.name} · {teacher.location}
            </option>
          ))}
        </select>
      </Field>
      <Field label="내선번호">
        <input type="tel" value={selected?.extension ?? ""} readOnly />
      </Field>
      <Field label="휴대폰 번호">
        <input type="tel" value={selected?.phone ?? ""} readOnly />
      </Field>
      <p className="hint">
        연락처는 인적관리에서 가져옵니다. 당직은 한국 시간 기준 다음 날
        초기화됩니다.
      </p>
    </Form>
  );
}

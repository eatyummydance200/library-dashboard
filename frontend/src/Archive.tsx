import { useRef, useState } from "react";
import { api, message, useResource } from "./api";
import type { ArchiveData, Assignment, User } from "./types";
import { dateTime, today } from "./dates";
import {
  Action,
  Form,
  Loading,
  Modal,
  ResourceError,
  numeric,
  useNotice,
} from "./ui";

export default function Archive({ user }: { user: User }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const resource = useResource<ArchiveData>(`/archive?month=${month}`);
  const [editing, setEditing] = useState<ArchiveData | null>(null);
  const busy = useRef(new Set<number>());
  const [pending, setPending] = useState<number[]>([]);
  const notice = useNotice();
  const admin = user.role === "admin";
  function move(offset: number) {
    const [year, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(year, m - 1 + offset, 1))
      .toISOString()
      .slice(0, 7);
    if (next >= "2000-01" && next <= "2100-12") setMonth(next);
  }
  async function toggle(id: number, completed: boolean) {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    setPending([...busy.current]);
    try {
      await api(`/archive/tasks/${id}`, "PUT", { completed });
      resource.update((data) => ({
        ...data,
        assignments: data.assignments.map((assignment) => ({
          ...assignment,
          tasks: assignment.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  completed: Number(completed),
                  completed_at: completed ? new Date().toISOString() : null,
                  completed_by_name: completed ? user.username : null,
                }
              : task,
          ),
        })),
      }));
      notice(
        completed ? "과월호 완료를 저장했습니다." : "완료 표시를 해제했습니다.",
      );
    } catch (error) {
      notice(message(error));
    } finally {
      busy.current.delete(id);
      setPending([...busy.current]);
    }
  }
  const data = resource.data;
  const rows: Assignment[] = data
    ? data.draw
      ? data.assignments
      : data.groups.map((papers, i) => ({
          group_number: i + 1,
          staff_id: null,
          staff_name: "미정",
          tasks: papers.map((newspaper) => ({ newspaper, completed: 0 })),
        }))
    : [];
  const tasks = rows.flatMap((row) => row.tasks),
    done = tasks.filter((task) => task.completed).length;
  return (
    <section className="view" aria-label="과월호">
      <section className="card archive-panel">
        <div className="card-head">
          <h2 className="sr-only">월별 과월호</h2>
          <div className="archive-month-controls">
            <button
              className="icon-btn"
              aria-label="과월호 이전 달"
              onClick={() => move(-1)}
              disabled={month === "2000-01" || !!pending.length}
            >
              ‹
            </button>
            <input
              type="month"
              min="2000-01"
              max="2100-12"
              required
              aria-label="과월호 기준 월"
              value={month}
              disabled={!!pending.length}
              onChange={(event) => {
                if (event.target.value && event.target.checkValidity())
                  setMonth(event.target.value);
              }}
            />
            <button
              className="icon-btn"
              aria-label="과월호 다음 달"
              onClick={() => move(1)}
              disabled={month === "2100-12" || !!pending.length}
            >
              ›
            </button>
            <button
              className="btn"
              disabled={!!pending.length}
              onClick={() => setMonth(today().slice(0, 7))}
            >
              이번 달
            </button>
          </div>
        </div>
        {data ? (
          <>
            <ResourceError error={resource.error} retry={resource.refresh} />
            <div className="archive-summary">
              <div className="archive-progress">
                <strong>
                  {done}
                  <span> / {tasks.length} 완료</span>
                </strong>
                <progress
                  max={tasks.length || 1}
                  value={done}
                  aria-label={`${month} 과월호 진행률`}
                />
              </div>
              {admin && (
                <div className="archive-actions">
                  {!data.draw && (
                    <Action
                      disabled={data.participants.length !== 7}
                      run={async () => {
                        if (!confirm(`${month} 담당을 무작위 추첨할까요?`))
                          return;
                        await api("/archive/draw", "POST", { month });
                        await resource.refresh();
                        notice("담당 추첨 결과를 저장했습니다.");
                      }}
                    >
                      무작위 추첨
                    </Action>
                  )}
                  <button
                    className="btn primary"
                    disabled={
                      !!pending.length ||
                      (!data.draw && data.participants.length < 7)
                    }
                    onClick={() => setEditing(data)}
                  >
                    {data.draw ? "담당자 수정" : "수동 입력"}
                  </button>
                </div>
              )}
            </div>
            {!data.draw && data.participants.length !== 7 && admin && (
              <p className="archive-notice">
                추첨은 재직 7명일 때 가능합니다. 수동 입력은 7명을 선택해주세요.
              </p>
            )}
            {!admin && !user.staff_id && (
              <p className="archive-notice">
                본인 체크는 관리자에게 계정과 근무자 이름 연결을 요청해주세요.
              </p>
            )}
            <div className="table-inset">
              <table className="archive-table">
                <caption className="sr-only">
                  {month} 과월호 담당자와 신문사 완료 상태
                </caption>
                <thead>
                  <tr>
                    <th scope="col">번호</th>
                    <th scope="col">담당자</th>
                    <th scope="col">신문사 · 완료 체크</th>
                    <th scope="col">완료</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const mine = !!data.draw && user.staff_id === row.staff_id;
                    const editable = !!data.draw && (admin || mine);
                    const count = row.tasks.filter(
                      (task) => task.completed,
                    ).length;
                    return (
                      <tr
                        key={row.group_number}
                        className={`archive-group ${mine ? "my-archive" : ""} ${count === row.tasks.length ? "archive-complete" : ""}`}
                      >
                        <td>
                          <span className="archive-number">
                            {row.group_number}
                          </span>
                        </td>
                        <th scope="row" className="archive-owner">
                          {row.staff_name}
                          {mine && <small>내 담당</small>}
                        </th>
                        <td>
                          <div className="archive-papers">
                            {row.tasks.map((task) => {
                              const detail = task.completed
                                ? `${dateTime(task.completed_at)} · ${task.completed_by_name ?? ""}`
                                : data.draw
                                  ? "미완료"
                                  : "배정 전";
                              const saving =
                                task.id !== undefined &&
                                pending.includes(task.id);
                              return (
                                <label
                                  key={task.id ?? task.newspaper}
                                  className={`archive-task ${task.completed ? "is-complete" : ""}`}
                                  title={detail}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!task.completed}
                                    disabled={!editable}
                                    aria-busy={saving || undefined}
                                    aria-disabled={saving || undefined}
                                    aria-label={`${row.staff_name} ${task.newspaper} 과월호 완료 · ${detail}`}
                                    onChange={() => {
                                      if (task.id !== undefined)
                                        void toggle(task.id, !task.completed);
                                    }}
                                  />
                                  <span>{task.newspaper}</span>
                                </label>
                              );
                            })}
                          </div>
                        </td>
                        <td className="archive-group-count">
                          {count}/{row.tasks.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.draw && (
              <p className="archive-meta">
                최초 등록 {dateTime(data.draw.created_at)} ·{" "}
                {data.draw.created_by_name}
              </p>
            )}
          </>
        ) : (
          <Loading error={resource.error} retry={resource.refresh} />
        )}
      </section>
      {editing && (
        <ArchiveEditor
          data={editing}
          onClose={() => setEditing(null)}
          onSaved={resource.refresh}
        />
      )}
    </section>
  );
}
function ArchiveEditor({
  data,
  onClose,
  onSaved,
}: {
  data: ArchiveData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const notice = useNotice();
  const people = new Map(
    data.participants.map((person) => [person.id, person]),
  );
  for (const row of data.assignments)
    if (row.staff_id !== null && !people.has(row.staff_id))
      people.set(row.staff_id, {
        id: row.staff_id,
        name: `${row.staff_name} (비활성)`,
      });
  const expected = data.draw
    ? data.assignments.map((row) => row.staff_id)
    : null;
  return (
    <Modal title="과월호 담당자 입력" onClose={onClose}>
      <Form
        onClose={onClose}
        submit="담당자 저장"
        onSave={async (form) => {
          const ids = data.groups.map((_, i) => numeric(form, `person-${i}`));
          if (new Set(ids).size !== 7)
            throw new Error(
              "담당자가 중복되었습니다. 7명을 한 번씩 선택해주세요.",
            );
          await api("/archive/assignments", "PUT", {
            month: data.month,
            staff_ids: ids,
            expected,
          });
          onClose();
          await onSaved();
          notice("담당자를 저장했습니다. 완료 기록은 유지됩니다.");
        }}
      >
        <p className="hint">
          {data.month} · 담당자를 중복 없이 선택해주세요. 완료 기록은
          유지됩니다.
        </p>
        {data.groups.map((papers, i) => (
          <label key={i} className="archive-editor-row">
            <span className="archive-number">{i + 1}</span>
            <span>
              <strong>{papers.join(" · ")}</strong>
              <select
                name={`person-${i}`}
                required
                aria-label={`${i + 1}번 담당자`}
                defaultValue={expected?.[i] ?? ""}
              >
                <option value="">담당자 선택</option>
                {[...people.values()].map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        ))}
      </Form>
    </Modal>
  );
}

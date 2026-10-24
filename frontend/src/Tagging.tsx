import { useEffect, useRef, useState } from "react";
import { api, message, useResource } from "./api";
import type { TaggingData, User } from "./types";
import { koreaParts } from "./dates";
import { Loading, ResourceError, useNotice } from "./ui";

export default function Tagging({ user }: { user: User }) {
  const [clock, setClock] = useState(koreaParts());
  const currentYear = Number(clock.year),
    month = Number(clock.month);
  const [year, setYear] = useState(currentYear);
  const table = useResource<TaggingData>(`/tagging?year=${year}`);
  const current = useResource<TaggingData>(`/tagging?year=${currentYear}`);
  const summary = year === currentYear ? table : current;
  const busy = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  const notice = useNotice();
  useEffect(() => {
    const timer = setInterval(() => setClock(koreaParts()), 60000);
    return () => clearInterval(timer);
  }, []);
  async function toggle(person: number, month: number, completed: boolean) {
    const key = `${person}/${year}/${month}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    setPending([...busy.current]);
    try {
      await api(`/tagging/${key}`, "PUT", { completed });
      const change = (data: TaggingData): TaggingData => ({
        ...data,
        tags: [
          ...data.tags.filter(
            (tag) => tag.staff_id !== person || tag.month !== month,
          ),
          { staff_id: person, month, completed: Number(completed) },
        ],
      });
      table.update(change);
      if (year === currentYear) current.update(change);
      notice("태깅 상태를 저장했습니다.");
    } catch (error) {
      notice(message(error));
    } finally {
      busy.current.delete(key);
      setPending([...busy.current]);
    }
  }
  const active = summary.data?.staff.filter((person) => person.active) ?? [];
  const completed = new Set(
    summary.data?.tags
      .filter((tag) => tag.month === month && tag.completed)
      .map((tag) => tag.staff_id),
  );
  const done = active.filter((person) => completed.has(person.id)).length;
  const percent = active.length ? Math.round((done / active.length) * 100) : 0;
  return (
    <section id="tagging" className="view" aria-label="태깅">
      <section className="card tagging-status-card">
        <div className="card-head">
          <h2>이번 달 태깅 현황</h2>
          <span className="hint">
            {currentYear}년 {month}월 · 재직 근무자 기준
          </span>
        </div>
        {summary.data ? (
          <>
            <ResourceError error={summary.error} retry={summary.refresh} />
            <div id="tag-status" aria-live="polite">
              <div className="tag-status-summary">
                <strong>
                  {done}
                  <span> / {active.length}명 완료</span>
                </strong>
                <span>{percent}%</span>
              </div>
              <progress
                max={active.length || 1}
                value={done}
                aria-label="이번 달 태깅 진행률"
              >
                {percent}%
              </progress>
              <ul className="tag-status-people">
                {active.map((person) => (
                  <li
                    key={person.id}
                    className={completed.has(person.id) ? "is-complete" : ""}
                  >
                    <span>{person.name}</span>
                    <strong>
                      {completed.has(person.id) ? "완료" : "미완료"}
                    </strong>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <Loading error={summary.error} retry={summary.refresh} />
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2>월별 태깅</h2>
          <div className="week-controls">
            <button
              className="icon-btn"
              aria-label="이전 연도"
              disabled={year <= 2000 || !!pending.length}
              onClick={() => setYear(year - 1)}
            >
              ‹
            </button>
            <strong>{year}년</strong>
            <button
              className="icon-btn"
              aria-label="다음 연도"
              disabled={year >= 2100 || !!pending.length}
              onClick={() => setYear(year + 1)}
            >
              ›
            </button>
            <button
              className="btn"
              disabled={!!pending.length}
              onClick={() => setYear(currentYear)}
            >
              올해
            </button>
          </div>
        </div>
        <p className="tag-legend">
          ○ 완료 <span>— 미완료</span>
          <span>{user.role === "admin" ? "클릭하여 변경" : "조회 전용"}</span>
        </p>
        {table.data ? (
          <>
            <ResourceError error={table.error} retry={table.refresh} />
            <div className="tag-table table-inset">
              <table className="tagging-table">
                <caption className="sr-only">
                  {year}년 근무자별 월간 태깅 완료 여부
                </caption>
                <thead>
                  <tr>
                    <th scope="col">근무자</th>
                    {Array.from({ length: 12 }, (_, i) => (
                      <th
                        scope="col"
                        key={i}
                        className={
                          year === currentYear && i + 1 === month
                            ? "this-month"
                            : ""
                        }
                      >
                        {i + 1}월
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.data.staff.map((person) => (
                    <tr key={person.id}>
                      <th scope="row">
                        {person.name}
                        {!person.active && <small>비활성</small>}
                      </th>
                      {Array.from({ length: 12 }, (_, i) => {
                        const monthNumber = i + 1;
                        const completed = !!table.data!.tags.find(
                          (tag) =>
                            tag.staff_id === person.id &&
                            tag.month === monthNumber,
                        )?.completed;
                        const key = `${person.id}/${year}/${monthNumber}`;
                        const saving = pending.includes(key);
                        return (
                          <td
                            key={monthNumber}
                            className={
                              year === currentYear && monthNumber === month
                                ? "this-month"
                                : ""
                            }
                          >
                            <button
                              className="tag-mark"
                              disabled={user.role !== "admin"}
                              aria-disabled={saving || undefined}
                              aria-busy={saving || undefined}
                              aria-pressed={completed}
                              aria-label={`${person.name} ${year}년 ${monthNumber}월 ${completed ? "완료" : "미완료"}`}
                              onClick={() =>
                                void toggle(person.id, monthNumber, !completed)
                              }
                            >
                              {completed ? "○" : "—"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {!table.data.staff.length && (
                    <tr>
                      <td colSpan={13}>등록된 근무자가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Loading error={table.error} retry={table.refresh} />
        )}
      </section>
    </section>
  );
}

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api, useResource } from "./api";
import type { Issue, Shift, User, Week } from "./types";
import {
  addDays,
  days,
  koreaParts,
  minutes,
  monday,
  shortDay,
  time,
  today,
} from "./dates";
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
import { IssueEditor, IssueList } from "./Issues";

function layout(entries: Shift[]) {
  const result: (Shift & { lane: number })[] = [];
  let lanes = 0;
  for (const role of ["desk", "general"]) {
    const ends: number[] = [];
    for (const shift of entries
      .filter((shift) => shift.role === role)
      .sort((a, b) => a.start - b.start || a.end - b.end || a.id - b.id)) {
      let lane = ends.findIndex((end) => end <= shift.start);
      if (lane < 0) lane = ends.length;
      ends[lane] = shift.end;
      result.push({ ...shift, lane: lanes + lane });
    }
    lanes += Math.max(1, ends.length);
  }
  return { entries: result, lanes };
}
export default function Schedule({
  user,
  onIssuesChange,
}: {
  user: User;
  onIssuesChange: () => Promise<void>;
}) {
  const [week, setWeek] = useState(monday());
  const data = useResource<Week>(`/schedule?week=${week}`);
  const issues = useResource<Issue[]>(
    `/issues?category=${encodeURIComponent("근무 변경")}&week=${week}`,
  );
  const [clock, setClock] = useState(koreaParts());
  const [day, setDay] = useState(
    Math.min((new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7, 4),
  );
  const [person, setPerson] = useState("");
  const [filter, setFilter] = useState("open");
  const [addingIssue, setAddingIssue] = useState(false);
  const [editor, setEditor] = useState<{ shift?: Shift } | null>(null);
  const [copying, setCopying] = useState(false);
  const admin = user.role === "admin";
  const notice = useNotice();
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) {
        setClock(koreaParts());
        void data.refresh();
        void issues.refresh();
      }
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [data.refresh, issues.refresh]);
  const dates = days.map((_, index) => addDays(week, index));
  const todayKey = `${clock.year}-${clock.month}-${clock.day}`;
  const minute = Number(clock.hour) * 60 + Number(clock.minute);
  const slot =
    dates.includes(todayKey) && minute >= 540 && minute < 1320
      ? Math.floor((minute - 540) / 30)
      : -1;
  return (
    <section className="view standalone-schedule" aria-label="주간 시간표">
      <div>
        <div className="card schedule-only">
          <div className="card-head schedule-head">
            <h2>주간 근무 시간표</h2>
            <div className="week-controls">
              <button
                className="icon-btn"
                aria-label="이전 주"
                onClick={() => setWeek(addDays(week, -7))}
              >
                ‹
              </button>
              <strong>
                {shortDay(week)} – {shortDay(dates[4])}
              </strong>
              <button
                className="icon-btn"
                aria-label="다음 주"
                onClick={() => setWeek(addDays(week, 7))}
              >
                ›
              </button>
              <button
                className="btn"
                onClick={() => {
                  setWeek(monday());
                  setDay(
                    Math.min(
                      (new Date(`${today()}T00:00:00Z`).getUTCDay() + 6) % 7,
                      4,
                    ),
                  );
                }}
              >
                이번 주
              </button>
            </div>
          </div>
          <div className="schedule-tools">
            <div className="legend">
              <span className="desk-legend">
                <i />
                데스크
              </span>
              <span className="standby-legend">
                <i />
                대기
              </span>
            </div>
            <div className="schedule-filters">
              {admin && (
                <>
                  <button
                    className="btn"
                    disabled={!data.data}
                    onClick={() => setEditor({})}
                  >
                    ＋ 근무 추가
                  </button>
                  <button
                    className="btn"
                    disabled={!data.data}
                    onClick={() => setCopying(true)}
                  >
                    주 복사
                  </button>
                </>
              )}
              <select
                className="select"
                aria-label="시간표 근무자 선택"
                value={person}
                onChange={(event) => setPerson(event.target.value)}
              >
                <option value="">전체 근무자</option>
                {data.data?.staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div
            className="day-picker"
            role="group"
            aria-label="시간표 요일 선택"
          >
            {days.map((label, index) => (
              <button
                key={label}
                aria-pressed={day === index}
                onClick={() => setDay(index)}
              >
                {label}
                <small>{shortDay(dates[index])}</small>
              </button>
            ))}
          </div>
          {data.data ? (
            <>
              <ResourceError error={data.error} retry={data.refresh} />
              <div className="table-inset schedule-table">
                <div
                  className="week-board"
                  style={{ "--slot-count": 26 } as CSSProperties}
                  aria-label="30분 단위 주간 근무 시간표"
                >
                  <div className="time-axis">
                    <div className="day-heading">시간</div>
                    <div className="time-ticks">
                      {Array.from({ length: 26 }, (_, index) => (
                        <div
                          key={index}
                          className={`time-tick ${index === slot ? "current-row" : ""} ${index % 2 ? "half-hour" : ""}`}
                          aria-current={index === slot ? "time" : undefined}
                        >
                          {time(540 + index * 30)}
                        </div>
                      ))}
                      <span className="time-end">22:00</span>
                    </div>
                  </div>
                  {dates.map((date, index) => {
                    const placed = layout(
                      data.data!.shifts.filter((shift) => shift.day === date),
                    );
                    return (
                      <section
                        key={date}
                        className={`day-track ${index === day ? "selected-day" : ""} ${date === todayKey ? "today-col" : ""}`}
                        aria-label={`${date} ${days[index]}요일`}
                      >
                        <h3 className="day-heading">
                          {days[index]}
                          <span>
                            {shortDay(date)}
                            {date === todayKey && " · 오늘"}
                          </span>
                        </h3>
                        <div
                          className="track-grid"
                          style={{ "--lanes": placed.lanes } as CSSProperties}
                        >
                          {placed.entries.map((shift) => {
                            const name =
                              data.data!.staff.find(
                                (person) => person.id === shift.staff_id,
                              )?.name ?? "근무자";
                            const span = (shift.end - shift.start) / 30;
                            const label = `${name} · ${time(shift.start)}–${time(shift.end)} · ${shift.role === "desk" ? "데스크" : "대기"}`;
                            return (
                              <button
                                key={shift.id}
                                type="button"
                                className={`worker ${shift.role === "desk" ? "desk" : "standby"} ${span === 1 ? "short-shift" : ""} ${person && person !== String(shift.staff_id) ? "dimmed" : ""}`}
                                style={{
                                  gridRow: `${(shift.start - 540) / 30 + 1}/span ${span}`,
                                  gridColumn: shift.lane + 1,
                                }}
                                title={label}
                                aria-label={label}
                                onClick={() => {
                                  if (admin) setEditor({ shift });
                                }}
                              >
                                <strong>{name}</strong>
                              </button>
                            );
                          })}
                          {!placed.entries.length && (
                            <span className="empty-day">배정 없음</span>
                          )}
                          {date === todayKey && slot >= 0 && (
                            <>
                              <div
                                className="current-band"
                                style={{ top: `${(slot / 26) * 100}%` }}
                              />
                              <span
                                className="now-line"
                                style={{
                                  top: `${((minute - 540) / 780) * 100}%`,
                                }}
                              >
                                <span>
                                  현재 {clock.hour}:{clock.minute}
                                </span>
                              </span>
                            </>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <Loading error={data.error} retry={data.refresh} />
          )}
        </div>
      </div>
      <aside className="schedule-sidebar">
        <section className="card stats-card">
          <div className="card-head">
            <h2>
              주당 근무 시간{" "}
              <small>
                {data.data?.staff.filter((person) => person.active).length ??
                  "…"}
                명
              </small>
            </h2>
          </div>
          {data.data && <Stats week={data.data} />}
          <p className="stat-note">
            시간 단위: h · 실제 근무 구간에서 자동 계산
          </p>
        </section>
        <section className="card shift-issues-card" aria-label="근무 변경 이슈">
          <div className="card-head">
            <h2>근무 변경 이슈</h2>
            <button className="btn" onClick={() => setAddingIssue(true)}>
              등록
            </button>
          </div>
          <div className="shift-issue-tools">
            <select
              className="select"
              aria-label="근무 변경 이슈 상태"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="open">진행 중</option>
              <option value="done">완료</option>
              <option value="all">전체</option>
            </select>
            <span className="hint">
              {shortDay(week)}–{shortDay(dates[4])}
            </span>
          </div>
          <IssueList
            resource={issues}
            filter={filter}
            compact
            onChanged={onIssuesChange}
          />
        </section>
      </aside>
      {editor && data.data && (
        <ShiftEditor
          key={editor.shift?.id ?? "new"}
          week={data.data}
          shift={editor.shift}
          onClose={() => setEditor(null)}
          onSaved={data.refresh}
        />
      )}
      {copying && (
        <Modal title="다른 주에서 복사" onClose={() => setCopying(false)}>
          <Form
            onClose={() => setCopying(false)}
            onSave={async (form) => {
              const result = await api<{ count: number }>(
                "/schedule/copy",
                "POST",
                {
                  source: value(form, "source"),
                  target: value(form, "target"),
                },
              );
              setCopying(false);
              await data.refresh();
              notice(`${result.count}개 근무를 복사했어요.`);
            }}
          >
            <Field label="원본 주에 속한 날짜">
              <input
                name="source"
                type="date"
                required
                defaultValue={addDays(week, -7)}
              />
            </Field>
            <Field label="대상 주에 속한 날짜">
              <input name="target" type="date" required defaultValue={week} />
            </Field>
            <p className="hint">대상 주에 근무가 있으면 복사하지 않습니다.</p>
          </Form>
        </Modal>
      )}
      {addingIssue && (
        <IssueEditor
          day={today() >= week && today() <= dates[4] ? today() : week}
          category="근무 변경"
          onClose={() => setAddingIssue(false)}
          onSaved={async () => {
            await issues.refresh();
            await onIssuesChange();
          }}
        />
      )}
    </section>
  );
}
function Stats({ week }: { week: Week }) {
  const closing = new Map<string, number>();
  for (const shift of week.shifts)
    closing.set(shift.day, Math.max(closing.get(shift.day) ?? 1260, shift.end));
  return (
    <div className="table-inset">
      <div className="stats-columns">
        <span>근무자</span>
        <span>총 시간</span>
        <span className="blue">데스크 시간</span>
        <span>오픈</span>
        <span>마감</span>
      </div>
      <div className="stats-rows">
        {week.staff.map((person) => {
          const shifts = week.shifts.filter(
            (shift) => shift.staff_id === person.id,
          );
          const total = shifts.reduce(
            (sum, shift) => sum + (shift.end - shift.start) / 60,
            0,
          );
          const desk = shifts
            .filter((shift) => shift.role === "desk")
            .reduce((sum, shift) => sum + (shift.end - shift.start) / 60, 0);
          return (
            <div className="staff-row" key={person.id}>
              <div className="staff-name">{person.name}</div>
              <span>
                {total}
                <small>h</small>
              </span>
              <span className="blue">
                {desk}
                <small>h</small>
              </span>
              <span>
                {
                  new Set(
                    shifts
                      .filter((shift) => shift.start === 540)
                      .map((shift) => shift.day),
                  ).size
                }
                <small>회</small>
              </span>
              <span>
                {
                  new Set(
                    shifts
                      .filter((shift) => shift.end === closing.get(shift.day))
                      .map((shift) => shift.day),
                  ).size
                }
                <small>회</small>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function ShiftEditor({
  week,
  shift,
  onClose,
  onSaved,
}: {
  week: Week;
  shift?: Shift;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const notice = useNotice();
  return (
    <Modal title={shift ? "근무 수정" : "근무 추가"} onClose={onClose}>
      <Form
        onClose={onClose}
        onSave={async (form) => {
          await api(
            shift ? `/shifts/${shift.id}` : "/shifts",
            shift ? "PUT" : "POST",
            {
              staff_id: numeric(form, "staff_id"),
              day: value(form, "day"),
              start: minutes(value(form, "start")),
              end: minutes(value(form, "end")),
              role: value(form, "role"),
            },
          );
          onClose();
          await onSaved();
          notice("근무를 저장했어요.");
        }}
      >
        <Field label="날짜">
          <input
            name="day"
            type="date"
            required
            defaultValue={shift?.day ?? week.week}
          />
        </Field>
        <Field label="근무자">
          <select name="staff_id" required defaultValue={shift?.staff_id}>
            {week.staff
              .filter(
                (person) => person.active || person.id === shift?.staff_id,
              )
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {!person.active && " (비활성)"}
                </option>
              ))}
          </select>
        </Field>
        <Field label="구분">
          <select name="role" defaultValue={shift?.role ?? "desk"}>
            <option value="desk">데스크</option>
            <option value="general">대기 근무</option>
          </select>
        </Field>
        <Field label="시작 시각">
          <input
            name="start"
            type="time"
            min="09:00"
            max="21:30"
            step={1800}
            required
            defaultValue={time(shift?.start ?? 540)}
          />
        </Field>
        <Field label="종료 시각">
          <input
            name="end"
            type="time"
            min="09:30"
            max="22:00"
            step={1800}
            required
            defaultValue={time(shift?.end ?? 600)}
          />
        </Field>
        {shift && (
          <Action
            className="btn danger"
            run={async () => {
              if (!confirm("이 근무를 삭제할까요?")) return;
              await api(`/shifts/${shift.id}`, "DELETE");
              onClose();
              await onSaved();
              notice("근무를 삭제했어요.");
            }}
          >
            삭제
          </Action>
        )}
      </Form>
    </Modal>
  );
}

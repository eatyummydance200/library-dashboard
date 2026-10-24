import { useState } from "react";
import { api, useResource } from "./api";
import type { Issue } from "./types";
import { today, dateTime } from "./dates";
import {
  Action,
  Field,
  Form,
  Loading,
  Modal,
  ResourceError,
  useNotice,
  value,
} from "./ui";

type IssuesResource = ReturnType<typeof useResource<Issue[]>>;
export default function Issues({ resource }: { resource: IssuesResource }) {
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  return (
    <section className="view" aria-label="이슈와 인계 사항">
      <section className="card wide-card">
        <div className="card-head">
          <h2>이슈 & 인계 사항</h2>
          <button className="btn primary" onClick={() => setAdding(true)}>
            ＋ 새 이슈
          </button>
        </div>
        <div style={{ padding: "0 22px 4px" }}>
          <select
            className="select"
            aria-label="이슈 상태 필터"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">전체 이슈</option>
            <option value="open">진행 중</option>
            <option value="done">완료</option>
          </select>
          <span className="hint"> 최근 200건 · 서버에 저장됩니다.</span>
        </div>
        <IssueList resource={resource} filter={filter} />
      </section>
      {adding && (
        <IssueEditor
          onClose={() => setAdding(false)}
          onSaved={resource.refresh}
        />
      )}
    </section>
  );
}
export function IssueList({
  resource,
  filter,
  compact = false,
  onChanged,
}: {
  resource: IssuesResource;
  filter: string;
  compact?: boolean;
  onChanged?: () => Promise<void>;
}) {
  if (!resource.data)
    return <Loading error={resource.error} retry={resource.refresh} />;
  const visible = resource.data.filter(
    (issue) => filter === "all" || (filter === "done") === !!issue.done,
  );
  return (
    <>
      <ResourceError error={resource.error} retry={resource.refresh} />
      <div className={compact ? "" : "issue-list"}>
        {visible.map((issue) => (
          <article
            key={issue.id}
            className={`${compact ? "shift-issue-entry" : "issue-entry"} ${issue.done ? "done" : ""}`}
          >
            {!compact && (
              <span className="avatar">{issue.author.slice(0, 1)}</span>
            )}
            <div className="issue-body">
              {!compact && (
                <span
                  className={`pill ${issue.category === "공지" ? "green" : ""}`}
                >
                  {issue.category}
                </span>
              )}
              <span className="hint">
                {issue.done ? "완료" : "진행 중"} · {issue.day}
              </span>
              <h3>{issue.title}</h3>
              <p>{issue.body}</p>
              <small>
                {issue.author}
                {!compact && ` · ${dateTime(issue.created_at)}`}
              </small>
            </div>
            <Action
              className={compact ? "text-btn" : "btn"}
              run={async () => {
                await api(`/issues/${issue.id}`, "PATCH", {
                  done: !issue.done,
                });
                await resource.refresh();
                await onChanged?.();
              }}
            >
              {issue.done ? "다시 열기" : "완료하기"}
            </Action>
          </article>
        ))}
        {!visible.length && (
          <p className="shift-issue-empty">해당하는 이슈가 없습니다.</p>
        )}
      </div>
    </>
  );
}
export function IssueEditor({
  onClose,
  onSaved,
  day = today(),
  category = "인계",
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
  day?: string;
  category?: string;
}) {
  const notice = useNotice();
  return (
    <Modal title="새 이슈 남기기" onClose={onClose}>
      <Form
        onClose={onClose}
        submit="등록하기"
        onSave={async (data) => {
          await api(
            "/issues",
            "POST",
            Object.fromEntries(
              ["day", "category", "title", "body"].map((key) => [
                key,
                value(data, key),
              ]),
            ),
          );
          onClose();
          await onSaved();
          notice("이슈를 등록했어요.");
        }}
      >
        <Field label="해당 날짜">
          <input name="day" type="date" required defaultValue={day} />
        </Field>
        <Field label="구분">
          <select name="category" defaultValue={category}>
            {["인계", "공지", "시설", "근무 변경"].map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </Field>
        <Field label="제목">
          <input name="title" required maxLength={80} />
        </Field>
        <Field label="내용">
          <textarea name="body" required maxLength={1500} />
        </Field>
        <p className="hint">등록한 내용은 다른 근무자와 공유됩니다.</p>
      </Form>
    </Modal>
  );
}

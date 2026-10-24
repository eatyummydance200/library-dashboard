export const days = ["월", "화", "수", "목", "금"];
export function koreaParts(date = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
}
export function today() {
  const p = koreaParts();
  return `${p.year}-${p.month}-${p.day}`;
}
export function addDays(value: string, count: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function monday(value = today()) {
  return addDays(
    value,
    -((new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7),
  );
}
export function shortDay(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}.${day}`;
}
export function time(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export function minutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
export function dateTime(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(value))
    : "예정 없음";
}

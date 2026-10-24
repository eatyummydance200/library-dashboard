export interface Staff {
  id: number;
  name: string;
  phone: string;
  active: number;
}
export interface Teacher {
  id: number;
  name: string;
  extension: string;
  phone: string;
  position: string;
  location: string;
}
export interface User {
  id: number;
  username: string;
  role: "admin" | "worker";
  staff_id: number | null;
}
export interface Account extends User {
  active: number;
}
export interface Shift {
  id: number;
  staff_id: number;
  day: string;
  start: number;
  end: number;
  role: "desk" | "general";
}
export interface Week {
  week: string;
  staff: Staff[];
  shifts: Shift[];
}
export interface Duty {
  teacher_id: number;
  teacher: string;
  extension: string;
  phone: string;
}
export interface Status {
  at: string;
  previous: Shift[];
  current: Shift[];
  next: Shift[];
  previous_at: string | null;
  next_at: string | null;
}
export interface Issue {
  id: number;
  day: string;
  category: string;
  title: string;
  body: string;
  author: string;
  done: number;
  created_at: string;
}
export interface TaggingData {
  year: number;
  staff: Staff[];
  tags: { staff_id: number; month: number; completed: number }[];
}
export interface ArchiveTask {
  id?: number;
  newspaper: string;
  completed: number;
  completed_at?: string | null;
  completed_by_name?: string | null;
}
export interface Assignment {
  group_number: number;
  staff_id: number | null;
  staff_name: string;
  tasks: ArchiveTask[];
}
export interface ArchiveData {
  month: string;
  draw: null | { created_at: string; created_by_name: string };
  assignments: Assignment[];
  groups: string[][];
  participants: { id: number; name: string }[];
}

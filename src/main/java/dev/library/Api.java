package dev.library;

import static dev.library.Db.*;

import jakarta.servlet.http.*;
import java.sql.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestController
class Api {
  final Db db;

  Api(Db db) {
    this.db = db;
  }

  static class Failure extends RuntimeException {
    final int status;

    Failure(int status, String message) {
      super(message);
      this.status = status;
    }
  }

  static void fail(String message) {
    throw new Failure(400, message);
  }

  static int number(Object value) {
    return ((Number) value).intValue();
  }

  static boolean integer(Object v) {
    return v instanceof Integer || v instanceof Long;
  }

  static String text(Object value, String label, int maximum, boolean required) {
    if (!(value instanceof String)) throw new Failure(400, label + "을(를) 확인해주세요.");
    String s = ((String) value).strip();
    if (s.length() > maximum || required && s.isEmpty()) fail(label + "을(를) 확인해주세요.");
    return s;
  }

  static String password(Object v) {
    if (!(v instanceof String s) || s.isEmpty() || s.length() > 128)
      throw new Failure(400, "비밀번호를 확인해주세요.");
    return (String) v;
  }

  static LocalDate day(Object v) {
    try {
      if (!(v instanceof String s) || !s.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))
        throw new IllegalArgumentException();
      LocalDate d = LocalDate.parse((String) v);
      if (d.getYear() < 1) throw new IllegalArgumentException();
      return d;
    } catch (Exception e) {
      throw new Failure(400, "날짜를 확인해주세요.");
    }
  }

  static LocalDate monday(String value) {
    LocalDate d = day(value);
    return d.minusDays(d.getDayOfWeek().getValue() - 1);
  }

  static String today() {
    return LocalDate.now(Application.KOREA).toString();
  }

  static String stamp() {
    return Instant.now().toString();
  }

  @SuppressWarnings("unchecked")
  static Map<String, Object> user(HttpServletRequest r) {
    return (Map<String, Object>) r.getAttribute("user");
  }

  static void admin(HttpServletRequest r) {
    if (!"admin".equals(user(r).get("role"))) throw new Failure(403, "관리자 권한이 필요합니다.");
  }

  static Map<String, Object> ok() {
    return Map.of("ok", true);
  }

  static List<Map<String, Object>> shifts(Connection c, LocalDate start, LocalDate end)
      throws SQLException {
    return rows(
        c,
        "SELECT * FROM shifts WHERE day>=? AND day<? ORDER BY day,start,id",
        start.toString(),
        end.toString());
  }

  @GetMapping("/healthz")
  Object health() {
    return db.read(
        c -> {
          one(c, "SELECT 1");
          return Map.of("status", "ok");
        });
  }

  @GetMapping("/api/me")
  Object me(HttpServletRequest r) {
    var out = new LinkedHashMap<String, Object>();
    for (String k : List.of("id", "username", "role", "staff_id")) out.put(k, user(r).get(k));
    return Map.of("user", out, "csrf", AuthFilter.csrf(r));
  }

  @PostMapping("/api/logout")
  Object logout(HttpServletRequest r) {
    r.getSession().invalidate();
    return ok();
  }

  @GetMapping("/api/staff")
  Object staff() {
    return db.read(c -> rows(c, "SELECT * FROM staff ORDER BY id"));
  }

  static String[] person(Map<String, Object> d) {
    String name = text(d.get("name"), "이름", 20, true),
        phone = text(d.getOrDefault("phone", ""), "전화번호", 20, false);
    if (!phone.isEmpty() && !phone.matches("[0-9+() -]{7,20}")) fail("전화번호 형식을 확인해주세요.");
    return new String[] {name, phone};
  }

  @PostMapping("/api/staff")
  ResponseEntity<?> addStaff(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    var p = person(d);
    db.write(
        c -> {
          update(c, "INSERT INTO staff(name,phone) VALUES (?,?)", p[0], p[1]);
          return null;
        });
    return ResponseEntity.status(201).body(ok());
  }

  @PutMapping("/api/staff/{id}")
  Object saveStaff(@PathVariable int id, @RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    var p = person(d);
    Object active = d.getOrDefault("active", true);
    if (!(active instanceof Boolean)) fail("재직 상태를 확인해주세요.");
    return db.write(
        c -> {
          if (update(
                  c, "UPDATE staff SET name=?,phone=?,active=? WHERE id=?", p[0], p[1], active, id)
              == 0) throw new Failure(404, "근무자를 찾을 수 없습니다.");
          return ok();
        });
  }

  @GetMapping("/api/duty")
  Object duty() {
    return db.read(
        c -> {
          var row = one(c, "SELECT teacher,extension FROM duty_contact WHERE id=1");
          return row == null ? Map.of("teacher", "", "extension", "") : row;
        });
  }

  @PutMapping("/api/duty")
  Object saveDuty(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    String teacher = text(d.get("teacher"), "담당쌤", 40, false),
        extension = text(d.get("extension"), "내선번호", 20, false);
    if (!extension.isEmpty() && !extension.matches("[0-9+() -]{1,20}")) fail("내선번호 형식을 확인해주세요.");
    return db.write(
        c -> {
          update(
              c,
              "INSERT INTO duty_contact(id,teacher,extension) VALUES(1,?,?) ON CONFLICT(id) DO"
                  + " UPDATE SET teacher=excluded.teacher,extension=excluded.extension",
              teacher,
              extension);
          return Map.of("teacher", teacher, "extension", extension);
        });
  }

  @GetMapping("/api/schedule")
  Object schedule(@RequestParam(required = false) String week) {
    LocalDate start = monday(week == null ? today() : week);
    return db.read(
        c ->
            Map.of(
                "week",
                start.toString(),
                "staff",
                rows(c, "SELECT * FROM staff ORDER BY id"),
                "shifts",
                shifts(c, start, start.plusDays(7))));
  }

  static Object[] shift(Connection c, Map<String, Object> d, int exclude) throws SQLException {
    LocalDate day = day(d.get("day"));
    Object id = d.get("staff_id"), start = d.get("start"), end = d.get("end"), role = d.get("role");
    if (day.getDayOfWeek().getValue() > 5 || !integer(id) || !integer(start) || !integer(end))
      fail("평일 날짜와 근무자·시간을 확인해주세요.");
    long s = ((Number) start).longValue(), e = ((Number) end).longValue();
    if (s < 540
        || e > 1320
        || s >= e
        || s % 30 != 0
        || e % 30 != 0
        || role == null
        || !List.of("desk", "general").contains(role)) fail("근무 시간은 09:00~22:00 사이의 30분 단위입니다.");
    if (one(c, "SELECT id FROM staff WHERE id=? AND active=1", id) == null)
      fail("재직 중인 근무자를 선택해주세요.");
    if (one(
            c,
            "SELECT id FROM shifts WHERE day=? AND staff_id=? AND start<? AND end>? AND id<>?",
            day.toString(),
            id,
            end,
            start,
            exclude)
        != null) throw new Failure(409, "같은 사람의 근무 시간이 겹칩니다.");
    return new Object[] {id, day.toString(), start, end, role};
  }

  @PostMapping("/api/shifts")
  ResponseEntity<?> addShift(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    db.write(
        c -> {
          update(
              c,
              "INSERT INTO shifts(staff_id,day,start,end,role) VALUES (?,?,?,?,?)",
              shift(c, d, 0));
          return null;
        });
    return ResponseEntity.status(201).body(ok());
  }

  @PutMapping("/api/shifts/{id}")
  Object saveShift(@PathVariable int id, @RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    return db.write(
        c -> {
          if (one(c, "SELECT id FROM shifts WHERE id=?", id) == null)
            throw new Failure(404, "근무를 찾을 수 없습니다.");
          var a = new ArrayList<>(Arrays.asList(shift(c, d, id)));
          a.add(id);
          update(
              c, "UPDATE shifts SET staff_id=?,day=?,start=?,end=?,role=? WHERE id=?", a.toArray());
          return ok();
        });
  }

  @DeleteMapping("/api/shifts/{id}")
  Object deleteShift(@PathVariable int id, HttpServletRequest r) {
    admin(r);
    return db.write(
        c -> {
          update(c, "DELETE FROM shifts WHERE id=?", id);
          return ok();
        });
  }

  @PostMapping("/api/schedule/copy")
  Object copy(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    LocalDate source = monday(text(d.get("source"), "날짜", 10, true)),
        target = monday(text(d.get("target"), "날짜", 10, true));
    return db.write(
        c -> {
          if (!shifts(c, target, target.plusDays(7)).isEmpty())
            throw new Failure(409, "대상 주에 이미 시간표가 있습니다. 기존 근무는 덮어쓰지 않습니다.");
          var entries = shifts(c, source, source.plusDays(7));
          if (entries.isEmpty()) fail("복사할 근무가 없습니다.");
          for (var e : entries) {
            if (one(c, "SELECT id FROM staff WHERE id=? AND active=1", e.get("staff_id")) == null)
              fail("원본 주에 퇴직한 근무자가 포함되어 있습니다. 근무자를 확인해주세요.");
            update(
                c,
                "INSERT INTO shifts(staff_id,day,start,end,role) VALUES (?,?,?,?,?)",
                e.get("staff_id"),
                day(e.get("day"))
                    .plusDays(java.time.temporal.ChronoUnit.DAYS.between(source, target))
                    .toString(),
                e.get("start"),
                e.get("end"),
                e.get("role"));
          }
          return Map.of("ok", true, "count", entries.size());
        });
  }

  static List<Map<String, Object>> active(List<Map<String, Object>> entries, ZonedDateTime at) {
    if (at == null) return List.of();
    return entries.stream()
        .filter(
            e -> {
              var start = day(e.get("day")).atStartOfDay(Application.KOREA);
              return !at.isBefore(start.plusMinutes(number(e.get("start"))))
                  && at.isBefore(start.plusMinutes(number(e.get("end"))));
            })
        .toList();
  }

  @GetMapping("/api/status")
  Object status(@RequestParam(required = false) String at) {
    ZonedDateTime now;
    try {
      now =
          at == null
              ? ZonedDateTime.now(Application.KOREA)
              : ZonedDateTime.parse(at).withZoneSameInstant(Application.KOREA);
    } catch (Exception e) {
      try {
        now = LocalDateTime.parse(at).atZone(Application.KOREA);
      } catch (Exception bad) {
        throw new Failure(400, "기준 시각을 확인해주세요.");
      }
    }
    final var moment = now;
    return db.read(
        c -> {
          var entries =
              shifts(c, moment.toLocalDate().minusDays(7), moment.toLocalDate().plusDays(8));
          var boundaries = new TreeSet<ZonedDateTime>();
          for (var e : entries) {
            var start = day(e.get("day")).atStartOfDay(Application.KOREA);
            boundaries.add(start.plusMinutes(number(e.get("start"))));
            boundaries.add(start.plusMinutes(number(e.get("end"))));
          }
          var prev = boundaries.floor(moment);
          var next = boundaries.higher(moment);
          var previousAt = prev == null ? null : prev.minusNanos(1000);
          var current = active(entries, moment);
          if (current.isEmpty() && previousAt != null && active(entries, previousAt).isEmpty()) {
            previousAt = null;
            for (var e : entries) {
              var end =
                  day(e.get("day"))
                      .atStartOfDay(Application.KOREA)
                      .plusMinutes(number(e.get("end")));
              if (!end.isAfter(moment) && (previousAt == null || end.isAfter(previousAt)))
                previousAt = end.minusNanos(1000);
            }
          }
          var out = new LinkedHashMap<String, Object>();
          out.put("at", moment.toOffsetDateTime().toString());
          out.put("previous", active(entries, previousAt));
          out.put("current", current);
          out.put("next", active(entries, next));
          out.put("previous_at", prev == null ? null : prev.toOffsetDateTime().toString());
          out.put("next_at", next == null ? null : next.toOffsetDateTime().toString());
          return out;
        });
  }

  static void period(int year, int month) {
    if (year < 2000 || year > 2100 || month < 1 || month > 12) fail("연도와 월을 확인해주세요.");
  }

  @GetMapping("/api/tagging")
  Object tagging(@RequestParam(required = false) String year) {
    if (year == null) year = "" + LocalDate.now(Application.KOREA).getYear();
    if (!year.matches("[0-9]{4}")) fail("연도를 확인해주세요.");
    int y = Integer.parseInt(year);
    period(y, 1);
    return db.read(
        c ->
            Map.of(
                "year",
                y,
                "staff",
                rows(
                    c,
                    "SELECT id,name,active FROM staff WHERE active=1 OR id IN (SELECT staff_id FROM"
                        + " monthly_tags WHERE year=?) ORDER BY id",
                    y),
                "tags",
                rows(c, "SELECT staff_id,month,completed FROM monthly_tags WHERE year=?", y)));
  }

  @PutMapping("/api/tagging/{id}/{year}/{month}")
  Object saveTag(
      @PathVariable int id,
      @PathVariable int year,
      @PathVariable int month,
      @RequestBody Map<String, Object> d,
      HttpServletRequest r) {
    admin(r);
    period(year, month);
    boolean done = bool(d.get("completed"), "태깅 완료 여부를 확인해주세요.");
    return db.write(
        c -> {
          if (one(c, "SELECT id FROM staff WHERE id=?", id) == null)
            throw new Failure(404, "근무자를 찾을 수 없습니다.");
          update(
              c,
              "INSERT INTO monthly_tags(staff_id,year,month,completed,updated_by,updated_at)"
                  + " VALUES(?,?,?,?,?,?) ON CONFLICT(staff_id,year,month) DO UPDATE SET"
                  + " completed=excluded.completed,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
              id,
              year,
              month,
              done,
              user(r).get("id"),
              stamp());
          return ok();
        });
  }

  static boolean bool(Object v, String error) {
    if (!(v instanceof Boolean)) fail(error);
    return (Boolean) v;
  }

  static final List<List<String>> GROUPS =
      List.of(
          List.of("중앙", "코헤", "FT"),
          List.of("국민", "경기", "경인"),
          List.of("동아", "아사히", "인민"),
          List.of("조선", "코탐"),
          List.of("매일경제", "전자", "요미"),
          List.of("한국경제", "인천", "경향"),
          List.of("한국일보", "한겨레", "뉴탐"));

  static String month(Object v) {
    if (!(v instanceof String s) || !s.matches("[0-9]{4}-[0-9]{2}"))
      throw new Failure(400, "과월호 기준 월을 확인해주세요.");
    String value = (String) v;
    period(Integer.parseInt(value.substring(0, 4)), Integer.parseInt(value.substring(5)));
    return value;
  }

  @GetMapping("/api/archive")
  Object archive(@RequestParam(required = false) String month) {
    String m = month(month == null ? today().substring(0, 7) : month);
    return db.read(
        c -> {
          var draw =
              one(
                  c,
                  "SELECT d.*,u.username AS created_by_name FROM archive_draws d JOIN users u ON"
                      + " u.id=d.created_by WHERE d.month=?",
                  m);
          List<Map<String, Object>> assignments =
              draw == null
                  ? new ArrayList<>()
                  : rows(
                      c,
                      "SELECT * FROM archive_assignments WHERE draw_id=? ORDER BY group_number",
                      draw.get("id"));
          for (var a : assignments)
            a.put(
                "tasks",
                rows(
                    c,
                    "SELECT t.*,u.username AS completed_by_name FROM archive_tasks t LEFT JOIN"
                        + " users u ON u.id=t.completed_by WHERE t.assignment_id=? ORDER BY"
                        + " t.position",
                    a.get("id")));
          var out = new LinkedHashMap<String, Object>();
          out.put("month", m);
          out.put("draw", draw);
          out.put("assignments", assignments);
          out.put("groups", GROUPS);
          out.put("participants", rows(c, "SELECT id,name FROM staff WHERE active=1 ORDER BY id"));
          return out;
        });
  }

  static void addAssignments(Connection c, long draw, List<Map<String, Object>> people)
      throws SQLException {
    for (int i = 0; i < 7; i++) {
      var p = people.get(i);
      long id =
          insert(
              c,
              "INSERT INTO archive_assignments(draw_id,group_number,staff_id,staff_name)"
                  + " VALUES(?,?,?,?)",
              draw,
              i + 1,
              p.get("id"),
              p.get("name"));
      for (int j = 0; j < GROUPS.get(i).size(); j++)
        update(
            c,
            "INSERT INTO archive_tasks(assignment_id,position,newspaper) VALUES(?,?,?)",
            id,
            j,
            GROUPS.get(i).get(j));
    }
  }

  @PostMapping("/api/archive/draw")
  ResponseEntity<?> draw(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    String m = month(d.get("month"));
    db.write(
        c -> {
          if (one(c, "SELECT id FROM archive_draws WHERE month=?", m) != null)
            throw new Failure(409, "이미 추첨한 월입니다. 저장된 결과를 확인해주세요.");
          var people = rows(c, "SELECT id,name FROM staff WHERE active=1 ORDER BY id");
          if (people.size() != 7) fail("7개 신문 묶음의 추첨에는 재직 근무자 7명이 필요합니다. 인적관리를 확인해주세요.");
          Collections.shuffle(people, new java.security.SecureRandom());
          long id =
              insert(
                  c,
                  "INSERT INTO archive_draws(month,created_by,created_at) VALUES(?,?,?)",
                  m,
                  user(r).get("id"),
                  stamp());
          addAssignments(c, id, people);
          return null;
        });
    return ResponseEntity.status(201).body(ok());
  }

  static List<Integer> ids(Object v, boolean distinct) {
    if (!(v instanceof List<?> list) || list.size() != 7)
      throw new Failure(400, "7개 묶음의 담당자를 선택해주세요.");
    var out = new ArrayList<Integer>();
    for (Object id : (List<?>) v) {
      if (!integer(id)
          || ((Number) id).longValue() > Integer.MAX_VALUE
          || ((Number) id).longValue() < 1) fail("담당자를 확인해주세요.");
      out.add(number(id));
    }
    if (distinct && new HashSet<>(out).size() != 7) fail("담당자를 중복 없이 선택해주세요.");
    return out;
  }

  @PutMapping("/api/archive/assignments")
  Object manual(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    String m = month(d.get("month"));
    var ids = ids(d.get("staff_ids"), true);
    var expected = d.get("expected") == null ? null : ids(d.get("expected"), false);
    return db.write(
        c -> {
          var draw = one(c, "SELECT * FROM archive_draws WHERE month=?", m);
          List<Map<String, Object>> existing =
              draw == null
                  ? List.of()
                  : rows(
                      c,
                      "SELECT * FROM archive_assignments WHERE draw_id=? ORDER BY group_number",
                      draw.get("id"));
          var current =
              existing.isEmpty()
                  ? null
                  : existing.stream().map(a -> number(a.get("staff_id"))).toList();
          if (!Objects.equals(expected, current))
            throw new Failure(409, "다른 관리자가 담당 배정을 변경했습니다. 새로고침 후 다시 확인해주세요.");
          var people = new ArrayList<Map<String, Object>>();
          for (int i = 0; i < ids.size(); i++) {
            var p = one(c, "SELECT id,name,active FROM staff WHERE id=?", ids.get(i));
            boolean unchanged =
                !existing.isEmpty() && number(existing.get(i).get("staff_id")) == ids.get(i);
            if (p == null || number(p.get("active")) == 0 && !unchanged)
              fail("재직 중인 근무자를 선택해주세요. 기존 비활성 담당자는 그대로 유지할 수 있습니다.");
            people.add(
                Map.of(
                    "id",
                    ids.get(i),
                    "name",
                    unchanged ? existing.get(i).get("staff_name") : p.get("name")));
          }
          if (draw == null) {
            long id =
                insert(
                    c,
                    "INSERT INTO archive_draws(month,created_by,created_at) VALUES(?,?,?)",
                    m,
                    user(r).get("id"),
                    stamp());
            addAssignments(c, id, people);
          } else if (!ids.equals(current)) {
            var tasks =
                rows(
                    c,
                    "SELECT t.* FROM archive_tasks t JOIN archive_assignments a ON"
                        + " a.id=t.assignment_id WHERE a.draw_id=?",
                    draw.get("id"));
            update(
                c,
                "DELETE FROM archive_tasks WHERE assignment_id IN(SELECT id FROM"
                    + " archive_assignments WHERE draw_id=?)",
                draw.get("id"));
            update(c, "DELETE FROM archive_assignments WHERE draw_id=?", draw.get("id"));
            for (int i = 0; i < 7; i++) {
              var old = existing.get(i);
              var p = people.get(i);
              update(
                  c,
                  "INSERT INTO archive_assignments(id,draw_id,group_number,staff_id,staff_name)"
                      + " VALUES(?,?,?,?,?)",
                  old.get("id"),
                  draw.get("id"),
                  old.get("group_number"),
                  p.get("id"),
                  p.get("name"));
            }
            for (var t : tasks)
              update(
                  c,
                  "INSERT INTO"
                      + " archive_tasks(id,assignment_id,position,newspaper,completed,completed_by,completed_at)"
                      + " VALUES(?,?,?,?,?,?,?)",
                  t.get("id"),
                  t.get("assignment_id"),
                  t.get("position"),
                  t.get("newspaper"),
                  t.get("completed"),
                  t.get("completed_by"),
                  t.get("completed_at"));
          }
          return ok();
        });
  }

  @PutMapping("/api/archive/tasks/{id}")
  Object complete(@PathVariable int id, @RequestBody Map<String, Object> d, HttpServletRequest r) {
    boolean done = bool(d.get("completed"), "완료 여부를 확인해주세요.");
    return db.write(
        c -> {
          var t =
              one(
                  c,
                  "SELECT t.id,a.staff_id FROM archive_tasks t JOIN archive_assignments a ON"
                      + " a.id=t.assignment_id WHERE t.id=?",
                  id);
          if (t == null) throw new Failure(404, "신문사 과월호 항목을 찾을 수 없습니다.");
          if (!"admin".equals(user(r).get("role"))
              && !Objects.equals(t.get("staff_id"), user(r).get("staff_id")))
            throw new Failure(403, "본인이 담당한 신문사만 완료 체크할 수 있습니다.");
          update(
              c,
              "UPDATE archive_tasks SET completed=?,completed_by=?,completed_at=? WHERE id=? AND"
                  + " completed<>?",
              done,
              done ? user(r).get("id") : null,
              done ? stamp() : null,
              id,
              done);
          return ok();
        });
  }

  static final List<String> CATEGORIES = List.of("인계", "공지", "시설", "근무 변경");

  @GetMapping("/api/issues")
  Object issues(
      @RequestParam(required = false) String day,
      @RequestParam(required = false) String category,
      @RequestParam(required = false) String week) {
    if (day != null && !day.isEmpty()) day(day);
    if (category != null && !CATEGORIES.contains(category)) fail("이슈 구분을 확인해주세요.");
    LocalDate start = week == null || week.isEmpty() ? null : monday(week);
    if (start != null && start.plusDays(7).getYear() > 9999) fail("날짜 범위를 확인해주세요.");
    return db.read(
        c ->
            rows(
                c,
                "SELECT i.*,u.username AS author FROM issues i JOIN users u ON u.id=i.author_id"
                    + " WHERE (? IS NULL OR i.day=?) AND (? IS NULL OR i.category=?) AND (? IS NULL"
                    + " OR(i.day>=? AND i.day<?)) ORDER BY i.created_at DESC,i.id DESC LIMIT 200",
                day,
                day,
                category,
                category,
                start == null ? null : start.toString(),
                start == null ? null : start.toString(),
                start == null ? null : start.plusDays(7).toString()));
  }

  @PostMapping("/api/issues")
  ResponseEntity<?> issue(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    String day = day(d.getOrDefault("day", today())).toString();
    Object category = d.get("category");
    if (category == null || !CATEGORIES.contains(category)) fail("이슈 구분을 확인해주세요.");
    String title = text(d.get("title"), "제목", 80, true),
        body = text(d.get("body"), "내용", 1500, true),
        now = stamp();
    db.write(
        c -> {
          update(
              c,
              "INSERT INTO issues(day,category,title,body,author_id,created_at,updated_at)"
                  + " VALUES(?,?,?,?,?,?,?)",
              day,
              category,
              title,
              body,
              user(r).get("id"),
              now,
              now);
          return null;
        });
    return ResponseEntity.status(201).body(ok());
  }

  @PatchMapping("/api/issues/{id}")
  Object toggleIssue(@PathVariable int id, @RequestBody Map<String, Object> d) {
    boolean done = bool(d.get("done"), "이슈 상태를 확인해주세요.");
    return db.write(
        c -> {
          if (update(c, "UPDATE issues SET done=?,updated_at=? WHERE id=?", done, stamp(), id) == 0)
            throw new Failure(404, "이슈를 찾을 수 없습니다.");
          return ok();
        });
  }

  @GetMapping("/api/users")
  Object users(HttpServletRequest r) {
    admin(r);
    return db.read(c -> rows(c, "SELECT id,username,role,active,staff_id FROM users ORDER BY id"));
  }

  static Object linked(Connection c, Object id) throws SQLException {
    if (id != null && (!integer(id) || one(c, "SELECT id FROM staff WHERE id=?", id) == null))
      fail("연결할 근무자를 확인해주세요.");
    return id;
  }

  @PostMapping("/api/users")
  ResponseEntity<?> addUser(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    String name = text(d.get("username"), "아이디", 32, true), pw = password(d.get("password"));
    if (!name.matches("[A-Za-z0-9_.-]{2,32}") || pw.length() < 10)
      fail("아이디는 영문·숫자 2~32자, 비밀번호는 10자 이상으로 입력해주세요.");
    Object role = d.getOrDefault("role", "worker");
    if (role == null || !List.of("admin", "worker").contains(role)) fail("권한을 확인해주세요.");
    db.write(
        c -> {
          Object id = linked(c, d.get("staff_id"));
          update(
              c,
              "INSERT INTO users(username,password_hash,role,staff_id) VALUES(?,?,?,?)",
              name,
              Passwords.encode(pw),
              role,
              id);
          return null;
        });
    return ResponseEntity.status(201).body(ok());
  }

  @PatchMapping("/api/users/{id}")
  Object saveUser(@PathVariable int id, @RequestBody Map<String, Object> d, HttpServletRequest r) {
    admin(r);
    return db.write(
        c -> {
          var target = one(c, "SELECT * FROM users WHERE id=?", id);
          if (target == null) throw new Failure(404, "계정을 찾을 수 없습니다.");
          if (d.isEmpty() || !Set.of("active", "staff_id").containsAll(d.keySet()))
            fail("계정 변경 항목을 확인해주세요.");
          boolean active =
              bool(
                  d.getOrDefault("active", number(target.get("active")) != 0),
                  "본인 계정은 비활성화할 수 없습니다.");
          if (id == number(user(r).get("id")) && !active) fail("본인 계정은 비활성화할 수 없습니다.");
          Object person = linked(c, d.getOrDefault("staff_id", target.get("staff_id")));
          update(
              c,
              "UPDATE users SET active=?,staff_id=?,version=version+1 WHERE id=?",
              active,
              person,
              id);
          return ok();
        });
  }

  @PostMapping("/api/password")
  Object changePassword(@RequestBody Map<String, Object> d, HttpServletRequest r) {
    String old = password(d.get("current")), pw = password(d.get("password"));
    db.write(
        c -> {
          var row = one(c, "SELECT * FROM users WHERE id=?", user(r).get("id"));
          if (pw.length() < 10 || !Passwords.matches((String) row.get("password_hash"), old))
            fail("현재 비밀번호를 확인하고 새 비밀번호는 10자 이상 입력해주세요.");
          update(
              c,
              "UPDATE users SET password_hash=?,version=version+1 WHERE id=?",
              Passwords.encode(pw),
              row.get("id"));
          return null;
        });
    r.getSession().invalidate();
    return ok();
  }

  @GetMapping("/api/backup")
  ResponseEntity<byte[]> backup(HttpServletRequest r) throws Exception {
    admin(r);
    return ResponseEntity.ok()
        .header(
            "Content-Disposition",
            "attachment; filename=library-"
                + DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")
                    .format(LocalDateTime.now(Application.KOREA))
                + ".sqlite3")
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(db.backup());
  }
}

@RestControllerAdvice
class Errors {
  @ExceptionHandler(Api.Failure.class)
  ResponseEntity<?> failure(Api.Failure e) {
    return ResponseEntity.status(e.status).body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler({
    HttpMessageNotReadableException.class,
    MethodArgumentTypeMismatchException.class
  })
  ResponseEntity<?> invalid(Exception e) {
    return ResponseEntity.badRequest().body(Map.of("error", "입력값을 확인해주세요."));
  }
}

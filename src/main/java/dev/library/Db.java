package dev.library;

import com.fasterxml.jackson.databind.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.stereotype.Component;

@Component
class Db {
  final Path path;

  interface Work<T> {
    T run(Connection c) throws Exception;
  }

  Db(ObjectMapper mapper) throws Exception {
    path = databasePath();
    Files.createDirectories(path.getParent());
    if (Files.notExists(path))
      Files.createFile(
          path, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
    Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
    try (Connection c = connect()) {
      int version = ((Number) one(c, "PRAGMA user_version").values().iterator().next()).intValue();
      if (version < 0 || version > 5)
        throw new IllegalStateException("Unsupported database version");
      update(c, "PRAGMA journal_mode=WAL");
      if (version == 0) {
        JsonNode seed =
            mapper.readTree(
                System.getenv().getOrDefault("INITIAL_SCHEDULE_JSON", resource("seed.json")));
        update(c, "BEGIN IMMEDIATE");
        try {
          script(c, resource("schema.sql"));
          LocalDate monday = Api.monday(LocalDate.now(Application.KOREA).toString());
          for (JsonNode p : seed.path("staff"))
            update(
                c,
                "INSERT INTO staff(id,name) VALUES (?,?)",
                p.path("id").asInt() + 1,
                p.path("name").asText());
          int offset = 0;
          for (JsonNode entries : seed.path("shifts")) {
            for (JsonNode e : entries)
              update(
                  c,
                  "INSERT INTO shifts(staff_id,day,start,end,role) VALUES (?,?,?,?,?)",
                  e.path("id").asInt() + 1,
                  monday.plusDays(offset).toString(),
                  Math.round(e.path("start").asDouble() * 60),
                  Math.round(e.path("end").asDouble() * 60),
                  e.path("desk").asBoolean() ? "desk" : "general");
            offset++;
          }
          update(c, "COMMIT");
        } catch (Exception e) {
          update(c, "ROLLBACK");
          throw e;
        }
      }
      for (int v = 2; v <= 5; v++) if (version < v) script(c, resource("migrations/" + v + ".sql"));
      if (one(c, "SELECT id FROM users LIMIT 1") == null) {
        String name = System.getenv().getOrDefault("ADMIN_USER", ""),
            password = System.getenv().getOrDefault("ADMIN_PASSWORD", "");
        if (!name.matches("[A-Za-z0-9_.-]{2,32}")
            || password.length() < 10
            || password.length() > 128)
          throw new IllegalArgumentException("Initial admin credentials required");
        update(
            c,
            "INSERT INTO users(username,password_hash,role) VALUES (?,?,'admin')",
            name,
            Passwords.encode(password));
      }
    }
    Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
  }

  static Path databasePath() {
    return Path.of(System.getenv().getOrDefault("DATABASE", "/app/data/library.sqlite3"))
        .toAbsolutePath();
  }

  Connection connect() throws SQLException {
    Connection c = DriverManager.getConnection("jdbc:sqlite:" + path);
    update(c, "PRAGMA foreign_keys=ON");
    update(c, "PRAGMA busy_timeout=5000");
    return c;
  }

  <T> T read(Work<T> work) {
    try (Connection c = connect()) {
      return work.run(c);
    } catch (Api.Failure e) {
      throw e;
    } catch (Exception e) {
      throw failure(e);
    }
  }

  <T> T write(Work<T> work) {
    return read(
        c -> {
          update(c, "BEGIN IMMEDIATE");
          try {
            T value = work.run(c);
            update(c, "COMMIT");
            return value;
          } catch (Exception e) {
            update(c, "ROLLBACK");
            throw e;
          }
        });
  }

  static RuntimeException failure(Exception e) {
    if (e instanceof SQLException sql)
      return new Api.Failure(
          sql.getErrorCode() == 19 ? 409 : 503,
          sql.getErrorCode() == 19
              ? "같은 이름이 있거나 입력값이 올바르지 않습니다."
              : "저장소에 접근하지 못했습니다. 잠시 후 다시 시도해주세요.");
    if (e instanceof RuntimeException r) return r;
    return new IllegalStateException(e);
  }

  static List<Map<String, Object>> rows(Connection c, String sql, Object... args)
      throws SQLException {
    try (PreparedStatement p = c.prepareStatement(sql)) {
      for (int i = 0; i < args.length; i++) p.setObject(i + 1, args[i]);
      try (ResultSet r = p.executeQuery()) {
        List<Map<String, Object>> out = new ArrayList<>();
        int n = r.getMetaData().getColumnCount();
        while (r.next()) {
          Map<String, Object> row = new LinkedHashMap<>();
          for (int i = 1; i <= n; i++) row.put(r.getMetaData().getColumnLabel(i), r.getObject(i));
          out.add(row);
        }
        return out;
      }
    }
  }

  static Map<String, Object> one(Connection c, String sql, Object... args) throws SQLException {
    var r = rows(c, sql, args);
    return r.isEmpty() ? null : r.getFirst();
  }

  static int update(Connection c, String sql, Object... args) throws SQLException {
    try (PreparedStatement p = c.prepareStatement(sql)) {
      for (int i = 0; i < args.length; i++) p.setObject(i + 1, args[i]);
      p.execute();
      return p.getUpdateCount();
    }
  }

  static long insert(Connection c, String sql, Object... args) throws SQLException {
    update(c, sql, args);
    return ((Number) one(c, "SELECT last_insert_rowid() AS id").get("id")).longValue();
  }

  static void script(Connection c, String text) throws SQLException {
    for (String sql : text.split(";")) if (!sql.isBlank()) update(c, sql);
  }

  static String resource(String name) throws Exception {
    try (var in = Db.class.getResourceAsStream("/" + name)) {
      if (in == null) throw new IllegalStateException("Missing resource " + name);
      return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
    }
  }

  byte[] backup() throws Exception {
    Path dir = Files.createTempDirectory("library-backup-");
    Path dest = dir.resolve("snapshot.sqlite3");
    try {
      read(
          c -> {
            update(c, "VACUUM INTO ?", dest.toString());
            return null;
          });
      return Files.readAllBytes(dest);
    } finally {
      Files.deleteIfExists(dest);
      Files.deleteIfExists(dir);
    }
  }

  static void scheduledBackup() throws Exception {
    Path source = databasePath(), folder = source.getParent().resolve("backups");
    if (!Files.isRegularFile(source)) throw new IllegalStateException("Database not found");
    Files.createDirectories(folder);
    Files.setPosixFilePermissions(folder, PosixFilePermissions.fromString("rwx------"));
    Path dest =
        folder.resolve(
            "library-"
                + java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")
                    .withZone(ZoneOffset.UTC)
                    .format(Instant.now())
                + ".sqlite3");
    try (Connection c = DriverManager.getConnection("jdbc:sqlite:" + source)) {
      update(c, "PRAGMA busy_timeout=5000");
      update(c, "VACUUM INTO ?", dest.toString());
    }
    Files.setPosixFilePermissions(dest, PosixFilePermissions.fromString("rw-------"));
    try (var files = Files.list(folder)) {
      for (Path p :
          files
              .filter(
                  p -> p.getFileName().toString().matches("library-[0-9]{8}-[0-9]{6}\\.sqlite3"))
              .toList())
        if (Files.getLastModifiedTime(p)
            .toInstant()
            .isBefore(Instant.now().minus(Duration.ofDays(7)))) Files.delete(p);
    }
    System.out.println("Database snapshot completed.");
  }
}

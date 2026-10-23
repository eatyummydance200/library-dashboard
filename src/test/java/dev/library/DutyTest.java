package dev.library;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.sql.DriverManager;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;

class DutyTest {
  @ParameterizedTest
  @ValueSource(strings = {"2026-10-23", "2026-10-31", "2026-12-31"})
  void resetsAtKoreanMidnightAndAcceptsTheNewDaysContact(String day) throws Exception {
    LocalDate before = LocalDate.parse(day), after = before.plusDays(1);
    try (var connection = DriverManager.getConnection("jdbc:sqlite::memory:")) {
      Db.script(connection, Db.resource("migrations/5.sql"));
      Db.script(connection, Db.resource("migrations/6.sql"));
      Db db = mock(Db.class);
      when(db.read(any())).thenAnswer(call -> ((Db.Work<?>) call.getArgument(0)).run(connection));
      when(db.write(any())).thenAnswer(call -> ((Db.Work<?>) call.getArgument(0)).run(connection));
      Api api = new Api(db);
      var request = new MockHttpServletRequest();
      request.setAttribute("user", Map.of("role", "admin"));
      Map<String, Object> contact = Map.of("teacher", "오늘 담당", "extension", "1234");
      Map<String, String> empty = Map.of("teacher", "", "extension", "");

      try (var dates = mockStatic(LocalDate.class, CALLS_REAL_METHODS)) {
        dates.when(() -> LocalDate.now(Application.KOREA)).thenReturn(before);
        assertEquals(empty, api.duty());
        api.saveDuty(contact, request);
        assertEquals(contact, api.duty());
        assertEquals(contact, new Api(db).duty());

        dates.when(() -> LocalDate.now(Application.KOREA)).thenReturn(after);
        assertEquals(empty, api.duty());
        assertEquals(empty, new Api(db).duty());
        Map<String, Object> next = Map.of("teacher", "새 담당", "extension", "5678");
        api.saveDuty(next, request);
        assertEquals(next, api.duty());
        assertEquals(after.toString(), Db.one(connection, "SELECT day FROM duty_contact").get("day"));
      }
    }
  }
}

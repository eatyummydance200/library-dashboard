package dev.library;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class AuthFilter extends OncePerRequestFilter {
  private final Db db;
  private final ObjectMapper mapper;

  AuthFilter(Db db, ObjectMapper mapper) {
    this.db = db;
    this.mapper = mapper;
  }

  static String csrf(HttpServletRequest request) {
    var s = request.getSession();
    if (s.getAttribute("csrf") == null) s.setAttribute("csrf", Passwords.token());
    return (String) s.getAttribute("csrf");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String path = request.getServletPath();
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'"
            + " data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action"
            + " 'self'; object-src 'none'");
    if (!path.startsWith("/static/")) response.setHeader("Cache-Control", "no-store");
    try {
      HttpSession session = request.getSession(false);
      Map<String, Object> user = null;
      if (session != null && session.getAttribute("user_id") != null) {
        Object userId = session.getAttribute("user_id");
        var row =
            db.read(
                c ->
                    Db.one(
                        c,
                        "SELECT id,username,role,active,version,staff_id FROM users WHERE id=?",
                        userId));
        if (row != null
            && Api.number(row.get("active")) == 1
            && Objects.equals(row.get("version"), session.getAttribute("version"))) user = row;
        else {
          session.invalidate();
          session = null;
        }
      }
      request.setAttribute("user", user);
      boolean publicPath =
          path.equals("/login") || path.equals("/healthz") || path.startsWith("/static/");
      if (!publicPath && user == null) {
        if (path.startsWith("/api/")) throw new Api.Failure(401, "로그인이 필요합니다.");
        response.setStatus(302);
        response.setHeader("Location", request.getContextPath() + "/login");
        return;
      }
      if (!Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())) {
        String expected = session == null ? null : (String) session.getAttribute("csrf");
        String supplied = request.getHeader("X-CSRF-Token");
        if (supplied == null && !path.startsWith("/api/")) supplied = request.getParameter("csrf");
        if (expected == null
            || supplied == null
            || !MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                supplied.getBytes(StandardCharsets.UTF_8)))
          throw new Api.Failure(403, "요청이 만료되었습니다. 새로고침 후 다시 시도해주세요.");
        if (request.getContentLengthLong() > 65536) throw new Api.Failure(413, "요청 내용이 너무 큽니다.");
        if (path.startsWith("/api/")
            && request.getContentType() != null
            && request.getContentType().startsWith("application/json")) {
          byte[] body = request.getInputStream().readNBytes(65537);
          if (body.length > 65536) throw new Api.Failure(413, "요청 내용이 너무 큽니다.");
          var original = request;
          request =
              new HttpServletRequestWrapper(original) {
                @Override
                public ServletInputStream getInputStream() {
                  var in = new ByteArrayInputStream(body);
                  return new ServletInputStream() {
                    public int read() {
                      return in.read();
                    }

                    public boolean isFinished() {
                      return in.available() == 0;
                    }

                    public boolean isReady() {
                      return true;
                    }

                    public void setReadListener(ReadListener listener) {
                      throw new UnsupportedOperationException();
                    }
                  };
                }

                @Override
                public BufferedReader getReader() {
                  return new BufferedReader(
                      new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
                }
              };
        }
      }
      chain.doFilter(request, response);
    } catch (Api.Failure e) {
      response.setStatus(e.status);
      response.setContentType("application/json;charset=UTF-8");
      mapper.writeValue(response.getWriter(), Map.of("error", e.getMessage()));
    }
  }
}

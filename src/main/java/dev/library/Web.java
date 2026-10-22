package dev.library;

import jakarta.servlet.http.*;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.*;

@Controller
class Web {
  final Db db;
  private final String dummy = Passwords.encode(Passwords.token());

  Web(Db db) {
    this.db = db;
  }

  @ModelAttribute
  void base(HttpServletRequest r, Model m) {
    m.addAttribute("base", r.getContextPath());
  }

  @GetMapping("/")
  String index() {
    return "index";
  }

  @GetMapping("/login")
  String login(HttpServletRequest r, HttpServletResponse response, Model m) {
    if (r.getAttribute("user") != null) return "redirect:/";
    m.addAttribute("csrf", AuthFilter.csrf(r));
    return "login";
  }

  @PostMapping("/login")
  String loginPost(HttpServletRequest r, HttpServletResponse response, Model model) {
    String name = Api.text(r.getParameter("username"), "아이디", 32, true),
        password = Api.password(r.getParameter("password"));
    long now = Instant.now().getEpochSecond();
    db.write(
        c -> {
          Db.update(c, "DELETE FROM login_attempts WHERE attempted_at<?", now - 900);
          return null;
        });
    int attempts =
        db.read(
            c ->
                Api.number(
                    Db.one(c, "SELECT count(*) AS n FROM login_attempts WHERE username=?", name)
                        .get("n")));
    String error = null;
    if (attempts >= 5) {
      response.setStatus(429);
      error = "로그인 시도가 많습니다. 15분 후 다시 시도해주세요.";
    } else {
      var user = db.read(c -> Db.one(c, "SELECT * FROM users WHERE username=?", name));
      boolean valid;
      try {
        valid = Passwords.matches(user == null ? dummy : (String) user.get("password_hash"), password);
      } catch (Api.Failure e) {
        response.setStatus(e.status);
        model.addAttribute("error", e.getMessage());
        model.addAttribute("csrf", AuthFilter.csrf(r));
        return "login";
      }
      if (user == null || Api.number(user.get("active")) == 0 || !valid) {
        db.write(
            c -> {
              Db.update(c, "INSERT INTO login_attempts VALUES (?,?)", name, now);
              return null;
            });
        response.setStatus(401);
        error = "아이디 또는 비밀번호를 확인해주세요.";
      } else {
        db.write(
            c -> {
              Db.update(c, "DELETE FROM login_attempts WHERE username=?", name);
              return null;
            });
        r.getSession().invalidate();
        var session = r.getSession(true);
        session.setAttribute("user_id", user.get("id"));
        session.setAttribute("version", user.get("version"));
        AuthFilter.csrf(r);
        return "redirect:/";
      }
    }
    model.addAttribute("error", error);
    model.addAttribute("csrf", AuthFilter.csrf(r));
    return "login";
  }
}

package dev.library;

import java.time.ZoneId;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
  @org.springframework.context.annotation.Bean
  org.springframework.boot.web.server.WebServerFactoryCustomizer<
          org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory>
      relativeRedirects() {
    return factory ->
        factory.addContextCustomizers(context -> context.setUseRelativeRedirects(true));
  }

  static final ZoneId KOREA = ZoneId.of("Asia/Seoul");

  public static void main(String[] args) throws Exception {
    if (args.length == 1 && args[0].equals("--backup")) {
      Db.scheduledBackup();
      return;
    }
    String base = System.getenv().getOrDefault("APP_BASE_PATH", "/library-dashboard");
    if (!base.matches("/[A-Za-z0-9_-]+"))
      throw new IllegalArgumentException("Invalid APP_BASE_PATH");
    SpringApplication.run(Application.class, args);
  }
}

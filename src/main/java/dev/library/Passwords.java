package dev.library;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import org.bouncycastle.crypto.generators.SCrypt;

final class Passwords {
  private static final SecureRandom RANDOM = new SecureRandom();

  static String token() {
    byte[] b = new byte[32];
    RANDOM.nextBytes(b);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
  }

  static String encode(String password) {
    String salt = token().substring(0, 16);
    return "scrypt:32768:8:1$"
        + salt
        + "$"
        + HexFormat.of()
            .formatHex(
                SCrypt.generate(
                    password.getBytes(StandardCharsets.UTF_8),
                    salt.getBytes(StandardCharsets.UTF_8),
                    32768,
                    8,
                    1,
                    64));
  }

  static boolean matches(String hash, String password) {
    try {
      String[] parts = hash.split("\\$", -1), method = parts[0].split(":");
      if (parts.length != 3) return false;
      byte[] expected = HexFormat.of().parseHex(parts[2]), actual;
      if (method[0].equals("scrypt") && method.length == 4) {
        int n = Integer.parseInt(method[1]),
            r = Integer.parseInt(method[2]),
            p = Integer.parseInt(method[3]);
        if (n < 2 || n > 1048576 || r < 1 || r > 32 || p < 1 || p > 16 || expected.length != 64)
          return false;
        actual =
            SCrypt.generate(
                password.getBytes(StandardCharsets.UTF_8),
                parts[1].getBytes(StandardCharsets.UTF_8),
                n,
                r,
                p,
                64);
      } else if (method[0].equals("pbkdf2") && method.length == 3 && method[1].equals("sha256")) {
        int rounds = Integer.parseInt(method[2]);
        if (rounds < 1 || rounds > 10000000 || expected.length != 32) return false;
        actual =
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(
                    new PBEKeySpec(
                        password.toCharArray(),
                        parts[1].getBytes(StandardCharsets.UTF_8),
                        rounds,
                        256))
                .getEncoded();
      } else return false;
      return MessageDigest.isEqual(expected, actual);
    } catch (Exception e) {
      return false;
    }
  }
}

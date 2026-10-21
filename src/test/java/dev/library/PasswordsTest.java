package dev.library;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class PasswordsTest {
  @Test
  void acceptsLegacyWerkzeugHashesAndPreservesPasswordWhitespace() {
    String password = " 공백과한글-password ";
    for (String hash :
        new String[] {
          "scrypt:32768:8:1$known-salt$7cd9b1d0acb049e6c05a2b09e379d03933d2d74b4fef931be399ecfff8004c072ef3664572369a2f77bf44da66c05cfce0dbcbff7ec207d3a2641665919614cc",
          "pbkdf2:sha256:600000$known-salt$359b46bd12e2c8e6aa28074c015ad89a50a9816d8a3431d9169edb3f55bbbdc1"
        }) {
      assertTrue(Passwords.matches(hash, password));
      assertFalse(Passwords.matches(hash, password.strip()));
      assertFalse(Passwords.matches(hash, "wrong-password"));
    }
    assertTrue(Passwords.matches(Passwords.encode(password), password));
    assertFalse(Passwords.matches("invalid", password));
  }
}

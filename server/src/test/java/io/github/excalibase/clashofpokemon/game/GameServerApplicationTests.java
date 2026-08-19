package io.github.excalibase.clashofpokemon.game;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/** The application starts. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    // Not four minutes: the drain hook waits for matches to finish, and a
    // test that leaves one running would hold the JVM open until it gave up.
    properties = "clash.drain-timeout-ms=2000")
class GameServerApplicationTests {

  @Test
  void contextLoads() {
  }
}

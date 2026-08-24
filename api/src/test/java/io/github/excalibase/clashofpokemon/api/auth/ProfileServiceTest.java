package io.github.excalibase.clashofpokemon.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.excalibase.clashofpokemon.api.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

/** Choosing a name and a face. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ProfileServiceTest {

  @Autowired GuestService guests;
  @Autowired ProfileService profiles;

  private String someone() {
    return guests.create().account().id();
  }

  @Test
  void aPlayerCanChooseTheirName() {
    String id = someone();
    var after = profiles.update(id, "Duc", null);
    assertThat(after.displayName()).isEqualTo("Duc");
    assertThat(profiles.of(id).displayName()).isEqualTo("Duc");
  }

  @Test
  void twoPlayersCanBothBeCalledDuc() {
    // The whole point of the migration. A display name is what people see,
    // not what identifies them, so it has no business being unique.
    profiles.update(someone(), "Duc", null);
    var other = profiles.update(someone(), "Duc", null);
    assertThat(other.displayName()).isEqualTo("Duc");
  }

  @Test
  void surroundingSpaceIsNotPartOfTheName() {
    // Otherwise " Duc" and "Duc" look identical in a match list and are not.
    assertThat(profiles.update(someone(), "  Duc  ", null).displayName())
        .isEqualTo("Duc");
  }

  @Test
  void anEmptyNameIsRefused() {
    String id = someone();
    for (String blank : new String[] {"", "   ", "\t"}) {
      assertThatThrownBy(() -> profiles.update(id, blank, null))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("name");
    }
  }

  @Test
  void aNameHasACeiling() {
    String id = someone();
    String tooLong = "x".repeat(ProfileService.NAME_MAX + 1);
    assertThatThrownBy(() -> profiles.update(id, tooLong, null))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(profiles.update(id, "x".repeat(ProfileService.NAME_MAX), null)
        .displayName()).hasSize(ProfileService.NAME_MAX);
  }

  @Test
  void aNameCannotSmuggleInLineBreaksOrInvisibleCharacters() {
    // A name is drawn into one line of a match list. A newline in it is not a
    // name, it is a way to push text somewhere it was not meant to go, and an
    // invisible character is a way to look like somebody else exactly.
    String id = someone();
    String[] bad = {
      "Duc\nDuc",       // line break
      "Duc",      // bell
      "Duc​",      // zero-width space
      "Duc[31m",  // ANSI escape
    };
    for (String name : bad) {
      assertThatThrownBy(() -> profiles.update(id, name, null))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }

  @Test
  void anAvatarIsACardWeActuallyHave() {
    String id = someone();
    assertThat(profiles.update(id, null, "pikachu").avatar()).isEqualTo("pikachu");
    assertThatThrownBy(() -> profiles.update(id, null, "not-a-creature"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("not-a-creature");
  }

  @Test
  void aFaceYouCannotPickIsNotAFace() {
    // Gengar is real, playable, and reached only by evolving -- it is not on
    // the roster a player chooses from, so it is not on the one they wear.
    assertThatThrownBy(() -> profiles.update(someone(), null, "gengar"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aNewAccountHasNoAvatarYet() {
    assertThat(profiles.of(someone()).avatar()).isNull();
  }

  @Test
  void anEmptyAvatarClearsIt() {
    String id = someone();
    profiles.update(id, null, "pikachu");
    assertThat(profiles.update(id, null, "").avatar()).isNull();
  }

  @Test
  void whatYouDoNotSendIsLeftAlone() {
    String id = someone();
    profiles.update(id, "Duc", "pikachu");

    var renamed = profiles.update(id, "Duc II", null);
    assertThat(renamed.avatar()).isEqualTo("pikachu");

    var refaced = profiles.update(id, null, "snorlax");
    assertThat(refaced.displayName()).isEqualTo("Duc II");
  }

  @Test
  void sendingNothingChangesNothing() {
    String id = someone();
    var before = profiles.update(id, "Duc", "pikachu");
    assertThat(profiles.update(id, null, null)).isEqualTo(before);
  }
}

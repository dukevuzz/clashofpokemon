package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.content.ContentService;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** The roster, unauthenticated. */
@RestController
class ContentController {

  private final ContentService content;

  ContentController(ContentService content) {
    this.content = content;
  }

  @GetMapping("/v1/content")
  Map<String, Object> content() {
    return Map.of(
        "version", content.version(),
        "cards", content.cards(),
        "troops", content.troops(),
        "rules", content.rules());
  }
}

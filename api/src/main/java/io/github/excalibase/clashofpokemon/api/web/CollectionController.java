package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.collection.CollectionService;
import io.github.excalibase.clashofpokemon.api.content.ContentService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The collection, which used to live in localStorage.
 *
 * Moving it here is not only about surviving a cleared browser. The chest roll
 * ran in the client against `Math.random()` with the counts in an editable JSON
 * blob, so a collection was something a player could write rather than earn.
 * Every mutating call below is the server's decision, not the client's report
 * of one.
 */
@RestController
class CollectionController {

  private final CurrentAccount current;
  private final CollectionService collection;
  private final ContentService content;

  CollectionController(CurrentAccount current, CollectionService collection,
                       ContentService content) {
    this.current = current;
    this.collection = collection;
    this.content = content;
  }

  @GetMapping("/v1/collection")
  CollectionService.State get(HttpServletRequest request) {
    return collection.state(current.require(request));
  }

  /**
   * Open one chest.
   *
   * 409 rather than 400 when there is none: the request was well formed, the
   * account simply has nothing to open. A double-tapped button lands here and
   * must not be told it sent something wrong.
   */
  @PostMapping("/v1/collection/open")
  ResponseEntity<?> open(HttpServletRequest request) {
    var opened = collection.open(current.require(request));
    if (opened == null) {
      return ResponseEntity.status(HttpStatus.CONFLICT)
          .body(Map.of("error", "no packs"));
    }
    return ResponseEntity.ok(opened);
  }

  /** Trade this creature's shards for one of its faces. */
  @PostMapping("/v1/collection/faces")
  ResponseEntity<?> buyFace(HttpServletRequest request, @RequestBody FaceBody body) {
    if (body == null || body.cardId() == null || !content.isKnownCard(body.cardId())) {
      return ResponseEntity.badRequest().body(Map.of("error", "unknown card"));
    }
    int emotion = body.emotion() == null ? 0 : body.emotion();
    List<Integer> costs = content.packs().emotionCost();
    if (emotion < 0 || emotion >= costs.size()) {
      return ResponseEntity.badRequest().body(Map.of("error", "unknown face"));
    }
    boolean bought = collection.buyFace(
        current.require(request), body.cardId(), emotion, Boolean.TRUE.equals(body.shiny()));
    return bought
        ? ResponseEntity.ok(Map.of("ok", true))
        : ResponseEntity.status(HttpStatus.CONFLICT)
            .body(Map.of("error", "cannot afford, or already owned"));
  }

  /** Trade coins for a chest, at the price the client is showing. */
  @PostMapping("/v1/collection/packs")
  ResponseEntity<?> buyPack(HttpServletRequest request) {
    boolean bought = collection.buyPack(
        current.require(request), content.packs().packPrice());
    return bought
        ? ResponseEntity.ok(Map.of("ok", true))
        : ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "not enough coins"));
  }

  // `emotion` and `shiny` are optional: the default face is 0 and not shiny,
  // and a client that omits them means exactly that.
  record FaceBody(String cardId, Integer emotion, Boolean shiny) {}
}

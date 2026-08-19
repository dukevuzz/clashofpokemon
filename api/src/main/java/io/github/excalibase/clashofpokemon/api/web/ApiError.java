package io.github.excalibase.clashofpokemon.api.web;

import java.util.List;

/** What a failure looks like to a client. */
public record ApiError(String error, List<Problem> problems) {

  public record Problem(String field, String message) {}

  public static ApiError of(String error) {
    return new ApiError(error, List.of());
  }
}

package io.github.excalibase.clashofpokemon.api.web;

import io.github.excalibase.clashofpokemon.api.auth.AuthFailed;
import io.github.excalibase.clashofpokemon.api.auth.TokenService;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import jakarta.servlet.http.HttpServletRequest;

/** Who is calling, from the Authorization header. */
@Component
public class CurrentAccount {

  private static final String BEARER = "Bearer ";

  private final TokenService tokens;

  CurrentAccount(TokenService tokens) {
    this.tokens = tokens;
  }

  public String require(HttpServletRequest request) {
    String header = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (header == null || !header.startsWith(BEARER)) throw new AuthFailed();
    return tokens.accountFor(header.substring(BEARER.length()));
  }
}

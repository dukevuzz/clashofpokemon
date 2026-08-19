package io.github.excalibase.clashofpokemon.api.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Only the game server may call /internal. */
@Component
class InternalGuard implements HandlerInterceptor {

  private final String expectedKey;

  // `clash.internal-key`, spelled exactly as the game server spells it.
  InternalGuard(@Value("${clash.internal-key:test-internal-key}") String expectedKey) {
    this.expectedKey = expectedKey;
  }

  @Override
  public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
      Object handler) throws java.io.IOException {
    if (request.getRequestURI().endsWith("/jwks")) return true;
    if (expectedKey.equals(request.getHeader("X-Internal-Key"))) return true;

    response.setStatus(HttpStatus.UNAUTHORIZED.value());
    response.setContentType("application/json");
    response.getWriter().write("{\"error\":\"unauthorized\"}");
    return false;
  }

  @Configuration
  static class Registration implements WebMvcConfigurer {

    private final InternalGuard guard;

    Registration(InternalGuard guard) {
      this.guard = guard;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
      registry.addInterceptor(guard).addPathPatterns("/internal/**");
    }
  }
}

package io.github.excalibase.clashofpokemon.api.web;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** The client is served from somewhere else. */
@Configuration
class WebConfig implements WebMvcConfigurer {

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/**")
        .allowedOriginPatterns("*")
        // PATCH belongs here as much as the rest. It was missing, and because a
        // cross-origin PATCH is preflighted, the browser got a 403 on the
        // OPTIONS and reported "Failed to fetch" -- renaming and changing an
        // avatar were dead in the client while every server-side test that
        // called the endpoint directly passed.
        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        .allowedHeaders("*")
        // A browser can only read the CORS-safelisted response headers unless
        // they are named here, and Retry-After is not one of them. Without
        // this the 429 handler's header is invisible to the client that needs
        // it -- which is exactly what happened: the form fell back to "try
        // again in an hour" no matter what the server actually said.
        .exposedHeaders("Retry-After");
  }
}

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
        .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
        .allowedHeaders("*")
        // A browser can only read the CORS-safelisted response headers unless
        // they are named here, and Retry-After is not one of them. Without
        // this the 429 handler's header is invisible to the client that needs
        // it -- which is exactly what happened: the form fell back to "try
        // again in an hour" no matter what the server actually said.
        .exposedHeaders("Retry-After");
  }
}

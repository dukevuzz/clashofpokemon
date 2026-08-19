package io.github.excalibase.clashofpokemon.game.net;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** The client is on another origin, and always will be. */
@Configuration
public class WebConfig implements WebMvcConfigurer {

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/status").allowedOriginPatterns("*").allowedMethods("GET");
    registry.addMapping("/me/match").allowedOriginPatterns("*").allowedMethods("GET");
  }
}

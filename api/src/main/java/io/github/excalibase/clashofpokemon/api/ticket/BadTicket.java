package io.github.excalibase.clashofpokemon.api.ticket;

/** The ticket was not one we issued, or is no longer valid. */
public class BadTicket extends RuntimeException {
  public BadTicket(String why) {
    super(why);
  }
}

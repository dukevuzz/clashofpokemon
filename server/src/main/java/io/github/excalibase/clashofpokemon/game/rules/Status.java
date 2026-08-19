package io.github.excalibase.clashofpokemon.game.rules;

/** One affliction, counting down. */
public final class Status {

  public final StatusKind kind;
  /** Seconds remaining. At or below zero it is gone. */
  public double left;
  /** Who caused it. Only charm reads this -- an infatuated creature walks to them. */
  public Integer by;
  /** Countdown to the next burn or poison bite. */
  public double tick;

  Status(StatusKind kind, double left, Integer by, double tick) {
    this.kind = kind;
    this.left = left;
    this.by = by;
    this.tick = tick;
  }
}

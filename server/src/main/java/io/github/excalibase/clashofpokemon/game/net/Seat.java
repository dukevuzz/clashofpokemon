package io.github.excalibase.clashofpokemon.game.net;

import io.github.excalibase.clashofpokemon.game.rules.Side;
import java.util.List;

/** One player's place in a match, and the socket currently attached to it. */
public final class Seat {

  public interface Channel {
    void send(Wire.Msg message);

    /** Packed snapshots go out as binary frames; everything else stays text. */
    void sendBinary(byte[] frame);

    /** Hang up, having said why. */
    default void close(String why) {}
  }

  /** Where nothing goes. A seat with no socket attached is not a special case. */
  static final Channel SILENT = new Channel() {
    @Override public void send(Wire.Msg message) {}

    @Override public void sendBinary(byte[] frame) {}

    @Override public void close(String why) {}
  };

  public final Wire.Account account;
  public final Side side;
  public final List<String> deck;
  public final String troop;
  public final String branch;

  private Channel channel = SILENT;
  private boolean live;
  private boolean loaded;

  public Seat(Wire.Account account, Side side, List<String> deck, String troop, String branch) {
    this.account = account;
    this.side = side;
    this.deck = List.copyOf(deck);
    this.troop = troop;
    this.branch = branch;
  }

  void attach(Channel channel) {
    this.channel = channel == null ? SILENT : channel;
    this.live = channel != null;
  }

  void detach() {
    this.channel = SILENT;
    this.live = false;
  }

  void send(Wire.Msg message) {
    channel.send(message);
  }

  void sendBinary(byte[] frame) {
    channel.sendBinary(frame);
  }

  public boolean live() {
    return live;
  }

  public boolean loaded() {
    return loaded;
  }

  void markLoaded() {
    loaded = true;
  }
}

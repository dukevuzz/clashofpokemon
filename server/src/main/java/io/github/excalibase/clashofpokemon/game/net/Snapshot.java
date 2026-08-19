package io.github.excalibase.clashofpokemon.game.net;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

/** The snapshot, packed. */
public final class Snapshot {

  /** Binary message kinds. Only one so far, and that is the point. */
  public static final int KIND_SNAP = 1;

  /** Positions are stored in tenths of a world unit. */
  private static final int SCALE = 10;

  private static final int HEADER = 16;
  private static final int UNIT = 14;
  private static final int TOWER = 7;
  private static final int SHOT = 4;

  /** `[id, x, y, hp, shield, action, facing, spawning, statusBits]`. */
  public record UnitSnap(int id, double x, double y, int hp, int shield,
                         int action, int facing, double spawning, int status) {}

  /** `[id, hp, active, waking, ammo]`. */
  public record TowerSnap(int id, int hp, int active, double waking, int ammo) {}

  /** A shot in the air. It is drawn, and it is about to do damage. */
  public record ShotSnap(double x, double y) {}

  /** The private tail: only this seat's own elixir and hand. */
  public record Own(double elixir, List<String> hand, String next) {}

  public record Snap(long tick, double left, List<UnitSnap> units,
                     List<TowerSnap> towers, List<ShotSnap> shots, Own me) {}

  private Snapshot() {}

  /** Bytes this will occupy, so the buffer is allocated once. */
  public static int sizeOf(Snap s) {
    return HEADER + s.units().size() * UNIT + s.towers().size() * TOWER
        + s.shots().size() * SHOT + s.me().hand().size() * 2;
  }

  public static byte[] encode(Snap s) {
    ByteBuffer b = ByteBuffer.allocate(sizeOf(s));   // big-endian, as DataView is

    b.put((byte) KIND_SNAP);
    b.putInt((int) s.tick());
    // Seconds left, in tenths. A match is 180s, so 1800 -- nowhere near uint16.
    b.putShort((short) clamp(Math.round(s.left() * 10), 0, 0xffff));
    // Elixir in hundredths: the bar moves continuously and a tenth would step.
    b.putShort((short) clamp(Math.round(s.me().elixir() * 100), 0, 0xffff));
    b.putShort((short) s.units().size());
    b.put((byte) s.towers().size());
    b.put((byte) s.shots().size());
    b.put((byte) s.me().hand().size());
    b.putShort((short) CardTable.indexOf(s.me().next()));

    for (UnitSnap u : s.units()) {
      // Ids come from nextId, which only counts up. A three-minute match makes
      // a few hundred; 65,535 would need a different game. Checked rather than
      // trusted, because the failure mode is a unit quietly becoming another.
      if (u.id() > 0xffff) {
        throw new IllegalArgumentException("unit id " + u.id() + " does not fit uint16");
      }
      b.putShort((short) u.id());
      b.putShort((short) Math.round(u.x() * SCALE));
      b.putShort((short) Math.round(u.y() * SCALE));
      b.putShort((short) clamp(Math.round((double) u.hp()), 0, 0xffff));
      b.putShort((short) clamp(Math.round((double) u.shield()), 0, 0xffff));
      b.put((byte) u.action());
      b.put((byte) u.facing());
      // Arrival is at most a few seconds; tenths in a byte reaches 25.5.
      b.put((byte) clamp(Math.round(u.spawning() * 10), 0, 255));
      b.put((byte) u.status());
    }

    for (TowerSnap t : s.towers()) {
      b.putShort((short) t.id());
      b.putShort((short) clamp(Math.round((double) t.hp()), 0, 0xffff));
      b.put((byte) t.active());
      b.put((byte) clamp(Math.round(t.waking() * 10), 0, 255));
      b.put((byte) clamp(t.ammo(), 0, 255));
    }

    for (ShotSnap p : s.shots()) {
      b.putShort((short) Math.round(p.x() * SCALE));
      b.putShort((short) Math.round(p.y() * SCALE));
    }

    for (String id : s.me().hand()) b.putShort((short) CardTable.indexOf(id));

    return b.array();
  }

  /** Read one back. The server does not need this; the tests very much do. */
  public static Snap decode(byte[] bytes) {
    ByteBuffer b = ByteBuffer.wrap(bytes);

    int kind = u8(b);
    if (kind != KIND_SNAP) throw new IllegalArgumentException("unknown binary kind " + kind);
    long tick = b.getInt() & 0xffffffffL;
    double left = u16(b) / 10.0;
    double elixir = u16(b) / 100.0;
    int unitCount = u16(b);
    int towerCount = u8(b);
    int shotCount = u8(b);
    int handSize = u8(b);
    String next = CardTable.idAt(u16(b));

    List<UnitSnap> units = new ArrayList<>(unitCount);
    for (int i = 0; i < unitCount; i++) {
      units.add(new UnitSnap(u16(b), b.getShort() / (double) SCALE, b.getShort() / (double) SCALE,
          u16(b), u16(b), u8(b), u8(b), u8(b) / 10.0, u8(b)));
    }

    List<TowerSnap> towers = new ArrayList<>(towerCount);
    for (int i = 0; i < towerCount; i++) {
      towers.add(new TowerSnap(u16(b), u16(b), u8(b), u8(b) / 10.0, u8(b)));
    }

    List<ShotSnap> shots = new ArrayList<>(shotCount);
    for (int i = 0; i < shotCount; i++) {
      shots.add(new ShotSnap(b.getShort() / (double) SCALE, b.getShort() / (double) SCALE));
    }

    List<String> hand = new ArrayList<>(handSize);
    for (int i = 0; i < handSize; i++) hand.add(CardTable.idAt(u16(b)));

    return new Snap(tick, left, units, towers, shots, new Own(elixir, hand, next));
  }

  private static int u8(ByteBuffer b) {
    return b.get() & 0xff;
  }

  private static int u16(ByteBuffer b) {
    return b.getShort() & 0xffff;
  }

  private static long clamp(long v, long lo, long hi) {
    return Math.max(lo, Math.min(hi, v));
  }
}

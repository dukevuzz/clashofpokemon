package io.github.excalibase.clashofpokemon.api.feedback;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

/** Storing what players tell us. Nothing here decides anything. */
@Repository
public class FeedbackRepository {

  private static final ObjectMapper JSON = new ObjectMapper();

  private final JdbcClient db;

  FeedbackRepository(JdbcClient db) {
    this.db = db;
  }

  public long save(String accountId, Kind kind, String message, Map<String, Object> context) {
    // Serialised here and cast in SQL rather than handed over as a Java map:
    // the driver has no idea what jsonb is, and `?::jsonb` is the whole of the
    // translation.
    String json = context == null || context.isEmpty() ? null : JSON.writeValueAsString(context);
    return db.sql("""
        insert into feedback (account_id, kind, message, context)
        values (?, ?, ?, ?::jsonb)
        returning id
        """)
        .params(accountId, kind.wire(), message, json)
        .query(Long.class)
        .single();
  }

  /** How many this account has sent recently, which is what rate limiting needs. */
  public int countSince(String accountId, Duration window) {
    return db.sql("""
        select count(*) from feedback
        where account_id = ? and created_at > now() - (? * interval '1 second')
        """)
        .params(accountId, window.toSeconds())
        .query(Integer.class)
        .single();
  }

  /** When this account last sent one, so a refusal can say when to try again. */
  public Instant lastSentAt(String accountId) {
    return db.sql("select max(created_at) from feedback where account_id = ?")
        .param(accountId)
        .query(Instant.class)
        .optional()
        .orElse(null);
  }

  /** Newest first. For us, not for players. */
  public List<Report> recent(int limit) {
    return db.sql("""
        select id, account_id, kind, message, context, created_at, handled_at
        from feedback order by created_at desc limit ?
        """).param(limit).query(this::map).list();
  }

  private Report map(ResultSet rs, int row) throws SQLException {
    String context = rs.getString("context");
    return new Report(
        rs.getLong("id"),
        rs.getString("account_id"),
        Kind.of(rs.getString("kind")),
        rs.getString("message"),
        context == null ? Map.of() : JSON.readValue(context, Map.class),
        rs.getTimestamp("created_at").toInstant(),
        rs.getTimestamp("handled_at") == null ? null : rs.getTimestamp("handled_at").toInstant());
  }
}

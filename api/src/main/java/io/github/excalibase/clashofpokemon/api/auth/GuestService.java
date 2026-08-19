package io.github.excalibase.clashofpokemon.api.auth;

import java.util.UUID;
import java.util.function.Consumer;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Play first, register later. */
@Service
public class GuestService {

  /** Names collide rarely; the database is the arbiter, so retry a few times. */
  private static final int NAME_ATTEMPTS = 5;

  private final AccountRepository accounts;
  private final TokenService tokens;
  private final GuestNames names = GuestNames.create();

  /** What to do for a newly created account, injected rather than called. */
  private final Consumer<String> onCreated;

  GuestService(AccountRepository accounts, TokenService tokens,
      NewAccountSetup setup) {
    this.accounts = accounts;
    this.tokens = tokens;
    this.onCreated = setup::prepare;
  }

  @Transactional
  public NewGuest create() {
    String id = "acct_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

    for (int attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
      String name = names.next();
      try {
        accounts.insert(id, name);
        onCreated.accept(id);
        // The refresh token is the only proof of ownership this account will
        // ever have. The id is not one -- it is printed, logged and shown.
        String refresh = tokens.issueRefresh(id);
        return new NewGuest(accounts.find(id).orElseThrow(), refresh);
      } catch (DuplicateKeyException taken) {
        // Someone already has that name. Try another rather than failing a
        // sign-up over a coincidence.
      }
    }
    throw new IllegalStateException("could not find a free display name");
  }
}

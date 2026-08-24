package io.github.excalibase.clashofpokemon.api.auth;

import java.util.UUID;
import java.util.function.Consumer;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Play first, register later. */
@Service
public class GuestService {

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

  /**
   * No retry on the name.
   *
   * There used to be one, five attempts deep, and it could never work: this
   * method is transactional, so the first DuplicateKeyException aborted the
   * transaction and every attempt after it failed with the same error. Sign-up
   * did not pick another name, it failed outright -- and with 14 stems and
   * 9900 numbers, that was going to start happening.
   *
   * V5 dropped the unique constraint the retry existed to dodge. Two guests
   * sharing a label is not a problem; the id and the refresh token are what
   * tell them apart.
   */
  @Transactional
  public NewGuest create() {
    String id = "acct_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    accounts.insert(id, names.next());
    onCreated.accept(id);
    // The refresh token is the only proof of ownership this account will ever
    // have. The id is not one -- it is printed, logged and shown.
    String refresh = tokens.issueRefresh(id);
    return new NewGuest(accounts.find(id).orElseThrow(), refresh);
  }
}

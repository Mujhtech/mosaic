import 'dart:async';

/// Proactive refresh margin. A token within this margin of expiry is treated
/// as already expired, so a request is never sent with a credential that dies
/// in flight.
const Duration mosaicCustomerTokenExpiryMargin = Duration(seconds: 60);

/// How long the holder waits after a token-provider failure before asking
/// again. Without it, an application backend outage becomes a request storm
/// from every device at once.
const Duration mosaicCustomerTokenFailureCooldown = Duration(seconds: 30);

/// An opaque Customer Access Token minted by the host application's backend.
///
/// The SDK never parses [value] and nothing may be inferred from it. It is held
/// in memory only: it is never written to disk, preferences, or a keychain, and
/// it never appears in a log, a diagnostic, a crash report, or telemetry.
/// Diagnostics carry [tokenId] instead.
final class MosaicCustomerToken {
  MosaicCustomerToken({
    required this.value,
    required this.tokenId,
    required DateTime expiresAt,
  }) : expiresAt = expiresAt.toUtc() {
    if (value.isEmpty) {
      throw ArgumentError.value(
        '<redacted>',
        'value',
        'A Customer Access Token must not be empty.',
      );
    }
    if (tokenId.isEmpty || tokenId.length > 128) {
      throw ArgumentError.value(tokenId, 'tokenId', 'Invalid token handle.');
    }
  }

  /// The opaque credential presented in `Authorization: Bearer`.
  final String value;

  /// Safe handle for diagnostics and support. It is not the token.
  final String tokenId;
  final DateTime expiresAt;

  bool isUsableAt(DateTime now) =>
      now.toUtc().isBefore(expiresAt.subtract(mosaicCustomerTokenExpiryMargin));

  /// Deliberately redacted. A token that can be printed will eventually be
  /// printed.
  @override
  String toString() => 'MosaicCustomerToken(tokenId: $tokenId)';
}

/// What the SDK tells the host application when it needs a token.
final class MosaicCustomerTokenRequest {
  const MosaicCustomerTokenRequest({
    required this.forceRefresh,
    required this.identityGeneration,
    this.userId,
    this.installationId,
  });

  /// True when the previous token was refused by the server. The host must
  /// mint a new token rather than return a cached one.
  final bool forceRefresh;

  /// The Phase 6 identity generation this request belongs to. A token minted
  /// for an older generation is discarded rather than used.
  final int identityGeneration;

  /// The host's own user identifier, when one is set. `null` means signed out,
  /// and a signed-out customer is `unavailable`, never `inactive`.
  final String? userId;

  /// Installation identity, supplied as association evidence and a restore
  /// hint. It can never create or select a Billing Customer.
  final String? installationId;
}

/// Mints a Customer Access Token through the host application's own backend.
///
/// Mosaic Billing requires an application backend: there is no anonymous mode,
/// because a client-generated installation identifier is guessable and letting
/// it select a Billing Customer would let anyone read someone else's
/// entitlements. Returning `null` means "no customer is signed in", which the
/// SDK reports as `unavailable`.
typedef MosaicCustomerTokenProvider = Future<MosaicCustomerToken?> Function(
  MosaicCustomerTokenRequest request,
);

/// Token state a host may safely display or log.
final class MosaicCustomerTokenDiagnostics {
  const MosaicCustomerTokenDiagnostics({
    required this.hasToken,
    required this.identityGeneration,
    this.tokenId,
    this.expiresAt,
    this.lastSafeCode,
    this.cooldownUntil,
  });

  final bool hasToken;
  final int identityGeneration;

  /// The safe handle. The token value itself is structurally unavailable here.
  final String? tokenId;
  final DateTime? expiresAt;
  final String? lastSafeCode;
  final DateTime? cooldownUntil;
}

/// The outcome of asking for a usable token.
sealed class MosaicCustomerTokenResolution {
  const MosaicCustomerTokenResolution();
}

final class MosaicCustomerTokenResolved extends MosaicCustomerTokenResolution {
  const MosaicCustomerTokenResolved(this.token, {required this.generation});

  final MosaicCustomerToken token;

  /// The token generation this value belongs to. A caller that observes a
  /// `401` reports this back, so a refresh another caller already performed is
  /// not performed a second time.
  final int generation;
}

/// No token could be obtained. Never a claim about the customer's access.
final class MosaicCustomerTokenUnavailable
    extends MosaicCustomerTokenResolution {
  const MosaicCustomerTokenUnavailable(this.reasonCode);

  final String reasonCode;
}

typedef MosaicCustomerTokenClock = DateTime Function();

DateTime _systemClock() => DateTime.now().toUtc();

/// Holds the in-memory Customer Access Token.
///
/// This type is internal to the SDK and is deliberately not exported: hosts
/// supply a [MosaicCustomerTokenProvider] and never manage token lifetime
/// themselves.
///
/// It guarantees four things the contract requires: one in-flight mint at a
/// time, tokens bound to the identity generation that requested them, a bounded
/// cooldown after a provider failure, and no path by which a token value
/// reaches persistence or diagnostics.
final class MosaicCustomerTokenHolder {
  MosaicCustomerTokenHolder({
    required MosaicCustomerTokenProvider? provider,
    MosaicCustomerTokenClock clock = _systemClock,
    Duration cooldown = mosaicCustomerTokenFailureCooldown,
  })  : _provider = provider,
        _clock = clock,
        _cooldown = cooldown;

  final MosaicCustomerTokenProvider? _provider;
  final MosaicCustomerTokenClock _clock;
  final Duration _cooldown;

  MosaicCustomerToken? _token;
  Future<MosaicCustomerTokenResolution>? _operation;
  int _identityGeneration = 0;
  int _tokenGeneration = 0;

  /// The token generation that a forced refresh itself produced. A second
  /// force against that generation means the freshly minted token was refused,
  /// which is a real failure rather than something to retry.
  int _forceMintedGeneration = -1;
  bool _forcingMint = false;
  DateTime? _cooldownUntil;
  String? _lastSafeCode;
  String? _userId;
  String? _installationId;

  int get identityGeneration => _identityGeneration;
  int get tokenGeneration => _tokenGeneration;

  MosaicCustomerTokenDiagnostics get diagnostics =>
      MosaicCustomerTokenDiagnostics(
        hasToken: _token != null,
        identityGeneration: _identityGeneration,
        tokenId: _token?.tokenId,
        expiresAt: _token?.expiresAt,
        lastSafeCode: _lastSafeCode,
        cooldownUntil: _cooldownUntil,
      );

  /// Records the identity the next token belongs to. A change bumps the
  /// generation and discards the held token, so a token minted for the previous
  /// user can never be presented after a sign-in or sign-out.
  void bindIdentity({
    required int generation,
    String? userId,
    String? installationId,
  }) {
    _userId = userId;
    _installationId = installationId;
    if (generation == _identityGeneration) return;
    _identityGeneration = generation;
    _clearToken();
  }

  /// Discards the token on logout. The entitlement cache is cleared by the
  /// runtime in the same transition; neither is sufficient alone.
  void clearCustomer() {
    _identityGeneration += 1;
    _clearToken();
  }

  void _clearToken() {
    _token = null;
    _cooldownUntil = null;
    _forceMintedGeneration = -1;
    _forcingMint = false;
    // An in-flight mint belongs to the previous generation. It is not
    // cancellable, so it is disowned: its result is discarded on completion.
    _operation = null;
  }

  /// Resolves a usable token, coalescing concurrent callers onto one mint.
  ///
  /// [observedGeneration] is the generation a caller was using when the server
  /// refused its request. Passing it makes the forced refresh idempotent: if
  /// another caller has already minted a newer token, this one uses it instead
  /// of minting again, which is what bounds a `401` to exactly one retry.
  Future<MosaicCustomerTokenResolution> resolve({
    bool forceRefresh = false,
    int? observedGeneration,
  }) {
    final provider = _provider;
    if (provider == null) {
      return Future.value(
        const MosaicCustomerTokenUnavailable('entitlements.token.no_provider'),
      );
    }
    if (forceRefresh) {
      if (observedGeneration != null && observedGeneration < _tokenGeneration) {
        // Someone else already refreshed past the token that was refused.
        final current = _token;
        if (current != null && current.isUsableAt(_clock())) {
          return Future.value(
            MosaicCustomerTokenResolved(current, generation: _tokenGeneration),
          );
        }
      }
      if (_forceMintedGeneration == _tokenGeneration && _operation == null) {
        // A second forced refresh against the same token generation means the
        // freshly minted token was itself refused. That is a real failure, and
        // retrying it forever turns an outage into a request storm.
        _lastSafeCode = 'entitlements.token.refresh_exhausted';
        return Future.value(
          const MosaicCustomerTokenUnavailable(
            'entitlements.token.refresh_exhausted',
          ),
        );
      }
      _forcingMint = true;
      _token = null;
      _cooldownUntil = null;
    } else {
      final current = _token;
      if (current != null && current.isUsableAt(_clock())) {
        return Future.value(
          MosaicCustomerTokenResolved(current, generation: _tokenGeneration),
        );
      }
      final cooldownUntil = _cooldownUntil;
      if (cooldownUntil != null && _clock().isBefore(cooldownUntil)) {
        return Future.value(
          MosaicCustomerTokenUnavailable(
            _lastSafeCode ?? 'entitlements.token.cooldown',
          ),
        );
      }
    }
    return _operation ??= _mint(provider);
  }

  Future<MosaicCustomerTokenResolution> _mint(
    MosaicCustomerTokenProvider provider,
  ) async {
    final generation = _identityGeneration;
    final forcing = _forcingMint;
    _forcingMint = false;
    final request = MosaicCustomerTokenRequest(
      forceRefresh: forcing,
      identityGeneration: generation,
      userId: _userId,
      installationId: _installationId,
    );
    try {
      final MosaicCustomerToken? token;
      try {
        token = await provider(request);
      } on Object {
        // The host's error is never surfaced: it can carry its own credentials
        // and its own user data.
        return _fail('entitlements.token.provider_failed');
      }
      if (generation != _identityGeneration) {
        // Identity changed while the mint was in flight. The token belongs to
        // someone who is no longer signed in, so it is dropped, not stored.
        return const MosaicCustomerTokenUnavailable(
          'entitlements.token.identity_changed',
        );
      }
      if (token == null) {
        // A signed-out customer is unavailable. A host backend that will not
        // mint a token has not revoked anyone's subscription.
        return _fail('entitlements.token.signed_out');
      }
      if (!token.isUsableAt(_clock())) {
        return _fail('entitlements.token.expired_on_arrival');
      }
      _token = token;
      _tokenGeneration += 1;
      if (forcing) _forceMintedGeneration = _tokenGeneration;
      _cooldownUntil = null;
      _lastSafeCode = null;
      return MosaicCustomerTokenResolved(token, generation: _tokenGeneration);
    } finally {
      // Always released, so one provider failure cannot permanently poison
      // token resolution for the rest of the process lifetime.
      _operation = null;
    }
  }

  MosaicCustomerTokenUnavailable _fail(String reasonCode) {
    _lastSafeCode = reasonCode;
    _cooldownUntil = _clock().add(_cooldown);
    return MosaicCustomerTokenUnavailable(reasonCode);
  }
}

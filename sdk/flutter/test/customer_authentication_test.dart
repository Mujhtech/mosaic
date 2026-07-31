import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/src/customer_authentication.dart';

void main() {
  late DateTime now;
  DateTime clock() => now;

  setUp(() => now = DateTime.utc(2026, 7, 28, 12));

  MosaicCustomerToken token(String id,
          {Duration life = const Duration(hours: 1)}) =>
      MosaicCustomerToken(
        value: 'mcat_$id',
        tokenId: id,
        expiresAt: now.add(life),
      );

  test('concurrent callers coalesce onto one mint', () async {
    // A cold start fans out: a placement read, a lifecycle refresh, and a
    // purchase-completion refresh can all want a token in the same frame. Each
    // one minting separately would multiply load on the host's backend.
    var calls = 0;
    final completer = Completer<MosaicCustomerToken?>();
    final holder = MosaicCustomerTokenHolder(
      provider: (_) {
        calls += 1;
        return completer.future;
      },
      clock: clock,
    );

    final first = holder.resolve();
    final second = holder.resolve();
    completer.complete(token('token-a'));

    expect(await first, isA<MosaicCustomerTokenResolved>());
    expect(await second, isA<MosaicCustomerTokenResolved>());
    expect(calls, 1);
  });

  test('a token inside the expiry margin is replaced before it is used',
      () async {
    var calls = 0;
    final holder = MosaicCustomerTokenHolder(
      provider: (_) async {
        calls += 1;
        return token('token-$calls', life: const Duration(seconds: 90));
      },
      clock: clock,
    );

    await holder.resolve();
    expect(calls, 1);
    // Thirty-one seconds of life left: inside the 60-second margin, so the
    // request would otherwise be sent with a credential that dies in flight.
    now = now.add(const Duration(seconds: 59));
    await holder.resolve();
    expect(calls, 2);
  });

  test('an accepted authority epoch invalidates the previous token', () async {
    final requests = <MosaicCustomerTokenRequest>[];
    final holder = MosaicCustomerTokenHolder(
      provider: (request) async {
        requests.add(request);
        return token('token-${requests.length}');
      },
      clock: clock,
    );

    await holder.resolve();
    holder.bindAuthorityEpoch(5);
    await holder.resolve();

    expect(requests, hasLength(2));
    expect(requests.first.acceptedAuthorityEpoch, isNull);
    expect(requests.last.acceptedAuthorityEpoch, 5);
  });

  test('a token minted for a superseded identity is discarded', () async {
    final completer = Completer<MosaicCustomerToken?>();
    final holder = MosaicCustomerTokenHolder(
      provider: (_) => completer.future,
      clock: clock,
    );

    final pending = holder.resolve();
    holder.clearCustomer();
    completer.complete(token('token-previous-user'));

    final resolution = await pending;
    expect(
      resolution,
      isA<MosaicCustomerTokenUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'entitlements.token.identity_changed',
      ),
    );
    // The critical part: nothing was retained. A held token would be presented
    // on the next sync and would read the previous user's entitlements.
    expect(holder.diagnostics.hasToken, isFalse);
  });

  test('a signed-out customer is unavailable, never inactive', () async {
    final holder = MosaicCustomerTokenHolder(
      provider: (_) async => null,
      clock: clock,
    );

    expect(
      await holder.resolve(),
      isA<MosaicCustomerTokenUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'entitlements.token.signed_out',
      ),
    );
  });

  test('a provider failure is cooled down rather than retried in a storm',
      () async {
    var calls = 0;
    final holder = MosaicCustomerTokenHolder(
      provider: (_) async {
        calls += 1;
        throw StateError('backend down');
      },
      clock: clock,
    );

    expect(await holder.resolve(), isA<MosaicCustomerTokenUnavailable>());
    expect(await holder.resolve(), isA<MosaicCustomerTokenUnavailable>());
    expect(calls, 1, reason: 'The cooldown must suppress the second attempt.');

    now = now.add(mosaicCustomerTokenFailureCooldown);
    await holder.resolve();
    expect(calls, 2);
  });

  test('a second forced refresh on one generation refuses instead of storming',
      () async {
    var calls = 0;
    final holder = MosaicCustomerTokenHolder(
      provider: (_) async {
        calls += 1;
        return token('token-$calls');
      },
      clock: clock,
    );

    await holder.resolve();
    final generation = holder.tokenGeneration;
    // First 401: force one refresh and retry.
    expect(
      await holder.resolve(forceRefresh: true, observedGeneration: generation),
      isA<MosaicCustomerTokenResolved>(),
    );
    expect(calls, 2);

    // A second 401 against that same freshly minted token is a real failure.
    final exhausted = await holder.resolve(
      forceRefresh: true,
      observedGeneration: holder.tokenGeneration,
    );
    expect(calls, 2);
    expect(
      exhausted,
      isA<MosaicCustomerTokenUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'entitlements.token.refresh_exhausted',
      ),
    );
  });

  test('a refresh another caller already performed is not repeated', () async {
    var calls = 0;
    final holder = MosaicCustomerTokenHolder(
      provider: (_) async {
        calls += 1;
        return token('token-$calls');
      },
      clock: clock,
    );

    await holder.resolve();
    final stale = holder.tokenGeneration;
    await holder.resolve(forceRefresh: true, observedGeneration: stale);
    expect(calls, 2);

    // A concurrent request that was still using the old token now reports its
    // 401. The token it complained about is already gone.
    expect(
      await holder.resolve(forceRefresh: true, observedGeneration: stale),
      isA<MosaicCustomerTokenResolved>(),
    );
    expect(calls, 2);
  });

  test('the token value never reaches diagnostics or a string form', () async {
    final holder = MosaicCustomerTokenHolder(
      provider: (_) async => token('token-visible'),
      clock: clock,
    );
    final resolution = await holder.resolve() as MosaicCustomerTokenResolved;

    expect(resolution.token.toString(), isNot(contains('mcat_')));
    final diagnostics = holder.diagnostics;
    expect(diagnostics.tokenId, 'token-visible');
    expect(diagnostics.toString(), isNot(contains('mcat_')));
  });

  test('no configured provider is unavailable rather than an error', () async {
    final holder = MosaicCustomerTokenHolder(provider: null, clock: clock);
    expect(
      await holder.resolve(),
      isA<MosaicCustomerTokenUnavailable>().having(
        (value) => value.reasonCode,
        'reasonCode',
        'entitlements.token.no_provider',
      ),
    );
  });
}

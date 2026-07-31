import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  test('decodes the canonical RevenueCat sidecar with exact mappings', () {
    final source = _fixtureSource('revenuecat-configuration.json');
    final release = _releaseFor(source);

    final envelope = const MosaicCommerceConfigurationDecoder().decode(
      source,
      expectedRelease: release,
      expectedApplicationId: 'application_ios',
      expectedStorePlatform: MosaicStorePlatform.ios,
    );

    expect(envelope.version, '1');
    expect(envelope.configuration.activeProvider.identity.id, 'revenuecat');
    expect(
      envelope.configuration
          .mappingForProduct('product_pro_monthly')!
          .adapterMapping,
      isA<MosaicDirectProductMapping>(),
    );
    expect(
      envelope.configuration
          .mappingForProduct('product_pro_yearly')!
          .adapterMapping,
      isA<MosaicRevenueCatPackageMapping>(),
    );
  });

  test('decodes canonical native-store v2 mappings without changing v1', () {
    final storeKit = _v2FixtureSource('storekit-configuration.json');
    final storeKitEnvelope = const MosaicCommerceConfigurationDecoder().decode(
      storeKit,
      expectedRelease: _releaseFor(storeKit),
      expectedApplicationId: 'application_ios',
      expectedStorePlatform: MosaicStorePlatform.ios,
    );
    expect(storeKitEnvelope.version, '2');
    expect(
      storeKitEnvelope.configuration.activeProvider.activation,
      isA<MosaicNativeStoreProviderActivation>(),
    );
    expect(
      storeKitEnvelope.configuration
          .mappingForProduct('mosaic_pro_monthly')!
          .adapterMapping,
      isA<MosaicStoreKitProductMapping>(),
    );

    final google = _v2FixtureSource('google-play-configuration.json');
    final googleEnvelope = const MosaicCommerceConfigurationDecoder().decode(
      google,
      expectedRelease: _releaseFor(google),
      expectedApplicationId: 'application_android',
      expectedStorePlatform: MosaicStorePlatform.android,
    );
    final monthly =
        googleEnvelope.configuration.mappingForProduct('mosaic_pro_monthly')!;
    expect(monthly.entitlementKeys, <String>['pro']);
    expect(
      monthly.adapterMapping,
      isA<MosaicGooglePlayProductMapping>()
          .having((value) => value.basePlanId, 'base plan', 'monthly')
          .having((value) => value.offerId, 'offer', 'intro_7_day'),
    );
    expect(
      googleEnvelope.configuration.activeProvider.recoveryMode,
      MosaicCommerceRecoveryMode.activePurchaseRecovery,
    );
  });

  test('rejects unknown fields, digest changes, and release mismatches', () {
    final source = _fixtureSource('revenuecat-configuration.json');
    final release = _releaseFor(source);
    final unknown = jsonDecode(source) as Map<String, Object?>;
    (unknown['configuration']! as Map<String, Object?>)['apiKey'] = 'forbidden';

    expect(
      () => const MosaicCommerceConfigurationDecoder().decode(
        jsonEncode(unknown),
        expectedRelease: release,
        expectedApplicationId: 'application_ios',
        expectedStorePlatform: MosaicStorePlatform.ios,
      ),
      throwsA(isA<MosaicCommerceConfigurationException>()),
    );

    final changed = jsonDecode(source) as Map<String, Object?>;
    final products = (changed['configuration']!
        as Map<String, Object?>)['productMappings']! as List<Object?>;
    (products.first as Map<String, Object?>)['providerProductReference'] =
        'different.product';
    expect(
      () => const MosaicCommerceConfigurationDecoder().decode(
        jsonEncode(changed),
        expectedRelease: release,
        expectedApplicationId: 'application_ios',
        expectedStorePlatform: MosaicStorePlatform.ios,
      ),
      throwsA(isA<MosaicCommerceConfigurationException>()),
    );

    expect(
      () => const MosaicCommerceConfigurationDecoder().decode(
        source,
        expectedRelease: release,
        expectedApplicationId: 'another_application',
        expectedStorePlatform: MosaicStorePlatform.ios,
      ),
      throwsA(isA<MosaicCommerceConfigurationException>()),
    );
  });

  test('hosted transport revalidates only an exact retained sidecar pair',
      () async {
    final source = _fixtureSource('revenuecat-configuration.json');
    final release = _releaseFor(source);
    final contentDigest =
        ((jsonDecode(source) as Map<String, Object?>)['configuration']!
            as Map<String, Object?>)['contentDigest']! as String;
    final exactEtag = '"$contentDigest"';
    final receivedIfNoneMatch = <String?>[];
    String? acceptedVersions;
    String? acceptedContractVersions;
    String? accept;
    var responseIndex = 0;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      receivedIfNoneMatch.add(
        request.headers.value(HttpHeaders.ifNoneMatchHeader),
      );
      acceptedVersions ??=
          request.headers.value('Mosaic-Commerce-Configuration-Versions');
      acceptedContractVersions ??=
          request.headers.value('Mosaic-Commerce-Provider-Contract-Versions');
      accept ??= request.headers.value(HttpHeaders.acceptHeader);
      responseIndex += 1;
      if (responseIndex == 2) {
        request.response
          ..statusCode = HttpStatus.notModified
          ..headers.set(HttpHeaders.etagHeader, exactEtag)
          ..headers.set('Mosaic-Configuration-Release-Id', release.id);
      } else {
        request.response
          ..statusCode = HttpStatus.ok
          ..headers.set(
            HttpHeaders.contentTypeHeader,
            responseIndex == 4
                ? '$mosaicCommerceConfigurationContentType;charset=utf-8'
                : mosaicCommerceConfigurationContentType,
          )
          ..headers.set('Mosaic-Configuration-Release-Id', release.id)
          ..headers.set(
            HttpHeaders.etagHeader,
            responseIndex == 3
                ? '"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'
                : exactEtag,
          )
          ..write(source);
      }
      await request.response.close();
    });
    final transport = MosaicIoCommerceConfigurationLoader(
      baseUrl: Uri.parse('http://${server.address.host}:${server.port}'),
      publicSdkKey: 'mos_public_sdk_test.secret',
      applicationId: 'application_ios',
      storePlatform: MosaicStorePlatform.ios,
      timeout: const Duration(seconds: 2),
    );

    final first = await transport.fetch(
      MosaicCommerceConfigurationRequest(release: release),
    );
    expect(first, isA<MosaicCommerceConfigurationUpdatedResponse>());
    final updated = first as MosaicCommerceConfigurationUpdatedResponse;
    expect(updated.etag, exactEtag);
    expect(receivedIfNoneMatch.single, isNull);
    expect(acceptedVersions, '2,1');
    expect(acceptedContractVersions, '2,1');
    expect(accept, mosaicCommerceConfigurationAccept);

    final second = await transport.fetch(
      MosaicCommerceConfigurationRequest(
        release: release,
        retained: MosaicRetainedCommerceConfiguration(
          source: updated.source,
          etag: updated.etag,
        ),
      ),
    );
    expect(second, isA<MosaicCommerceConfigurationNotModifiedResponse>());
    expect(receivedIfNoneMatch[1], exactEtag);

    expect(
      await transport.fetch(
        MosaicCommerceConfigurationRequest(release: release),
      ),
      isA<MosaicCommerceConfigurationFailedResponse>(),
      reason: 'The 200 ETag must equal configuration.contentDigest.',
    );
    expect(
      await transport.fetch(
        MosaicCommerceConfigurationRequest(release: release),
      ),
      isA<MosaicCommerceConfigurationFailedResponse>(),
      reason: 'Content-Type matching is exact.',
    );
  });

  test('hosted transport rejects 304 without a valid retained pair', () async {
    final source = _fixtureSource('revenuecat-configuration.json');
    final release = _releaseFor(source);
    String? receivedIfNoneMatch;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      receivedIfNoneMatch =
          request.headers.value(HttpHeaders.ifNoneMatchHeader);
      request.response.statusCode = HttpStatus.notModified;
      await request.response.close();
    });
    final transport = MosaicIoCommerceConfigurationLoader(
      baseUrl: Uri.parse('http://${server.address.host}:${server.port}'),
      publicSdkKey: 'mos_public_sdk_test.secret',
      applicationId: 'application_ios',
      storePlatform: MosaicStorePlatform.ios,
      timeout: const Duration(seconds: 2),
    );

    expect(
      await transport.fetch(
        MosaicCommerceConfigurationRequest(
          release: release,
          retained: const MosaicRetainedCommerceConfiguration(
            source: '{}',
            etag:
                '"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
          ),
        ),
      ),
      isA<MosaicCommerceConfigurationFailedResponse>(),
    );
    expect(receivedIfNoneMatch, isNull);
  });
}

String _fixtureSource(String name) {
  var directory = Directory.current.absolute;
  while (true) {
    final file = File(
      '${directory.path}/protocol/fixtures/commerce-configuration/v1/$name',
    );
    if (file.existsSync()) return file.readAsStringSync();
    if (directory.parent.path == directory.path) {
      throw StateError('Cannot locate Commerce Configuration fixtures.');
    }
    directory = directory.parent;
  }
}

String _v2FixtureSource(String name) {
  var directory = Directory.current.absolute;
  while (true) {
    final file = File(
      '${directory.path}/protocol/fixtures/commerce-configuration/v2/$name',
    );
    if (file.existsSync()) return file.readAsStringSync();
    if (directory.parent.path == directory.path) {
      throw StateError('Cannot locate Commerce Configuration v2 fixtures.');
    }
    directory = directory.parent;
  }
}

MosaicConfigurationRelease _releaseFor(String sidecarSource) {
  final root = jsonDecode(sidecarSource) as Map<String, Object?>;
  final configuration = root['configuration']! as Map<String, Object?>;
  final association =
      configuration['configurationRelease']! as Map<String, Object?>;
  final productMappings = configuration['productMappings']! as List<Object?>;
  final productReferences = <String, MosaicDeliveredProductReference>{};
  for (final raw in productMappings) {
    final mapping = raw! as Map<String, Object?>;
    final id = mapping['mosaicProductId']! as String;
    productReferences[id] = MosaicDeliveredProductReference(
      id: id,
      type: id.contains('lifetime')
          ? MosaicDeliveredProductType.oneTimeNonConsumable
          : MosaicDeliveredProductType.subscription,
      fallbackDisplayName: id,
    );
  }
  return MosaicConfigurationRelease(
    id: association['id']! as String,
    number: 42,
    environment: MosaicDeliveredEnvironment(
      id: configuration['environmentId']! as String,
      key: 'test',
    ),
    publishedAt: '2026-07-23T12:00:00Z',
    contentDigest: association['contentDigest']! as String,
    requiredCapabilities: const <MosaicRequiredCapability>[],
    placements: const <String, String>{},
    paywallVersions: const <String, MosaicDeliveredPaywallVersion>{},
    productReferences: productReferences,
    assetReferences: const <String, MosaicDeliveredAssetReference>{},
  );
}

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import 'analytics.dart';
import 'analytics_event.dart';
import 'commerce.dart';
import 'commerce_configuration.dart';
import 'commerce_configuration_transport.dart';
import 'configuration_cache.dart';
import 'configuration_client.dart';
import 'configuration_transport.dart';
import 'experiment_analytics.dart';
import 'experiment_assignment_store.dart';
import 'placement_decision.dart';
import 'placement_identity.dart';
import 'presentation.dart';
import 'protocol.dart';
import 'transaction_observation.dart';
import 'transaction_observation_transport.dart';

/// Immutable settings captured when a Mosaic client is configured.
final class MosaicConfiguration {
  MosaicConfiguration({
    String? publicSdkKey,
    String? apiKey,
    Uri? baseUrl,
    Uri? endpoint,
    String? applicationVersion,
    String? applicationId,
    MosaicStorePlatform? storePlatform,
    this.requestTimeout = const Duration(seconds: 5),
  })  : publicSdkKey = _validateKey(publicSdkKey ?? apiKey),
        baseUrl = _validateBaseUrl(baseUrl ?? endpoint),
        applicationVersion = _validateApplicationVersion(applicationVersion),
        applicationId = applicationId == null
            ? null
            : _validateApplicationId(applicationId),
        storePlatform = storePlatform {
    if (requestTimeout <= Duration.zero ||
        requestTimeout > const Duration(seconds: 30)) {
      throw const MosaicConfigurationException(
        'requestTimeout must be between zero and 30 seconds.',
      );
    }
  }

  /// Environment-scoped public SDK key supplied by the host application.
  final String publicSdkKey;

  /// Compatibility alias for clients configured before hosted delivery.
  String get apiKey => publicSdkKey;

  /// Hosted or self-hosted Mosaic base URL.
  final Uri? baseUrl;

  /// Compatibility alias for the original configuration API.
  Uri? get endpoint => baseUrl;

  final String? applicationVersion;
  final String? applicationId;
  final MosaicStorePlatform? storePlatform;
  final Duration requestTimeout;

  static String _validateKey(String? value) {
    final normalized = value?.trim() ?? '';
    if (normalized.isEmpty) {
      throw const MosaicConfigurationException(
        'publicSdkKey must not be empty.',
      );
    }
    return normalized;
  }

  static Uri? _validateBaseUrl(Uri? value) {
    if (value == null) return null;
    final validScheme = value.scheme == 'https' ||
        value.scheme == 'http' && _isLocalDevelopmentHost(value.host);
    if (!validScheme ||
        value.host.isEmpty ||
        value.userInfo.isNotEmpty ||
        value.hasQuery ||
        value.hasFragment) {
      throw const MosaicConfigurationException(
        'baseUrl must be HTTPS, or local-development HTTP, without credentials, query, or fragment.',
      );
    }
    return value;
  }

  static String? _validateApplicationVersion(String? value) {
    if (value == null) return null;
    if (value.isEmpty ||
        value.length > 64 ||
        value.runes.any((rune) => rune < 0x20 || rune == 0x7f)) {
      throw const MosaicConfigurationException(
        'applicationVersion is invalid.',
      );
    }
    return value;
  }

  static String _validateApplicationId(String value) {
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$').hasMatch(value)) {
      throw const MosaicConfigurationException(
        'applicationId is invalid.',
      );
    }
    return value;
  }

  static bool _isLocalDevelopmentHost(String host) {
    final normalized = host.toLowerCase();
    if (normalized == 'localhost' ||
        normalized.endsWith('.localhost') ||
        normalized == '::1') {
      return true;
    }
    final octets = normalized.split('.').map(int.tryParse).toList();
    if (octets.length != 4 || octets.any((value) => value == null)) {
      return false;
    }
    final values = octets.cast<int>();
    if (values.any((value) => value < 0 || value > 255)) return false;
    return values[0] == 127 ||
        values[0] == 10 ||
        values[0] == 192 && values[1] == 168 ||
        values[0] == 172 && values[1] >= 16 && values[1] <= 31;
  }
}

/// An isolated Mosaic SDK client with cache-first hosted configuration state.
final class Mosaic extends ChangeNotifier with WidgetsBindingObserver {
  Mosaic._({
    required this.configuration,
    required this.purchaseProvider,
    required MosaicConfigurationClient? configurationClient,
    required MosaicIdentityController identityController,
    MosaicAnalyticsRuntime? analyticsRuntime,
    MosaicCommerceProviderRouter? commerceProviderRouter,
    MosaicExperimentAnalyticsSink? experimentAnalyticsSink,
    MosaicExperimentAssignmentStore? experimentAssignmentStore,
    MosaicTransactionObservationRuntime? transactionObservationRuntime,
  })  : _configurationClient = configurationClient,
        _identityController = identityController,
        _analyticsRuntime = analyticsRuntime,
        _experimentAnalyticsSink = experimentAnalyticsSink,
        _experimentAssignmentStore = experimentAssignmentStore,
        _transactionObservationRuntime = transactionObservationRuntime,
        _commerceProviderRouter = commerceProviderRouter {
    _observeLifecycleIfAvailable();
    _observeCommerceUpdates();
  }

  /// Bridges asynchronous Commerce Provider updates into the observation queue.
  /// This is the primary source: it also covers store-replayed renewals and
  /// out-of-band purchases that the renderer never sees.
  void _observeCommerceUpdates() {
    final runtime = _transactionObservationRuntime;
    final router = _commerceProviderRouter;
    if (runtime == null || router == null) return;
    _commerceUpdateSubscription = router.commerceUpdates.listen((update) {
      // Phase 9A observes a completed purchase only. Every other outcome,
      // including pending and entitlement changes, stays on the device.
      if (update.outcome != MosaicCommerceUpdateOutcome.purchased) return;
      runtime.observeProviderUpdate(
        transactionReference: update.transactionReference,
        providerOrderReference: update.providerOrderReference,
        observedAt: update.occurredAt,
      );
    });
  }

  factory Mosaic.configure({
    String? publicSdkKey,
    String? apiKey,
    Uri? baseUrl,
    Uri? endpoint,
    String? applicationVersion,
    String? applicationId,
    MosaicStorePlatform? storePlatform,
    Duration requestTimeout = const Duration(seconds: 5),
    MosaicPurchaseProvider? purchaseProvider,
    Iterable<MosaicCommerceProviderFactory> commerceProviderFactories =
        const <MosaicCommerceProviderFactory>[],
    MosaicConfigurationTransport transport =
        const MosaicIoConfigurationTransport(),
    MosaicConfigurationCache cache = const MosaicFileConfigurationCache(),
    MosaicIdentityStorage identityStorage = const MosaicFileIdentityStorage(),
    MosaicAnalyticsStorage analyticsStorage =
        const MosaicFileAnalyticsStorage(),
    MosaicAnalyticsTransport? analyticsTransport,
    MosaicAnalyticsEnvironmentSettings analyticsEnvironmentSettings =
        const MosaicAnalyticsEnvironmentSettings(collectionEnabled: false),
    bool analyticsHostEnabled = true,
    String analyticsSdkVersion = mosaicFlutterSdkVersion,
    String? operatingSystemVersion,
    String? locale,
    MosaicBundledConfigurationLoader? bundledFallbackLoader,
    MosaicCommerceConfigurationLoader? commerceConfigurationLoader,
    MosaicCommerceConfigurationTransport? commerceConfigurationTransport,
    MosaicCommerceConfigurationLoader? bundledCommerceConfigurationLoader,
    MosaicDiagnosticCallback? onDiagnostic,
    MosaicExperimentAnalyticsSink? experimentAnalyticsSink,
    MosaicExperimentAssignmentStorage experimentAssignmentStorage =
        const MosaicFileExperimentAssignmentStorage(),
    MosaicTransactionObservationSettings? transactionObservation,
    MosaicTransactionObservationStorage transactionObservationStorage =
        const MosaicFileTransactionObservationStorage(),
    MosaicTransactionObservationTransport? transactionObservationTransport,
  }) {
    final factories = commerceProviderFactories.toList(growable: false);
    final router = factories.isEmpty
        ? null
        : MosaicCommerceProviderRouter(
            factories: factories,
            fallbackProvider: purchaseProvider,
          );
    final resolvedPurchaseProvider = router ?? purchaseProvider;
    if (resolvedPurchaseProvider == null) {
      throw const MosaicConfigurationException(
        'A purchase Provider or commerce Provider factory is required.',
      );
    }
    final configuration = MosaicConfiguration(
      publicSdkKey: publicSdkKey,
      apiKey: apiKey,
      baseUrl: baseUrl,
      endpoint: endpoint,
      applicationVersion: applicationVersion,
      applicationId: applicationId,
      storePlatform: storePlatform,
      requestTimeout: requestTimeout,
    );
    final resolvedBaseUrl = configuration.baseUrl;
    final resolvedCommerceTransport = commerceConfigurationTransport ??
        (commerceConfigurationLoader == null &&
                resolvedBaseUrl != null &&
                configuration.applicationId != null &&
                configuration.storePlatform != null
            ? MosaicIoCommerceConfigurationLoader(
                baseUrl: resolvedBaseUrl,
                publicSdkKey: configuration.publicSdkKey,
                applicationId: configuration.applicationId!,
                storePlatform: configuration.storePlatform!,
                timeout: configuration.requestTimeout,
              )
            : null);
    final identityController = MosaicIdentityController(
      storage: identityStorage,
      namespace: mosaicIdentityNamespace(
        resolvedBaseUrl ?? Uri.parse('mosaic://local'),
        configuration.publicSdkKey,
      ),
    );
    final resolvedAnalyticsTransport = analyticsTransport ??
        (resolvedBaseUrl == null
            ? null
            : MosaicIoAnalyticsTransport(
                baseUrl: resolvedBaseUrl,
                publicSdkKey: configuration.publicSdkKey,
                timeout: configuration.requestTimeout,
              ));
    final runtime = resolvedAnalyticsTransport == null
        ? null
        : MosaicAnalyticsRuntime.acquire(
            namespace: mosaicAnalyticsNamespace(
              resolvedBaseUrl!,
              configuration.publicSdkKey,
            ),
            identityController: identityController,
            context: MosaicAnalyticsContext(
              platform: _analyticsPlatform,
              sdkVersion: analyticsSdkVersion,
              operatingSystemVersion: operatingSystemVersion,
              applicationVersion: configuration.applicationVersion,
              locale: locale,
            ),
            transport: resolvedAnalyticsTransport,
            storage: analyticsStorage,
            environmentEnabled: analyticsEnvironmentSettings.collectionEnabled,
            hostEnabled: analyticsHostEnabled,
          );
    // Off by default: absent opt-in means the subsystem is never constructed,
    // so nothing is observed, queued, persisted, or submitted. A Store Platform
    // is required because it determines the contract's reference kind; without
    // one the handoff stays disabled rather than guessing.
    final resolvedStorePlatform = configuration.storePlatform;
    final resolvedObservationTransport = transactionObservationTransport ??
        (resolvedBaseUrl == null
            ? null
            : MosaicIoTransactionObservationTransport(
                baseUrl: resolvedBaseUrl,
                publicSdkKey: configuration.publicSdkKey,
                timeout: configuration.requestTimeout,
              ));
    final observationRuntime = transactionObservation == null ||
            resolvedStorePlatform == null ||
            resolvedObservationTransport == null
        ? null
        : MosaicTransactionObservationRuntime(
            namespace: mosaicTransactionObservationNamespace(
              resolvedBaseUrl ?? Uri.parse('mosaic://local'),
              configuration.publicSdkKey,
            ),
            transport: resolvedObservationTransport,
            storePlatform: resolvedStorePlatform,
            settings: transactionObservation,
            storage: transactionObservationStorage,
          );
    return Mosaic._(
      configuration: configuration,
      purchaseProvider: resolvedPurchaseProvider,
      transactionObservationRuntime: observationRuntime,
      identityController: identityController,
      analyticsRuntime: runtime,
      configurationClient: resolvedBaseUrl == null
          ? null
          : MosaicConfigurationClient(
              baseUrl: resolvedBaseUrl,
              publicSdkKey: configuration.publicSdkKey,
              applicationVersion: configuration.applicationVersion,
              applicationId: configuration.applicationId,
              storePlatform: configuration.storePlatform,
              transport: transport,
              cache: cache,
              timeout: configuration.requestTimeout,
              bundledFallbackLoader: bundledFallbackLoader,
              commerceConfigurationLoader: commerceConfigurationLoader,
              commerceConfigurationTransport: resolvedCommerceTransport,
              bundledCommerceConfigurationLoader:
                  bundledCommerceConfigurationLoader,
              onAcceptedConfiguration: router == null
                  ? null
                  : (accepted) {
                      final commerce = accepted.commerceEnvelope?.configuration;
                      if (commerce == null) {
                        router.deactivate();
                        return;
                      }
                      router.activate(
                        commerceConfiguration: commerce,
                        configurationRelease: accepted.envelope.release,
                      );
                    },
              onDiagnostic: onDiagnostic,
            ),
      commerceProviderRouter: router,
      experimentAnalyticsSink: experimentAnalyticsSink ?? runtime,
      experimentAssignmentStore: resolvedBaseUrl == null
          ? null
          : MosaicExperimentAssignmentStore(
              storage: experimentAssignmentStorage,
              namespace: mosaicExperimentAssignmentNamespace(
                resolvedBaseUrl,
                configuration.publicSdkKey,
              ),
            ),
    );
  }

  final MosaicConfiguration configuration;
  final MosaicPurchaseProvider purchaseProvider;
  final MosaicConfigurationClient? _configurationClient;
  final MosaicIdentityController _identityController;
  final MosaicAnalyticsRuntime? _analyticsRuntime;
  final MosaicExperimentAnalyticsSink? _experimentAnalyticsSink;
  final MosaicExperimentAssignmentStore? _experimentAssignmentStore;
  final MosaicCommerceProviderRouter? _commerceProviderRouter;
  final MosaicTransactionObservationRuntime? _transactionObservationRuntime;
  StreamSubscription<MosaicCommerceUpdate>? _commerceUpdateSubscription;
  bool _observingLifecycle = false;

  void _observeLifecycleIfAvailable() {
    if (_observingLifecycle) return;
    try {
      WidgetsBinding.instance.addObserver(this);
      _observingLifecycle = true;
    } on FlutterError {
      // A pure Dart host may configure before Flutter initializes. The first
      // configuration load retries registration from the widget lifecycle.
    }
  }

  MosaicAcceptedConfiguration? get acceptedConfiguration =>
      _configurationClient?.accepted;

  MosaicCommerceConfiguration? get acceptedCommerceConfiguration =>
      acceptedConfiguration?.commerceEnvelope?.configuration;

  MosaicIdentityState? get identity => _identityController.current;
  MosaicAnalyticsRuntime? get analytics => _analyticsRuntime;
  MosaicExperimentAnalyticsSink? get experimentAnalytics =>
      _experimentAnalyticsSink;
  MosaicExperimentAssignmentStore? get experimentAssignmentStore =>
      _experimentAssignmentStore;
  MosaicAnalyticsCapabilityReport get analyticsCapabilityReport =>
      MosaicAnalyticsCapabilityReport();

  /// Loads or creates the stable app-install-scoped anonymous identity.
  Future<MosaicIdentityState> loadIdentity() => _identityController.load();

  /// Sets the host application's user identity. This may intentionally change
  /// assignments for Rule Sets using an identified-user policy.
  Future<MosaicIdentityState> identify(String userId) async {
    final previous = await _identityController.load();
    final result = await _identityController.identify(userId);
    await _analyticsRuntime?.identityDidChange(
      effectiveUserChange: previous.userId != result.userId,
    );
    notifyListeners();
    return result;
  }

  /// Atomically replaces typed user attributes after validating the active
  /// release's allow-list wherever definitions are available.
  Future<MosaicIdentityState> setUserAttributes(
    Map<String, MosaicAttributeValue> attributes,
  ) async {
    final definitions = <String, MosaicAttributeDefinition>{};
    for (final decision
        in acceptedConfiguration?.envelope.release.placementDecisions.values ??
            const Iterable<MosaicPlacementRuleSet>.empty()) {
      definitions.addAll(decision.attributeDefinitions);
    }
    for (final entry in attributes.entries) {
      final definition = definitions[entry.key];
      if (definitions.isNotEmpty && definition == null) {
        throw ArgumentError.value(entry.key, 'attributes',
            'Attribute is not allowed by the accepted release.');
      }
      if (definition is MosaicAttributeDefinition &&
          !mosaicAttributeMatchesDefinition(definition.type, entry.value)) {
        throw ArgumentError.value(entry.value, entry.key,
            'Attribute type does not match the accepted definition.');
      }
    }
    final result = await _identityController.setAttributes(attributes);
    notifyListeners();
    return result;
  }

  /// Clears user identity and attributes while retaining installation identity.
  Future<MosaicIdentityState> resetUserIdentity() async {
    final previous = await _identityController.load();
    final result = await _identityController.resetUser();
    await _analyticsRuntime?.identityDidChange(
      effectiveUserChange:
          previous.userId != null || previous.attributes.isNotEmpty,
    );
    notifyListeners();
    return result;
  }

  /// Rotates installation identity and clears all user-bound state.
  Future<MosaicIdentityState> resetInstallationIdentity() async {
    final result = await _identityController.rotateInstallation();
    await _analyticsRuntime?.identityDidChange(effectiveUserChange: true);
    notifyListeners();
    return result;
  }

  /// Public alias matching the cross-platform Phase 6 identity contract.
  Future<MosaicIdentityState> resetIdentity() => resetUserIdentity();

  Future<void> setAnalyticsCollection({
    required bool environmentEnabled,
    bool hostEnabled = true,
  }) async =>
      _analyticsRuntime?.setCollection(
        environment: MosaicAnalyticsEnvironmentSettings(
          collectionEnabled: environmentEnabled,
        ),
        hostEnabled: hostEnabled,
      );

  Future<MosaicAnalyticsFlushResult> flushAnalytics() async {
    final runtime = _analyticsRuntime;
    return runtime == null
        ? const MosaicAnalyticsFlushDisabled()
        : await runtime.flush();
  }

  Future<MosaicAnalyticsDiagnostics> analyticsDiagnostics() async {
    final runtime = _analyticsRuntime;
    return runtime == null
        ? const MosaicAnalyticsDiagnostics(
            collectionEnabled: false,
            queuedEvents: 0,
            queuedBytes: 0,
            droppedEvents: 0,
            expiredEvents: 0,
            permanentlyRejectedEvents: 0,
            retryableEvents: 0,
            attemptsExhaustedEvents: 0,
          )
        : await runtime.diagnostics();
  }

  /// The renderer's fire-and-forget observation sink, or `null` when the
  /// opt-in is absent. It exposes no way to read a validation outcome, because
  /// a Transaction Observation is a trigger and never proof.
  MosaicTransactionObservationSink? get transactionObservations =>
      _transactionObservationRuntime;

  /// Host consent switch for the Transaction Observation handoff. Turning it
  /// off clears the queue and deletes the persisted document.
  Future<void> setTransactionObservation({required bool hostEnabled}) async =>
      _transactionObservationRuntime?.setCollection(hostEnabled: hostEnabled);

  Future<MosaicTransactionObservationFlushResult>
      flushTransactionObservations() async {
    final runtime = _transactionObservationRuntime;
    return runtime == null
        ? const MosaicTransactionObservationFlushDisabled()
        : await runtime.flush();
  }

  Future<MosaicTransactionObservationDiagnostics>
      transactionObservationDiagnostics() async {
    final runtime = _transactionObservationRuntime;
    return runtime == null
        ? const MosaicTransactionObservationDiagnostics(
            enabled: false,
            queued: 0,
            queuedBytes: 0,
            deduplicated: 0,
            dropped: 0,
            expired: 0,
            rejectedReferences: 0,
            permanentlyRejected: 0,
            retryable: 0,
            attemptsExhausted: 0,
          )
        : await runtime.diagnostics();
  }

  MosaicConfigurationCapabilityRequest get capabilityRequest =>
      MosaicConfigurationCapabilityRequest(
        applicationVersion: configuration.applicationVersion,
      );

  /// Loads the last-known-valid cache, then the bundled Delivery v1 fallback.
  /// This method never performs networking.
  Future<MosaicConfigurationLoadResult> loadConfiguration() async {
    _observeLifecycleIfAvailable();
    final client = _configurationClient;
    if (client == null) {
      return const MosaicConfigurationUnavailable(
        diagnosticCode: 'configuration.baseUrl.missing',
      );
    }
    final previous = client.accepted;
    final result = await client.load();
    if (!identical(previous, client.accepted)) notifyListeners();
    return result;
  }

  /// Manually refreshes hosted configuration. Concurrent callers coalesce.
  Future<MosaicConfigurationRefreshResult> refreshConfiguration() async {
    final client = _configurationClient;
    if (client == null) {
      return const MosaicConfigurationRefreshUnavailable(
        diagnosticCode: 'configuration.baseUrl.missing',
      );
    }
    final previous = client.accepted;
    final result = await client.refresh();
    if (!identical(previous, client.accepted)) notifyListeners();
    return result;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _configurationClient != null) {
      // The client coalesces concurrent refreshes; presentation continues from
      // the accepted snapshot while emergency-stop updates are fetched.
      unawaited(refreshConfiguration());
    }
  }

  @override
  void dispose() {
    if (_observingLifecycle) WidgetsBinding.instance.removeObserver(this);
    unawaited(_commerceUpdateSubscription?.cancel());
    _commerceUpdateSubscription = null;
    if (_transactionObservationRuntime case final runtime?) {
      unawaited(runtime.disposeRuntime().catchError((Object _) {}));
    }
    _commerceProviderRouter?.deactivate();
    if (_analyticsRuntime case final runtime?) {
      // Disposal must never surface storage failures as uncaught zone errors.
      unawaited(runtime.release().catchError((Object _) {}));
    }
    super.dispose();
  }
}

String get _analyticsPlatform => switch (defaultTargetPlatform) {
      TargetPlatform.iOS => 'ios',
      _ => 'android',
    };

final class MosaicConfigurationException implements Exception {
  const MosaicConfigurationException(this.message);

  final String message;

  @override
  String toString() => 'MosaicConfigurationException: $message';
}

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
import 'customer_authentication.dart';
import 'customer_entitlement_cache.dart';
import 'customer_entitlement_runtime.dart';
import 'customer_entitlement_transport.dart';
import 'customer_entitlements.dart';
import 'customer_restore_sync.dart';
import 'experiment_analytics.dart';
import 'experiment_assignment_store.dart';
import 'locale_tag.dart';
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
    MosaicCustomerEntitlementRuntime? customerEntitlementRuntime,
    MosaicDiagnosticCallback? onDiagnostic,
  })  : _onDiagnostic = onDiagnostic,
        _configurationClient = configurationClient,
        _customerEntitlements = customerEntitlementRuntime,
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
    if (router == null) return;
    if (runtime == null) {
      final entitlements = _customerEntitlements;
      if (entitlements == null) return;
      _commerceUpdateSubscription = router.commerceUpdates.listen((update) {
        if (update.outcome == MosaicCommerceUpdateOutcome.purchased) {
          entitlements.refreshInBackground();
        }
      });
      return;
    }
    _commerceUpdateSubscription = router.commerceUpdates.listen((update) {
      // Phase 9A observes a completed purchase only. Every other outcome,
      // including pending and entitlement changes, stays on the device.
      if (update.outcome != MosaicCommerceUpdateOutcome.purchased) return;
      // Authoritative state moves server-side once validation lands. The
      // refresh is unawaited so it can never delay or alter a purchase.
      _customerEntitlements?.refreshInBackground();
      runtime.observeProviderUpdate(
        providerId: update.providerId,
        transactionReference: update.transactionReference,
        providerOrderReference: update.providerOrderReference,
        mosaicProductId: update.mosaicProductId,
        providerOperationId: update.operationId,
        providerUpdateId: update.updateId,
        observedAt: update.occurredAt,
      );
    });
  }

  /// Configures an isolated Mosaic client.
  ///
  /// Analytics collection is **on by default**: a client configured with a base
  /// URL (or an explicit [analyticsTransport]) wires the analytics runtime and
  /// begins queueing Mosaic's own product events. Hosts opt *out* by passing
  /// `analyticsEnvironmentSettings: MosaicAnalyticsEnvironmentSettings(
  /// collectionEnabled: false)` or `analyticsHostEnabled: false`, or later by
  /// calling [setAnalyticsCollection]; disabling clears anything already
  /// queued. The host application remains responsible for obtaining whatever
  /// end-user consent its jurisdiction and app-store policies require before
  /// leaving collection enabled. Collection is additionally gated server-side:
  /// the Environment's collection setting must also be enabled for Mosaic to
  /// ingest what the SDK sends.
  ///
  /// Transaction observation stays opt-in and is unaffected by this default.
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
    // On by default. Hosts opt out here or through `setAnalyticsCollection`;
    // the Environment's server-side setting still gates ingestion.
    MosaicAnalyticsEnvironmentSettings analyticsEnvironmentSettings =
        const MosaicAnalyticsEnvironmentSettings(collectionEnabled: true),
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
    MosaicCustomerTokenProvider? customerTokenProvider,
    MosaicCustomerEntitlementCache? customerEntitlementCache,
    MosaicCustomerEntitlementTransport? customerEntitlementTransport,
    MosaicCustomerEntitlementSettings customerEntitlementSettings =
        const MosaicCustomerEntitlementSettings(),
    DateTime Function() clock = _utcNow,
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
      onDiagnostic: onDiagnostic,
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
              // Hosts pass whatever their platform produced. An unnormalized
              // POSIX or ICU-keyword identifier fails the closed locale codec,
              // and the event codec rejects the whole event, so a single bad
              // shape would drop all analytics on the affected devices.
              locale: mosaicNormalizeLocaleTag(locale),
            ),
            transport: resolvedAnalyticsTransport,
            storage: analyticsStorage,
            environmentEnabled: analyticsEnvironmentSettings.collectionEnabled,
            hostEnabled: analyticsHostEnabled,
            onDiagnostic: onDiagnostic,
          );
    // Authoritative entitlements require an application backend to mint a
    // Customer Access Token. Without a token provider the subsystem is never
    // constructed, and every authoritative read reports unavailable rather
    // than guessing.
    final customerEntitlements =
        customerTokenProvider == null || resolvedBaseUrl == null
            ? null
            : MosaicCustomerEntitlementRuntime(
                baseUrl: resolvedBaseUrl,
                publicSdkKey: configuration.publicSdkKey,
                transport: customerEntitlementTransport ??
                    const MosaicIoCustomerEntitlementTransport(),
                cache: customerEntitlementCache ??
                    MosaicFileCustomerEntitlementCache(),
                tokenProvider: customerTokenProvider,
                applicationId: configuration.applicationId,
                platform: _customerAuthorityPlatform,
                applicationVersion: configuration.applicationVersion,
                settings: customerEntitlementSettings,
                timeout: configuration.requestTimeout,
                clock: clock,
                onDiagnostic: onDiagnostic == null
                    ? null
                    : (code, {required bool severe}) => onDiagnostic(
                          MosaicDiagnostic(
                            code: code,
                            severity: severe
                                ? MosaicDiagnosticSeverity.error
                                : MosaicDiagnosticSeverity.warning,
                            message: severe
                                ? 'Authoritative entitlement state was cleared.'
                                : 'Authoritative entitlement state is '
                                    'unconfirmed.',
                          ),
                        ),
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
                // Read at send time, so a token minted after the purchase
                // still binds it, and a signed-out submission simply omits the
                // header rather than waiting for one.
                customerToken: customerEntitlements == null
                    ? null
                    : customerEntitlements.currentCustomerTokenForSubmission,
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
            context: MosaicTransactionObservationContext(
              platform: resolvedStorePlatform.wireValue,
              sdkVersion: analyticsSdkVersion,
              applicationVersion: configuration.applicationVersion,
              operatingSystemVersion: operatingSystemVersion,
            ),
            settings: transactionObservation,
            storage: transactionObservationStorage,
            onDiagnostic: onDiagnostic,
          );
    // A subsystem that quietly resolves to null looks identical to a subsystem
    // that is working: no analytics arrive, no commerce configuration loads, no
    // observation is submitted, and nothing says why. Each one that could not be
    // auto-wired is named once here, at configuration time.
    void reportDisabled(String subsystem, String code, String requirement) {
      onDiagnostic?.call(
        MosaicDiagnostic(
          code: code,
          message: '$subsystem is disabled because $requirement.',
          severity: MosaicDiagnosticSeverity.warning,
        ),
      );
    }

    if (resolvedBaseUrl == null) {
      reportDisabled(
        'Hosted configuration',
        'configuration.subsystem.disabled',
        'no base URL was resolved',
      );
    }
    if (runtime == null) {
      reportDisabled(
        'Analytics',
        'analytics.subsystem.disabled',
        analyticsTransport == null && resolvedBaseUrl == null
            ? 'no base URL and no analytics transport were provided'
            : 'no analytics transport could be constructed',
      );
    }
    if (resolvedCommerceTransport == null &&
        commerceConfigurationLoader == null) {
      reportDisabled(
        'Commerce configuration delivery',
        'commerce.configuration.subsystem.disabled',
        'a base URL, an Application, and a Store Platform are all required',
      );
    }
    if (transactionObservation != null && observationRuntime == null) {
      reportDisabled(
        'Transaction observation',
        'transactions.subsystem.disabled',
        resolvedStorePlatform == null
            ? 'no Store Platform was configured'
            : 'no observation transport could be constructed',
      );
    }
    if (customerTokenProvider != null && customerEntitlements == null) {
      reportDisabled(
        'Authoritative entitlements',
        'entitlements.subsystem.disabled',
        'no base URL was resolved',
      );
    }
    return Mosaic._(
      onDiagnostic: onDiagnostic,
      configuration: configuration,
      purchaseProvider: resolvedPurchaseProvider,
      customerEntitlementRuntime: customerEntitlements,
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
  final MosaicCustomerEntitlementRuntime? _customerEntitlements;
  final MosaicDiagnosticCallback? _onDiagnostic;
  final Set<String> _reportedDiagnosticCodes = <String>{};
  MosaicTransactionObservationSink? _purchaseSink;
  StreamSubscription<MosaicCommerceUpdate>? _commerceUpdateSubscription;
  bool _observingLifecycle = false;

  /// Reports one SDK diagnostic to the host at most once per code.
  ///
  /// Extensions on [Mosaic] outside this file use it to surface assumptions and
  /// degraded subsystems that would otherwise be invisible.
  void diagnoseOnce(String code, String message) =>
      _diagnoseOnce(code, message);

  void _diagnoseOnce(String code, String message) {
    if (!_reportedDiagnosticCodes.add(code)) return;
    _onDiagnostic?.call(
      MosaicDiagnostic(
        code: code,
        message: message,
        severity: MosaicDiagnosticSeverity.warning,
      ),
    );
  }

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
  Future<MosaicIdentityState> loadIdentity() async {
    final state = await _identityController.load();
    await _customerEntitlements?.bindIdentity(state);
    return state;
  }

  /// Sets the host application's user identity. This may intentionally change
  /// assignments for Rule Sets using an identified-user policy.
  Future<MosaicIdentityState> identify(String userId) async {
    final previous = await _identityController.load();
    final result = await _identityController.identify(userId);
    await _analyticsRuntime?.identityDidChange(
      effectiveUserChange: previous.userId != result.userId,
    );
    // Bumps the generation, cancels in-flight work, and clears authoritative
    // state before any read can observe it. Installation identity is
    // preserved: it is Phase 6 state and it is evidence, never an anchor.
    await _customerEntitlements?.bindIdentity(result);
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
    if (definitions.isEmpty && attributes.isNotEmpty) {
      // No accepted release means no allow-list to check against. The
      // attributes are still stored so targeting works once a release lands,
      // but the host is told that nothing validated them, rather than being
      // left to assume they passed.
      _diagnoseOnce(
        'identity.attributes.unvalidated',
        'No accepted release declares attribute definitions, so user '
            'attributes were stored without allow-list validation.',
      );
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
    // Signing out discards the token and the cached snapshot together.
    await _customerEntitlements?.clearCustomer();
    notifyListeners();
    return result;
  }

  /// Rotates installation identity and clears all user-bound state.
  Future<MosaicIdentityState> resetInstallationIdentity() async {
    final result = await _identityController.rotateInstallation();
    await _analyticsRuntime?.identityDidChange(effectiveUserChange: true);
    await _customerEntitlements?.clearCustomer();
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
  MosaicTransactionObservationSink? get transactionObservations {
    final runtime = _transactionObservationRuntime;
    final entitlements = _customerEntitlements;
    if (entitlements == null) return runtime;
    // The renderer's purchase path is also where authoritative state becomes
    // stale. Decorating the sink hooks it without the renderer knowing that
    // authoritative entitlements exist.
    return _purchaseSink ??= _MosaicPurchaseSignalSink(
      delegate: runtime,
      onPurchaseObserved: entitlements.refreshInBackground,
    );
  }

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
            incomplete: 0,
            permanentlyRejected: 0,
            retryable: 0,
            attemptsExhausted: 0,
          )
        : await runtime.diagnostics();
  }

  // ---------------------------------------------------------------------
  // Authoritative entitlements
  // ---------------------------------------------------------------------

  /// Mosaic's authoritative view of what the signed-in Billing Customer may
  /// access, or `null` when no Customer Access Token provider is configured.
  ///
  /// This is deliberately separate from the provider-observed entitlements a
  /// Commerce Provider reports. Provider-observed state answers "what did the
  /// store just tell this device"; authoritative state answers "what has
  /// Mosaic validated, and why".
  MosaicCustomerEntitlementRuntime? get customerEntitlements =>
      _customerEntitlements;

  /// Sealed transitions of authoritative state, including the `Cleared` events
  /// an identity change produces.
  Stream<MosaicCustomerEntitlementUpdate> get customerEntitlementUpdates =>
      _customerEntitlements?.updates ??
      const Stream<MosaicCustomerEntitlementUpdate>.empty();

  /// Replaying authority stream. It contains only the accepted authority
  /// boundary and never exposes a Customer Access Token or provider payload.
  Stream<MosaicCustomerAuthority> get customerAuthorityUpdates =>
      _customerEntitlements?.authorityUpdates ??
      const Stream<MosaicCustomerAuthority>.empty();

  MosaicCustomerAuthority? get customerAuthority =>
      _customerEntitlements?.authority;

  /// Answers one access question from memory. It performs no I/O and never
  /// returns a bare boolean.
  MosaicCustomerEntitlementCheck checkCustomerEntitlement(
    String entitlementKey,
  ) {
    final runtime = _customerEntitlements;
    if (runtime == null) {
      // Billing disabled maps to unavailable on every surface, never inactive.
      return MosaicCustomerEntitlementCheck(
        entitlementKey: entitlementKey,
        state: MosaicCustomerAccessState.unavailable,
        cacheState: MosaicEntitlementCacheState.missing,
        sourceCount: 0,
        endKnown: false,
        isStale: false,
        isTestSource: false,
        reasonCode: 'entitlements.disabled',
      );
    }
    return runtime.checkCustomerEntitlement(entitlementKey);
  }

  Future<MosaicCustomerEntitlementRefreshResult>
      refreshCustomerEntitlements() async {
    final runtime = _customerEntitlements;
    return runtime == null
        ? const MosaicCustomerEntitlementUnavailable(
            reasonCode: 'entitlements.disabled',
          )
        : await runtime.refresh();
  }

  /// Urgent authority synchronization used before configuration refreshes at
  /// lifecycle boundaries. This is an additive alias of the coalescing sync.
  Future<MosaicCustomerEntitlementRefreshResult>
      refreshCustomerAuthorityUrgently() => refreshCustomerEntitlements();

  MosaicCustomerEntitlementDiagnostics get customerEntitlementDiagnostics =>
      _customerEntitlements?.diagnostics ??
      const MosaicCustomerEntitlementDiagnostics(
        enabled: false,
        cacheState: MosaicEntitlementCacheState.missing,
        identityGeneration: 0,
        staleGraceSeconds: 0,
        token: MosaicCustomerTokenDiagnostics(
          hasToken: false,
          identityGeneration: 0,
        ),
        lastReasonCode: 'entitlements.disabled',
      );

  /// Restores through the Commerce Provider, hands observations to Mosaic for
  /// validation, and reports what Mosaic can actually confirm.
  ///
  /// It reports `restored` only once an accepted snapshot at a higher version
  /// reflects the restore. A successful native restore whose facts are still
  /// being validated is `validationPending`, which is honest rather than
  /// hopeful.
  Future<MosaicCustomerRestoreResult> restorePurchasesAndSync() async {
    final runtime = _customerEntitlements;
    final requestedAt = DateTime.now().toUtc();
    if (runtime == null) {
      return MosaicCustomerRestoreFailed(
        providerOutcome: MosaicCustomerRestoreProviderOutcome.notAttempted,
        requestedAt: requestedAt,
        stages: const <MosaicCustomerRestoreStage>[],
        uncertainty: MosaicCustomerUncertainty(
          reason: MosaicCustomerUncertaintyReason.projectionFailed,
          since: requestedAt,
          expectedResolution: MosaicCustomerExpectedResolution.customerAction,
        ),
        reasonCode: 'entitlements.disabled',
      );
    }
    return MosaicCustomerRestoreCoordinator(
      purchaseProvider: purchaseProvider,
      entitlements: runtime,
      observations: _transactionObservationRuntime,
    ).restorePurchasesAndSync();
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
    await _validateCustomerAuthorityScope();
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
    await _validateCustomerAuthorityScope();
    if (!identical(previous, client.accepted)) notifyListeners();
    return result;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _configurationClient != null) {
      unawaited(_refreshAuthorityThenConfiguration());
    }
  }

  Future<void> _refreshAuthorityThenConfiguration() async {
    final entitlements = _customerEntitlements;
    if (entitlements != null) {
      // Runtime lifecycle observation may already have started this request;
      // refresh coalescing makes this await the same operation.
      await entitlements.refresh();
    }
    await refreshConfiguration();
  }

  Future<void> _validateCustomerAuthorityScope() async {
    final entitlements = _customerEntitlements;
    final release = _configurationClient?.accepted?.envelope.release;
    if (entitlements == null || release == null) return;
    await entitlements.validateAuthorityScope(
      projectId: release.projectId,
      environmentId: release.environment.id,
    );
  }

  @override
  void dispose() {
    if (_observingLifecycle) WidgetsBinding.instance.removeObserver(this);
    unawaited(_commerceUpdateSubscription?.cancel());
    _commerceUpdateSubscription = null;
    if (_transactionObservationRuntime case final runtime?) {
      unawaited(runtime.disposeRuntime().catchError((Object _) {}));
    }
    _customerEntitlements?.dispose();
    _commerceProviderRouter?.deactivate();
    if (_analyticsRuntime case final runtime?) {
      // Disposal must never surface storage failures as uncaught zone errors.
      unawaited(runtime.release().catchError((Object _) {}));
    }
    super.dispose();
  }
}

DateTime _utcNow() => DateTime.now().toUtc();

MosaicCustomerAuthorityPlatform? get _customerAuthorityPlatform =>
    switch (defaultTargetPlatform) {
      TargetPlatform.iOS => MosaicCustomerAuthorityPlatform.ios,
      TargetPlatform.android => MosaicCustomerAuthorityPlatform.android,
      _ => null,
    };

/// Wraps the renderer's observation sink so a completed purchase also triggers
/// an unawaited authoritative refresh. It returns `void` for the same reason
/// the sink does: a billing handoff can never be awaited from, block, or alter
/// a purchase flow.
final class _MosaicPurchaseSignalSink
    implements MosaicTransactionObservationSink {
  const _MosaicPurchaseSignalSink({
    required this.delegate,
    required this.onPurchaseObserved,
  });

  final MosaicTransactionObservationSink? delegate;
  final void Function() onPurchaseObserved;

  @override
  void observePurchaseResult({
    required String? providerId,
    required String? transactionReference,
    String? providerOrderReference,
    String? mosaicProductId,
    String? purchaseAttemptId,
  }) {
    try {
      delegate?.observePurchaseResult(
        providerId: providerId,
        transactionReference: transactionReference,
        providerOrderReference: providerOrderReference,
        mosaicProductId: mosaicProductId,
        purchaseAttemptId: purchaseAttemptId,
      );
    } finally {
      onPurchaseObserved();
    }
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

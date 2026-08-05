import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mosaic_native_store/mosaic_native_store.dart';
import 'package:mosaic_revenuecat/mosaic_revenuecat.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';
import 'package:purchases_flutter/purchases_flutter.dart' as revenuecat;

const String _previewEndpoint = String.fromEnvironment(
  'MOSAIC_PREVIEW_ENDPOINT',
  defaultValue: 'ws://127.0.0.1:4317/preview',
);
const String _previewSessionId = String.fromEnvironment(
  'MOSAIC_PREVIEW_SESSION_ID',
  defaultValue: 'session_local_01',
);
const String _previewClientId = String.fromEnvironment(
  'MOSAIC_PREVIEW_CLIENT_ID',
  defaultValue: 'client_flutter_example',
);
const String _hostedBaseUrl = String.fromEnvironment(
  'MOSAIC_HOSTED_BASE_URL',
  defaultValue: 'http://127.0.0.1:8080',
);
const String _publicSdkKey = String.fromEnvironment(
  'MOSAIC_PUBLIC_SDK_KEY',
  defaultValue: 'public_example_key',
);
const String _mosaicApplicationId = String.fromEnvironment(
  'MOSAIC_APPLICATION_ID',
  defaultValue: 'application_flutter_example',
);
const bool _commerceEnabled = bool.fromEnvironment('MOSAIC_COMMERCE_ENABLED');
const bool _phase5Demo = bool.fromEnvironment('MOSAIC_PHASE5_DEMO');

/// On by default, exactly as the SDK default is. Opt out with
/// `--dart-define=MOSAIC_ANALYTICS_ENABLED=false`. Ingestion is still gated by
/// the Environment's server-side collection setting, and a real host is
/// responsible for its own end-user consent.
const bool _analyticsEnabled = bool.fromEnvironment(
  'MOSAIC_ANALYTICS_ENABLED',
  defaultValue: true,
);

/// Off by default, exactly as the SDK opt-in is. When absent the Transaction
/// Observation subsystem is never constructed.
const bool _transactionObservationEnabled =
    bool.fromEnvironment('MOSAIC_TRANSACTION_OBSERVATION_ENABLED');
const String _revenueCatPublicSdkKey = String.fromEnvironment(
  'REVENUECAT_PUBLIC_SDK_KEY',
);

/// Stub Customer Access Token. In a real application this value never appears
/// in the client: the host's own backend mints it. Mosaic Billing requires an
/// application backend, so an empty value here means "signed out", which the
/// SDK reports as `unavailable` rather than `inactive`.
const String _customerAccessToken = String.fromEnvironment(
  'MOSAIC_CUSTOMER_ACCESS_TOKEN',
);
const String _customerUserId = String.fromEnvironment(
  'MOSAIC_CUSTOMER_USER_ID',
  defaultValue: 'user_example_0001',
);

var _revenueCatReady = false;

MosaicStorePlatform? get _runtimeStorePlatform =>
    switch (defaultTargetPlatform) {
      TargetPlatform.iOS => MosaicStorePlatform.ios,
      TargetPlatform.android => MosaicStorePlatform.android,
      _ => null,
    };

bool get _connectedCommerceEnabled =>
    _commerceEnabled && _runtimeStorePlatform != null;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (_revenueCatPublicSdkKey.isNotEmpty) {
    try {
      // The example host owns RevenueCat initialization and customer identity.
      await revenuecat.Purchases.configure(
        revenuecat.PurchasesConfiguration(_revenueCatPublicSdkKey),
      );
      _revenueCatReady = true;
    } on Object {
      // Keep the deterministic local Provider available without exposing the
      // RevenueCat key or raw initialization error.
      _revenueCatReady = false;
    }
  }
  runApp(const MosaicFlutterExample());
}

final class MosaicFlutterExample extends StatelessWidget {
  const MosaicFlutterExample({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Mosaic Flutter example',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff007f73),
        ).copyWith(primary: const Color(0xff007f73), surface: Colors.white),
        scaffoldBackgroundColor: Colors.white,
      ),
      home: const MosaicExampleShell(),
    );
  }
}

final class MosaicExampleShell extends StatefulWidget {
  const MosaicExampleShell({super.key});

  @override
  State<MosaicExampleShell> createState() => _MosaicExampleShellState();
}

final class _MosaicExampleShellState extends State<MosaicExampleShell> {
  var _index = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const <Widget>[
          PaywallPlayground(),
          HostedPaywallPlayground(),
          CustomerEntitlementsPlayground(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (index) => setState(() => _index = index),
        destinations: const <NavigationDestination>[
          NavigationDestination(
            icon: Icon(Icons.design_services_outlined),
            selectedIcon: Icon(Icons.design_services),
            label: 'Local preview',
          ),
          NavigationDestination(
            icon: Icon(Icons.cloud_outlined),
            selectedIcon: Icon(Icons.cloud),
            label: 'Hosted',
          ),
          NavigationDestination(
            icon: Icon(Icons.verified_user_outlined),
            selectedIcon: Icon(Icons.verified_user),
            label: 'Customer',
          ),
        ],
      ),
    );
  }
}

final class PaywallPlayground extends StatefulWidget {
  const PaywallPlayground({this.previewClient, super.key});

  final MosaicPreviewClient? previewClient;

  @override
  State<PaywallPlayground> createState() => _PaywallPlaygroundState();
}

final class HostedPaywallPlayground extends StatefulWidget {
  const HostedPaywallPlayground({this.mosaic, super.key});

  final Mosaic? mosaic;

  @override
  State<HostedPaywallPlayground> createState() =>
      _HostedPaywallPlaygroundState();
}

final class _HostedPaywallPlaygroundState
    extends State<HostedPaywallPlayground> {
  late final Mosaic _mosaic;
  late final bool _ownsMosaic;
  var _status = 'Loading cache or bundled release';
  var _lastEvent = 'No presentation event';

  @override
  void initState() {
    super.initState();
    _ownsMosaic = widget.mosaic == null;
    _mosaic = widget.mosaic ?? _createMosaic();
    _mosaic.addListener(_configurationChanged);
    unawaited(_load());
  }

  @override
  void dispose() {
    _mosaic.removeListener(_configurationChanged);
    if (_ownsMosaic) _mosaic.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final accepted = _mosaic.acceptedConfiguration;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mosaic hosted configuration'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh hosted configuration',
            onPressed: () => unawaited(_refresh()),
            icon: const Icon(Icons.cloud_sync_outlined),
          ),
          IconButton(
            tooltip: 'Flush analytics and show safe diagnostics',
            onPressed: () => unawaited(_flushAnalytics()),
            icon: const Icon(Icons.analytics_outlined),
          ),
          if (kDebugMode && _transactionObservationEnabled)
            IconButton(
              tooltip: 'Flush transaction observations and show diagnostics',
              onPressed: () => unawaited(_flushTransactionObservations()),
              icon: const Icon(Icons.receipt_long_outlined),
            ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Material(
            color: Theme.of(context).colorScheme.surfaceContainerLow,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: <Widget>[
                      _StatusChip(
                        icon: Icons.source_outlined,
                        label: accepted == null
                            ? 'Configuration unavailable'
                            : 'Source: ${accepted.source.name}',
                      ),
                      _StatusChip(
                        icon: Icons.publish_outlined,
                        label: accepted == null
                            ? 'Release: none'
                            : 'Release ${accepted.envelope.release.number}',
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _hostedBaseUrl,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  Text(_status, key: const ValueKey('hosted-status')),
                  Text(_lastEvent, key: const ValueKey('hosted-last-event')),
                ],
              ),
            ),
          ),
          Expanded(
            child: MosaicPlacementHost(
              mosaic: _mosaic,
              placementKey: _phase5Demo ? 'export_pdf' : 'onboarding_complete',
              onResult: (result) =>
                  _recordEvent('Presentation: ${result.outcome.wireValue}'),
              onInteraction: (interaction) =>
                  _recordEvent('Interaction: ${interaction.outcome.wireValue}'),
              onDiagnostic: (diagnostic) =>
                  _recordEvent('Diagnostic: ${diagnostic.code}'),
              unavailableBuilder: (context, resolution) => Center(
                child: Text(
                  'Placement unavailable (${resolution.diagnosticCode})',
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Mosaic _createMosaic() => Mosaic.configure(
        publicSdkKey: _publicSdkKey,
        baseUrl: Uri.parse(_hostedBaseUrl),
        applicationVersion: '2.10.0',
        applicationId: !_connectedCommerceEnabled ? null : _mosaicApplicationId,
        storePlatform: _connectedCommerceEnabled ? _runtimeStorePlatform : null,
        purchaseProvider: _fallbackPurchaseProvider(),
        analyticsEnvironmentSettings: MosaicAnalyticsEnvironmentSettings(
          collectionEnabled: _analyticsEnabled,
        ),
        // A Transaction Observation is a trigger for server-side validation.
        // It never unlocks content and never re-labels a purchase result.
        transactionObservation: _transactionObservationEnabled
            ? const MosaicTransactionObservationSettings()
            : null,
        commerceProviderFactories: <MosaicCommerceProviderFactory>[
          MosaicStoreKitProviderFactory(acceptUpdate: _acceptNativeStoreUpdate),
          MosaicGooglePlayProviderFactory(
              acceptUpdate: _acceptNativeStoreUpdate),
          if (_revenueCatReady) const MosaicRevenueCatProviderFactory(),
        ],
        bundledFallbackLoader: () async => rootBundle.loadString(
          _phase5Demo
              ? 'assets/generated/advanced-configuration-release.json'
              : 'assets/generated/configuration-release.json',
        ),
        onDiagnostic: (diagnostic) {
          if (mounted) _recordEvent('Configuration: ${diagnostic.code}');
        },
      );

  Future<MosaicNativeStoreUpdateAcceptanceDisposition> _acceptNativeStoreUpdate(
    MosaicCommerceUpdate update,
  ) async {
    _recordEvent('Commerce update accepted: ${update.updateId}');
    return MosaicNativeStoreUpdateAcceptanceDisposition.accepted;
  }

  Future<void> _load() async {
    final result = await _mosaic.loadConfiguration();
    if (!mounted) return;
    setState(() {
      _status = switch (result) {
        MosaicConfigurationReady(:final configuration) =>
          'Ready from ${configuration.source.name}',
        MosaicConfigurationUnavailable(:final diagnosticCode) =>
          'Unavailable: $diagnosticCode',
      };
    });
  }

  Future<void> _refresh() async {
    if (mounted) setState(() => _status = 'Refreshing hosted release');
    final result = await _mosaic.refreshConfiguration();
    if (!mounted) return;
    setState(() {
      _status = switch (result) {
        MosaicConfigurationUpdated() => 'Accepted hosted release',
        MosaicConfigurationNotModified() => 'Hosted release not modified',
        MosaicConfigurationRetained(:final diagnosticCode) =>
          'Retained last valid release: $diagnosticCode',
        MosaicConfigurationRefreshUnavailable(:final diagnosticCode) =>
          'Unavailable: $diagnosticCode',
      };
    });
  }

  /// Development-only diagnostics. There is deliberately nothing here that
  /// reports a transaction as valid: acceptance means queued, and nothing more.
  Future<void> _flushTransactionObservations() async {
    final result = await _mosaic.flushTransactionObservations();
    final diagnostics = await _mosaic.transactionObservationDiagnostics();
    _recordEvent(
      'Observations ${result.runtimeType}: ${diagnostics.queued} queued, '
      '${diagnostics.deduplicated} deduplicated, '
      '${diagnostics.rejectedReferences} references refused, '
      '${diagnostics.incomplete} incomplete, '
      'last ${diagnostics.lastSafeCode ?? 'none'}',
    );
  }

  Future<void> _flushAnalytics() async {
    final result = await _mosaic.flushAnalytics();
    final diagnostics = await _mosaic.analyticsDiagnostics();
    _recordEvent(
      'Analytics ${result.runtimeType}: ${diagnostics.queuedEvents} queued, '
      '${diagnostics.droppedEvents} dropped',
    );
  }

  void _configurationChanged() {
    if (mounted) setState(() {});
  }

  void _recordEvent(String value) {
    if (mounted) setState(() => _lastEvent = value);
  }
}

final class _PaywallPlaygroundState extends State<PaywallPlayground> {
  late final MosaicPreviewClient _previewClient;
  late final bool _ownsPreviewClient;
  String _lastEvent = 'Waiting for a Studio revision';

  @override
  void initState() {
    super.initState();
    _ownsPreviewClient = widget.previewClient == null;
    _previewClient = widget.previewClient ?? _createPreviewClient();
    if (_ownsPreviewClient) {
      unawaited(_previewClient.connect());
    }
  }

  @override
  void dispose() {
    if (_ownsPreviewClient) {
      _previewClient.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mosaic Flutter preview'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Reconnect preview',
            onPressed: () => unawaited(_previewClient.connect()),
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Disconnect preview',
            onPressed: () => unawaited(_previewClient.disconnect()),
            icon: const Icon(Icons.link_off),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          _PreviewStatusPanel(
            client: _previewClient,
            endpoint: _previewEndpoint,
            sessionId: _previewSessionId,
            lastEvent: _lastEvent,
          ),
          Expanded(
            child: MosaicPreviewPaywall(
              client: _previewClient,
              showBundledFallback: false,
              fallbackPurchaseProvider: _fallbackPurchaseProvider(),
              // Empty host mappings prove protocol-owned media fallback.
              imageResolver: (logicalKey) => null,
              videoResolver: (logicalKey) => null,
              onResult: (result) =>
                  _recordEvent('Presentation: ${result.outcome.wireValue}'),
              onInteraction: (interaction) =>
                  _recordEvent('Interaction: ${interaction.outcome.wireValue}'),
              onDiagnostic: (diagnostic) =>
                  _recordEvent('Diagnostic: ${diagnostic.code}'),
            ),
          ),
        ],
      ),
    );
  }

  void _recordEvent(String value) {
    if (!mounted) {
      return;
    }
    setState(() {
      _lastEvent = value;
    });
  }

  MosaicPreviewClient _createPreviewClient() {
    final platformName = defaultTargetPlatform.name;
    return MosaicPreviewClient(
      configuration: MosaicPreviewClientConfiguration(
        endpoint: Uri.parse(_previewEndpoint),
        sessionId: _previewSessionId,
        identity: MosaicPreviewClientIdentity(
          clientId: _previewClientId,
          displayName: 'Flutter example preview',
          renderer: MosaicPreviewSoftwareIdentity(
            id: 'mosaic.flutter',
            version: mosaicFlutterSdkVersion,
          ),
          application: MosaicPreviewApplicationIdentity(
            id: 'mosaic.flutter.example',
            displayName: 'Mosaic Flutter Example',
            version: '0.2.0',
          ),
          device: MosaicPreviewDeviceIdentity(
            displayName: 'Flutter $platformName preview',
            systemName: platformName,
            systemVersion: 'local',
          ),
        ),
      ),
      onDiagnostic: (diagnostic) =>
          _recordEvent('Connection: ${diagnostic.code}'),
    );
  }
}

final class _PreviewStatusPanel extends StatelessWidget {
  const _PreviewStatusPanel({
    required this.client,
    required this.endpoint,
    required this.sessionId,
    required this.lastEvent,
  });

  final MosaicPreviewClient client;
  final String endpoint;
  final String sessionId;
  final String lastEvent;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: client,
      builder: (context, _) {
        final status = client.connectionStatus;
        final issue = client.draftIssue;
        final preview = client.previewContextForRendering;
        final commerce = client.mockCommerceState;
        return Material(
          color: Theme.of(context).colorScheme.surfaceContainerLow,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: <Widget>[
                    _StatusChip(
                      key: const ValueKey<String>('connection-status'),
                      icon: _connectionIcon(status),
                      label: _connectionLabel(status),
                      color: _connectionColor(context, status),
                    ),
                    _StatusChip(
                      icon: Icons.commit,
                      label: client.liveRevision == null
                          ? 'Waiting for design'
                          : 'Revision ${client.liveRevision!.sequence}',
                    ),
                    _StatusChip(
                      icon: Icons.translate,
                      label: preview == null
                          ? 'Locale: default'
                          : 'Locale: ${preview.locale}',
                    ),
                    _StatusChip(
                      icon: Icons.text_fields,
                      label: preview == null
                          ? 'Text: 1×'
                          : 'Text: ${preview.textScale}×',
                    ),
                    _StatusChip(
                      key: const ValueKey<String>('mock-purchase-state'),
                      icon: Icons.shopping_bag_outlined,
                      label: commerce == null
                          ? 'Mock purchase: waiting'
                          : 'Mock purchase: ${commerce.purchaseOutcome.name}',
                    ),
                    _StatusChip(
                      icon: Icons.verified_user_outlined,
                      label: commerce?.entitlement.isActive ?? false
                          ? 'Entitlement: active'
                          : 'Entitlement: none',
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '$endpoint  •  $sessionId',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  lastEvent,
                  key: const ValueKey<String>('last-event'),
                  style: Theme.of(context).textTheme.labelMedium,
                ),
                if (issue != null) ...<Widget>[
                  const SizedBox(height: 8),
                  _DraftIssueBanner(issue: issue),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  static String _connectionLabel(MosaicPreviewConnectionStatus status) =>
      switch (status) {
        MosaicPreviewConnectionStatus.connected => 'Connected',
        MosaicPreviewConnectionStatus.connecting => 'Connecting',
        MosaicPreviewConnectionStatus.reconnecting => 'Reconnecting',
        MosaicPreviewConnectionStatus.disconnected => 'Disconnected',
      };

  static IconData _connectionIcon(MosaicPreviewConnectionStatus status) =>
      switch (status) {
        MosaicPreviewConnectionStatus.connected => Icons.link,
        MosaicPreviewConnectionStatus.connecting => Icons.sync,
        MosaicPreviewConnectionStatus.reconnecting => Icons.sync_problem,
        MosaicPreviewConnectionStatus.disconnected => Icons.link_off,
      };

  static Color _connectionColor(
    BuildContext context,
    MosaicPreviewConnectionStatus status,
  ) =>
      switch (status) {
        MosaicPreviewConnectionStatus.connected => Colors.green.shade800,
        MosaicPreviewConnectionStatus.connecting ||
        MosaicPreviewConnectionStatus.reconnecting =>
          Colors.orange.shade900,
        MosaicPreviewConnectionStatus.disconnected => Theme.of(
            context,
          ).colorScheme.error,
      };
}

final class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.icon,
    required this.label,
    this.color,
    super.key,
  });

  final IconData icon;
  final String label;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: label,
      child: Chip(
        avatar: Icon(icon, size: 16, color: color),
        label: Text(label, style: TextStyle(color: color)),
        visualDensity: VisualDensity.compact,
      ),
    );
  }
}

final class _DraftIssueBanner extends StatelessWidget {
  const _DraftIssueBanner({required this.issue});

  final MosaicPreviewDraftIssue issue;

  @override
  Widget build(BuildContext context) {
    final label = switch (issue.kind) {
      MosaicPreviewDraftIssueKind.invalidDocument => 'Invalid document',
      MosaicPreviewDraftIssueKind.unsupportedComponent =>
        'Unsupported component',
      MosaicPreviewDraftIssueKind.renderFailure => 'Render failure',
    };
    return Semantics(
      liveRegion: true,
      container: true,
      label: '$label. ${issue.message} ${issue.recovery.message}',
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.error_outline,
                color: Theme.of(context).colorScheme.onErrorContainer,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      label,
                      key: const ValueKey<String>('preview-draft-issue'),
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    Text(issue.message),
                    Text(
                      issue.recovery.message,
                      style: Theme.of(context).textTheme.labelMedium,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

MockMosaicPurchaseProvider _fallbackPurchaseProvider() {
  return MockMosaicPurchaseProvider(
    products: const <MosaicProduct>[
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Mosaic Pro Monthly',
        localizedPrice: r'$5.99',
        localizedPeriod: 'month',
      ),
      MosaicProduct(
        id: 'mosaic_pro_yearly',
        title: 'Mosaic Pro Yearly',
        localizedPrice: r'$49.99',
        localizedPeriod: 'year',
      ),
      MosaicProduct(
        id: 'mosaic_pro_lifetime',
        title: 'Mosaic Pro Lifetime',
        localizedPrice: r'$149.99',
      ),
    ],
  );
}

/// Phase 9C: authority-aware access. Provider-observed and Mosaic-projected
/// entitlements stay separate; the accepted epoch chooses one targeting source.
final class CustomerEntitlementsPlayground extends StatefulWidget {
  const CustomerEntitlementsPlayground({super.key});

  @override
  State<CustomerEntitlementsPlayground> createState() =>
      _CustomerEntitlementsPlaygroundState();
}

final class _CustomerEntitlementsPlaygroundState
    extends State<CustomerEntitlementsPlayground> {
  static const String _entitlementKey = 'pro';

  late final Mosaic _mosaic = Mosaic.configure(
    publicSdkKey: _publicSdkKey,
    baseUrl: Uri.parse(_hostedBaseUrl),
    applicationId: _mosaicApplicationId,
    applicationVersion: '4.2.0',
    purchaseProvider: _fallbackPurchaseProvider(),
    // The host's backend mints this. The stub reads a --dart-define so the
    // example can be run against a real Environment without shipping a secret.
    customerTokenProvider: (request) async {
      if (_customerAccessToken.isEmpty || request.userId == null) return null;
      return MosaicCustomerToken(
        value: _customerAccessToken,
        tokenId: 'example-token',
        expiresAt: DateTime.now().toUtc().add(const Duration(minutes: 55)),
      );
    },
  );

  final List<String> _log = <String>[];
  MosaicCustomerRestoreResult? _restore;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    _mosaic.addListener(_onChanged);
    unawaited(_mosaic.loadIdentity());
  }

  @override
  void dispose() {
    _mosaic
      ..removeListener(_onChanged)
      ..dispose();
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  void _record(String message) {
    if (!mounted) return;
    setState(() {
      _log.insert(0, message);
      if (_log.length > 12) _log.removeLast();
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _identify() => _run(() async {
        await _mosaic.identify(_customerUserId);
        _record('Identified $_customerUserId.');
        await _refresh();
      });

  Future<void> _signOut() => _run(() async {
        await _mosaic.resetUserIdentity();
        _record('Signed out. Token and cache cleared.');
      });

  Future<void> _refresh() async {
    final result = await _mosaic.refreshCustomerEntitlements();
    _record(switch (result) {
      MosaicCustomerEntitlementUpdated(:final snapshot) =>
        'Accepted snapshot v${snapshot.snapshotVersion}.',
      MosaicCustomerEntitlementUnchanged(:final snapshotVersion) =>
        'Unchanged at v$snapshotVersion; freshness slid.',
      MosaicCustomerEntitlementRejected(
        :final reasonCode,
        :final cacheAction
      ) =>
        'Rejected: $reasonCode (cache ${cacheAction.name}).',
      MosaicCustomerEntitlementUnavailable(:final reasonCode) =>
        'Unavailable: $reasonCode.',
    });
  }

  Future<void> _restorePurchases() => _run(() async {
        final result = await _mosaic.restorePurchasesAndSync();
        if (!mounted) return;
        setState(() => _restore = result);
        _record(
          'Restore: ${result.outcome.wireValue} '
          '(provider ${result.providerOutcome.wireValue}).',
        );
      });

  @override
  Widget build(BuildContext context) {
    final check = _mosaic.checkCustomerEntitlement(_entitlementKey);
    final diagnostics = _mosaic.customerEntitlementDiagnostics;
    return Scaffold(
      appBar: AppBar(title: const Text('Authoritative entitlements')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _AccessCard(check: check),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                FilledButton.icon(
                  onPressed: _busy ? null : _identify,
                  icon: const Icon(Icons.login),
                  label: const Text('Identify'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _signOut,
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _run(_refresh),
                  icon: const Icon(Icons.sync),
                  label: const Text('Refresh'),
                ),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _restorePurchases,
                  icon: const Icon(Icons.restore),
                  label: const Text('Restore and sync'),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _Section(
              title: 'Snapshot',
              rows: <String, String>{
                'Snapshot version':
                    diagnostics.snapshotVersion?.toString() ?? '—',
                'As of': diagnostics.asOf?.toIso8601String() ?? '—',
                'Cache state': diagnostics.cacheState.name,
                'Valid until': diagnostics.validUntil?.toIso8601String() ?? '—',
                'Stale grace': '${diagnostics.staleGraceSeconds}s',
                'Billing customer': diagnostics.billingCustomerId ?? '—',
                'Projection': diagnostics.projectionState?.name ?? '—',
                'Authority epoch':
                    diagnostics.authority?.epoch.toString() ?? '—',
                'Authority kind':
                    diagnostics.authority?.kind.wireValue ?? 'unknown',
                'Transition':
                    diagnostics.authority?.transitionState.wireValue ?? '—',
              },
            ),
            const SizedBox(height: 16),
            _Section(
              title: 'Diagnostics',
              rows: <String, String>{
                'Enabled': diagnostics.enabled ? 'yes' : 'no',
                'Identity generation': '${diagnostics.identityGeneration}',
                // The token handle only. The token value is structurally
                // unavailable to this screen.
                'Token handle': diagnostics.token.tokenId ?? '—',
                'Token expires':
                    diagnostics.token.expiresAt?.toIso8601String() ?? '—',
                'Last reason': diagnostics.lastReasonCode ?? '—',
              },
            ),
            if (_restore case final restore?) ...<Widget>[
              const SizedBox(height: 16),
              _RestoreStages(result: restore),
            ],
            const SizedBox(height: 16),
            _Section(
              title: 'Activity',
              rows: <String, String>{
                for (var index = 0; index < _log.length; index += 1)
                  '${index + 1}': _log[index],
              },
            ),
          ],
        ),
      ),
    );
  }
}

final class _AccessCard extends StatelessWidget {
  const _AccessCard({required this.check});

  final MosaicCustomerEntitlementCheck check;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Four labels, and neither unknown nor unavailable is written as a
    // negative: "Mosaic could not find out" is not "you do not have it".
    final (label, detail, color) = switch (check.state) {
      MosaicCustomerAccessState.active => (
          'Active',
          check.isStale
              ? 'Served from the bounded-grace window; awaiting confirmation.'
              : 'Mosaic has validated a granting source.',
          Colors.green.shade800,
        ),
      MosaicCustomerAccessState.inactive => (
          'Inactive',
          'Mosaic looked and found no qualifying source.',
          theme.colorScheme.onSurfaceVariant,
        ),
      MosaicCustomerAccessState.unknown => (
          'Unknown',
          'Mosaic could not find out. This is not a revocation.',
          Colors.orange.shade900,
        ),
      MosaicCustomerAccessState.unavailable => (
          'Unavailable',
          'Mosaic could not answer. Sign in to read authoritative state.',
          Colors.orange.shade900,
        ),
    };
    return Semantics(
      container: true,
      liveRegion: true,
      label: 'Entitlement ${check.entitlementKey} is $label. $detail',
      child: Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(check.entitlementKey, style: theme.textTheme.labelLarge),
              const SizedBox(height: 4),
              Text(
                label,
                style: theme.textTheme.headlineSmall?.copyWith(color: color),
              ),
              const SizedBox(height: 6),
              Text(detail, style: theme.textTheme.bodyMedium),
              if (check.isStale) ...<Widget>[
                const SizedBox(height: 6),
                Text(
                  'Stale: showing last confirmed access.',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: Colors.orange.shade900,
                  ),
                ),
              ],
              if (check.isTestSource) ...<Widget>[
                const SizedBox(height: 6),
                const Text('Granted by a provider test transaction.'),
              ],
              if (check.reasonCode case final reason?) ...<Widget>[
                const SizedBox(height: 6),
                Text('Reason: $reason', style: theme.textTheme.labelMedium),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

final class _RestoreStages extends StatelessWidget {
  const _RestoreStages({required this.result});

  final MosaicCustomerRestoreResult result;

  @override
  Widget build(BuildContext context) {
    return _Section(
      title: 'Restore stages (${result.outcome.wireValue})',
      rows: <String, String>{
        for (final stage in result.stages) stage.name.name: stage.detail,
      },
    );
  }
}

final class _Section extends StatelessWidget {
  const _Section({required this.title, required this.rows});

  final String title;
  final Map<String, String> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(title, style: theme.textTheme.titleMedium),
        const SizedBox(height: 8),
        if (rows.isEmpty)
          Text('—', style: theme.textTheme.bodyMedium)
        else
          for (final entry in rows.entries)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  SizedBox(
                    width: 150,
                    child: Text(
                      entry.key,
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      entry.value,
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                ],
              ),
            ),
      ],
    );
  }
}

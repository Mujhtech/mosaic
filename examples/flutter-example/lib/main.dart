import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

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

void main() {
  runApp(const MosaicFlutterExample());
}

final class MosaicFlutterExample extends StatelessWidget {
  const MosaicFlutterExample({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Mosaic Flutter local preview',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xff007f73),
        ).copyWith(primary: const Color(0xff007f73), surface: Colors.white),
        scaffoldBackgroundColor: Colors.white,
      ),
      home: const PaywallPlayground(),
    );
  }
}

final class PaywallPlayground extends StatefulWidget {
  const PaywallPlayground({this.previewClient, super.key});

  final MosaicPreviewClient? previewClient;

  @override
  State<PaywallPlayground> createState() => _PaywallPlaygroundState();
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
  ) => switch (status) {
    MosaicPreviewConnectionStatus.connected => Colors.green.shade800,
    MosaicPreviewConnectionStatus.connecting ||
    MosaicPreviewConnectionStatus.reconnecting => Colors.orange.shade900,
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

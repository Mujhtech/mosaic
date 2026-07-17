import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  runApp(const MosaicFlutterExample());
}

final class MosaicFlutterExample extends StatelessWidget {
  const MosaicFlutterExample({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Mosaic Flutter RC1',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff6750a4)),
      ),
      home: const PaywallPlayground(),
    );
  }
}

enum _ProductAvailability { all, monthlyOnly, none }

final class PaywallPlayground extends StatefulWidget {
  const PaywallPlayground({super.key});

  @override
  State<PaywallPlayground> createState() => _PaywallPlaygroundState();
}

final class _PaywallPlaygroundState extends State<PaywallPlayground> {
  MockMosaicPurchaseScenario _purchaseScenario =
      MockMosaicPurchaseScenario.success;
  MockMosaicRestoreScenario _restoreScenario =
      MockMosaicRestoreScenario.success;
  _ProductAvailability _availability = _ProductAvailability.all;
  String _locale = 'en';
  String _lastEvent = 'Waiting for an interaction';

  @override
  Widget build(BuildContext context) {
    final provider = MockMosaicPurchaseProvider(
      products: _productsForAvailability(),
      purchaseScenario: _purchaseScenario,
      restoreScenario: _restoreScenario,
    );
    final mosaic = Mosaic.configure(
      apiKey: 'public_phase1_example',
      purchaseProvider: provider,
    );
    final scenarioKey =
        '${_purchaseScenario.name}-${_restoreScenario.name}-'
        '${_availability.name}-$_locale';

    return Scaffold(
      appBar: AppBar(title: const Text('Mosaic Flutter RC1')),
      body: Column(
        children: <Widget>[
          _controls(context),
          Expanded(
            child: MosaicPaywallHost(
              key: ValueKey<String>(scenarioKey),
              mosaic: mosaic,
              requestedLocale: _locale,
              bundledFallbackLoader: () => rootBundle.loadString(
                'assets/generated/complete-paywall.json',
              ),
              // Deliberately demonstrates the protocol-declared placeholder.
              // A host can instead map mosaic.paywall.hero to AssetImage(...).
              imageResolver: (logicalKey) => null,
              onResult: (result) {
                if (!mounted) {
                  return;
                }
                setState(() {
                  _lastEvent = 'Presentation: ${result.outcome.wireValue}';
                });
              },
              onInteraction: (interaction) {
                if (!mounted) {
                  return;
                }
                setState(() {
                  _lastEvent = 'Interaction: ${interaction.outcome.wireValue}';
                });
              },
              onDiagnostic: (diagnostic) {
                if (!mounted) {
                  return;
                }
                setState(() {
                  _lastEvent = 'Diagnostic: ${diagnostic.code}';
                });
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _controls(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: <Widget>[
                _dropdown<MockMosaicPurchaseScenario>(
                  label: 'Purchase',
                  value: _purchaseScenario,
                  values: MockMosaicPurchaseScenario.values
                      .where(
                        (scenario) =>
                            scenario != MockMosaicPurchaseScenario.automatic,
                      )
                      .toList(growable: false),
                  onChanged: (value) => setState(() {
                    _purchaseScenario = value;
                  }),
                ),
                _dropdown<MockMosaicRestoreScenario>(
                  label: 'Restore',
                  value: _restoreScenario,
                  values: MockMosaicRestoreScenario.values
                      .where(
                        (scenario) =>
                            scenario != MockMosaicRestoreScenario.automatic,
                      )
                      .toList(growable: false),
                  onChanged: (value) => setState(() {
                    _restoreScenario = value;
                  }),
                ),
                _dropdown<_ProductAvailability>(
                  label: 'Products',
                  value: _availability,
                  values: _ProductAvailability.values,
                  onChanged: (value) => setState(() {
                    _availability = value;
                  }),
                ),
                _dropdown<String>(
                  label: 'Locale',
                  value: _locale,
                  values: const <String>['en', 'de', 'ar'],
                  onChanged: (value) => setState(() {
                    _locale = value;
                  }),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              _lastEvent,
              key: const ValueKey<String>('last-event'),
              style: Theme.of(context).textTheme.labelLarge,
            ),
            Text(
              'The hero lookup intentionally uses its declared placeholder.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  Widget _dropdown<T extends Object>({
    required String label,
    required T value,
    required List<T> values,
    required ValueChanged<T> onChanged,
  }) {
    return DropdownButton<T>(
      value: value,
      hint: Text(label),
      items: <DropdownMenuItem<T>>[
        for (final item in values)
          DropdownMenuItem<T>(
            value: item,
            child: Text('$label: ${_displayName(item)}'),
          ),
      ],
      onChanged: (value) {
        if (value != null) {
          onChanged(value);
        }
      },
    );
  }

  String _displayName(Object value) {
    if (value is Enum) {
      return value.name;
    }
    return value.toString();
  }

  List<MosaicProduct> _productsForAvailability() {
    return switch (_availability) {
      _ProductAvailability.all => _mockProducts,
      _ProductAvailability.monthlyOnly => _mockProducts.take(1).toList(),
      _ProductAvailability.none => const <MosaicProduct>[],
    };
  }
}

const List<MosaicProduct> _mockProducts = <MosaicProduct>[
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
];

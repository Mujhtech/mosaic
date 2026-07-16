import 'package:flutter/material.dart';
import 'package:mosaic_sdk/mosaic_sdk.dart';

void main() {
  final mosaic = Mosaic.configure(
    apiKey: 'public_example_key',
    purchaseProvider: MockMosaicPurchaseProvider(
      products: const <MosaicProduct>[
        MosaicProduct(
          id: 'mosaic_pro_yearly',
          title: 'Mosaic Pro Yearly',
          localizedPrice: r'$49.99',
        ),
      ],
    ),
  );
  runApp(MosaicFoundationExample(mosaic: mosaic));
}

final class MosaicFoundationExample extends StatelessWidget {
  const MosaicFoundationExample({required this.mosaic, super.key});

  final Mosaic mosaic;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('Mosaic Phase 0')),
        body: Center(
          child: Text(
            'Configured ${mosaic.configuration.apiKey}. Renderer follows in Phase 1.',
          ),
        ),
      ),
    );
  }
}

part of 'renderer_test.dart';

void _defineRendererVisualTests(
    Directory root,
    MosaicPaywallDocument Function(String) fixture,
    List<MosaicProduct> products) {
  testWidgets('authored typography survives a theme with no mapped style',
      (tester) async {
    // Authored typography used to be applied through `base?.copyWith`, so a
    // host theme whose mapped Material style was null dropped every authored
    // size, weight, and colour and rendered default body text instead.
    final document = fixture('complete-paywall.json');
    await _pump(
      tester,
      document,
      clock: () => DateTime.utc(2030, 12, 30, 23, 59, 59),
      products: products,
      theme: ThemeData(textTheme: const TextTheme()),
    );

    final headline = tester.widget<Text>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-headline')),
        matching: find.byType(Text),
      ),
    );
    expect(headline.style?.fontSize, 32);
    expect(headline.style?.fontWeight, FontWeight.w700);
    expect(headline.style?.color, const Color(0xFF17324D));
  });

  testWidgets('renders the complete canonical fixture with native controls',
      (tester) async {
    final document = fixture('complete-paywall.json');
    await _pump(
      tester,
      document,
      clock: () => DateTime.utc(2030, 12, 30, 23, 59, 59),
      products: products,
    );

    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(find.byType(Switch), findsNWidgets(2));
    expect(find.byType(PageView), findsOneWidget);
    expect(find.text('Yearly'), findsOneWidget);

    await _tapVisible(tester, find.byType(Switch).first);
    await tester.pump();
    expect(find.byType(PageView), findsNothing);
    expect(find.text('1d 0h 0m 0s'), findsOneWidget);
  });

  testWidgets('paints token gradients and native shadows', (tester) async {
    await _pump(tester, fixture('complete-paywall.json'), products: products);

    final decorations = tester
        .widgetList<DecoratedBox>(find.byType(DecoratedBox))
        .map((widget) => widget.decoration)
        .whereType<BoxDecoration>();
    expect(
      decorations.any((decoration) => decoration.gradient is LinearGradient),
      isTrue,
    );
    expect(
      decorations.any((decoration) => decoration.gradient is RadialGradient),
      isTrue,
    );
    expect(
      decorations
          .any((decoration) => decoration.boxShadow?.isNotEmpty ?? false),
      isTrue,
    );
  });

  testWidgets('uses physical clockwise gradient angles without RTL mirroring',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.4/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final designSystem = source['designSystem']! as Map<String, Object?>;
    final backgrounds = designSystem['backgrounds']! as List<Object?>;
    final offerGradient = backgrounds
        .whereType<Map<String, Object?>>()
        .singleWhere((token) => token['id'] == 'offer-gradient');
    final gradient = offerGradient['value']! as Map<String, Object?>;

    Future<LinearGradient> renderAt(double angle) async {
      gradient['angle'] = angle;
      final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
      await _pump(
        tester,
        document,
        products: products,
        requestedLocale: 'ar',
      );
      return tester
          .widgetList<DecoratedBox>(find.byType(DecoratedBox))
          .map((widget) => widget.decoration)
          .whereType<BoxDecoration>()
          .map((decoration) => decoration.gradient)
          .whereType<LinearGradient>()
          .first;
    }

    var painted = await renderAt(0);
    expect((painted.begin as Alignment).x, closeTo(-1, 0.0001));
    expect((painted.begin as Alignment).y, closeTo(0, 0.0001));
    expect((painted.end as Alignment).x, closeTo(1, 0.0001));
    expect((painted.end as Alignment).y, closeTo(0, 0.0001));

    painted = await renderAt(90);
    expect((painted.begin as Alignment).x, closeTo(0, 0.0001));
    expect((painted.begin as Alignment).y, closeTo(-1, 0.0001));
    expect((painted.end as Alignment).x, closeTo(0, 0.0001));
    expect((painted.end as Alignment).y, closeTo(1, 0.0001));

    painted = await renderAt(360);
    expect((painted.begin as Alignment).x, closeTo(-1, 0.0001));
    expect((painted.begin as Alignment).y, closeTo(0, 0.0001));
    expect((painted.end as Alignment).x, closeTo(1, 0.0001));
    expect((painted.end as Alignment).y, closeTo(0, 0.0001));
  });

  testWidgets('unbounded Fill falls back to Fit with full semantics',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.4/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    (_jsonNode(source, 'headline')['sizing']!
        as Map<String, Object?>)['height'] = 'fill';
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final diagnostics = <MosaicDiagnostic>[];
    final semantics = tester.ensureSemantics();

    await _pump(
      tester,
      document,
      products: products,
      onDiagnostic: diagnostics.add,
    );

    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(
      tester
          .getSemantics(
            find.byKey(const ValueKey<String>('mosaic-headline')),
          )
          .label,
      'Unlock every Mosaic Pro feature',
    );
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('layout.unboundedFill'),
    );
    semantics.dispose();
  });

  testWidgets('fixed height clips visuals without truncating semantics',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.4/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    (_jsonNode(source, 'headline')['sizing']!
        as Map<String, Object?>)['height'] = <String, Object?>{
      'mode': 'fixed',
      'value': 8
    };
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final semantics = tester.ensureSemantics();

    await _pump(tester, document, products: products);

    expect(
      tester
          .getSize(
            find.byKey(const ValueKey<String>('mosaic-visibility-headline')),
          )
          .height,
      8,
    );
    expect(
      tester
          .getSemantics(
            find.byKey(const ValueKey<String>('mosaic-headline')),
          )
          .label,
      'Unlock every Mosaic Pro feature',
    );
    semantics.dispose();
  });

  testWidgets('lays out a horizontal Product Selector side by side',
      (tester) async {
    final document = fixture('complete-paywall.json');
    final selector =
        document.nodes.whereType<MosaicProductSelectorComponent>().single;
    expect(selector.direction, MosaicProductSelectorDirection.horizontal);

    await _pump(tester, document, products: products);

    final monthly = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    final yearly = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(monthly.top, closeTo(yearly.top, 0.01));
    expect(monthly.left, lessThan(yearly.left));
    expect(monthly.right, lessThanOrEqualTo(yearly.left));
    expect(monthly.width, closeTo(yearly.width, 0.01));
  });

  testWidgets('expired Countdown shows completed text without a live region',
      (tester) async {
    final document = fixture('expired-countdown.json');
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      document,
      clock: () => DateTime.utc(2031),
      products: products,
    );

    expect(find.text('Complete'), findsOneWidget);
    final node = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-expired-offer-countdown')),
    );
    expect(node.flagsCollection.isLiveRegion, isFalse);
    semantics.dispose();
  });

  testWidgets('hidden Product Selector safely disables purchase and diagnoses',
      (tester) async {
    final diagnostics = <MosaicDiagnostic>[];
    final document = fixture('hidden-purchase-target.json');
    await _pump(
      tester,
      document,
      products: products,
      onDiagnostic: diagnostics.add,
    );

    final purchase = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-purchase')),
        matching: find.byType(InkWell),
      ),
    );
    expect(purchase.onTap, isNull);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('purchase.hiddenProductSelector'),
    );
  });

  testWidgets(
      'navigates forward/back, preserves runtime state, and opens HTTPS externally',
      (tester) async {
    final opened = <Uri>[];
    final diagnostics = <MosaicDiagnostic>[];
    final document = fixture('complete-paywall.json');
    await _pump(
      tester,
      document,
      products: products,
      externalUrlOpener: (url) async {
        opened.add(url);
        return true;
      },
      onDiagnostic: diagnostics.add,
    );

    await _tapVisible(tester, find.byType(Switch).first);
    await tester.pump();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isFalse);

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    final offerOffset = tester
        .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
        .controller!
        .offset;
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.text('Purchase and policy details'), findsOneWidget);
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );

    await tester.tap(
      find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
    );
    await tester.pumpAndSettle();
    expect(opened, <Uri>[Uri.parse('https://example.com/privacy')]);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('background.videoUnavailable'),
    );
    expect(find.text('Purchase and policy details'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey<String>('mosaic-details-back')));
    await tester.pumpAndSettle();
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isFalse);
    expect(
      tester
          .widget<SingleChildScrollView>(find.byType(SingleChildScrollView))
          .controller!
          .offset,
      closeTo(offerOffset, 0.01),
    );
  });

  testWidgets('Sheet back restores the previous Sheet and coherent history',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.4/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final screens = source['screens']! as List<Object?>;
    final details = screens
        .whereType<Map<String, Object?>>()
        .singleWhere((screen) => screen['id'] == 'details');
    final detailsB = jsonDecode(jsonEncode(details))! as Map<String, Object?>;
    _suffixFixtureIds(detailsB, '-b');
    screens.add(detailsB);
    final privacyAction =
        _jsonNode(source, 'privacy-policy')['action']! as Map<String, Object?>;
    privacyAction
      ..clear()
      ..addAll(<String, Object?>{
        'type': 'navigateTo',
        'screenId': 'details-b',
      });
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));

    await _pump(tester, document, products: products);

    Future<void> openSheetB() async {
      await tester.ensureVisible(
        find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
      );
      await tester.tap(
        find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey<String>('mosaic-screen-details-b')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey<String>('mosaic-screen-details')),
        findsNothing,
      );
      expect(find.byType(BottomSheet), findsOneWidget);
    }

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );

    await openSheetB();
    await tester.tap(
      find.byKey(const ValueKey<String>('mosaic-details-back-b')),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details-b')),
      findsNothing,
    );
    expect(find.byType(BottomSheet), findsOneWidget);

    await openSheetB();
    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey<String>('mosaic-screen-details-b')),
      findsNothing,
    );
    expect(find.byType(BottomSheet), findsOneWidget);

    expect(await tester.binding.handlePopRoute(), isTrue);
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
  });

  testWidgets('navigateBack at the initial screen is a diagnostic no-op',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.4/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    (_jsonNode(source, 'close')['action']! as Map<String, Object?>)
      ..clear()
      ..addAll(<String, Object?>{'type': 'navigateBack'});
    final required = (source['compatibility']!
        as Map<String, Object?>)['requiredCapabilities']! as List<Object?>;
    required.removeWhere(
      (entry) => (entry! as Map<String, Object?>)['name'] == 'action.close',
    );
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final diagnostics = <MosaicDiagnostic>[];
    final results = <MosaicPresentationResult>[];
    await _pump(
      tester,
      document,
      products: products,
      onDiagnostic: diagnostics.add,
      onResult: results.add,
    );

    await tester.tap(find.byKey(const ValueKey<String>('mosaic-close')));
    await tester.pump();
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(results, isEmpty);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('navigation.noBackTarget'),
    );
  });

  testWidgets('external URL failure is diagnostic and keeps presentation',
      (tester) async {
    final diagnostics = <MosaicDiagnostic>[];
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: products,
      externalUrlOpener: (_) async => false,
      onDiagnostic: diagnostics.add,
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(const ValueKey<String>('mosaic-privacy-policy')),
    );
    await tester.pumpAndSettle();

    expect(find.text('Purchase and policy details'), findsOneWidget);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('externalUrl.openFailed'),
    );
  });

  testWidgets('Button descendants merge into one semantics control',
      (tester) async {
    final semantics = tester.ensureSemantics();
    await _pump(tester, fixture('complete-paywall.json'), products: products);
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );

    final button = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    expect(button.flagsCollection.isButton, isTrue);
    expect(button.label, 'Review purchase details');
    expect(
      find.bySemanticsLabel('Review purchase details'),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('Button keeps a 48 point target with narrow authored sizing',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.4/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    _jsonNode(source, 'close')['sizing'] = <String, Object?>{
      'width': <String, Object?>{'mode': 'fixed', 'value': 12},
      'height': 'fit',
    };
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    await _pump(tester, document, products: products);

    final target = tester.getSize(
      find.byKey(const ValueKey<String>('mosaic-close')),
    );
    expect(target.width, greaterThanOrEqualTo(48));
    expect(target.height, greaterThanOrEqualTo(48));
  });

  testWidgets('purchase Button swaps busy content and rejects duplicate taps',
      (tester) async {
    final provider = _PendingPurchaseProvider(products);
    final results = <MosaicPresentationResult>[];
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      purchaseProvider: provider,
      onResult: results.add,
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-purchase')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-purchase')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-purchase')));
    await tester.pump();

    expect(provider.purchaseCalls, 1);
    expect(find.text('Processing purchase…'), findsOneWidget);
    expect(find.text('Continue'), findsNothing);

    provider.completePurchase();
    await tester.pumpAndSettle();
    expect(find.text('Continue'), findsOneWidget);
    expect(results, hasLength(1));
    expect(results.single.outcome, MosaicPresentationOutcome.purchased);
  });

  testWidgets('accepted revision resets Switch and Carousel runtime state',
      (tester) async {
    final semantics = tester.ensureSemantics();
    final resetFixture = jsonDecode(
      File(
        '${root.path}/protocol/fixtures/local-preview/v0.4/'
        'accepted-revision-runtime-reset.json',
      ).readAsStringSync(),
    )! as Map<String, Object?>;
    final expected =
        resetFixture['expectedRuntimeAfterAcceptance']! as Map<String, Object?>;
    final source = File(
      '${root.path}/protocol/fixtures/v0.4/complete-paywall.json',
    ).readAsStringSync();
    var document = const MosaicProtocolDecoder().decode(source);
    late StateSetter rebuild;
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: StatefulBuilder(
          builder: (context, setState) {
            rebuild = setState;
            return MosaicPaywall(
              document: document,
              purchaseProvider: MockMosaicPurchaseProvider(products: products),
              clock: () => DateTime.utc(2030, 12, 30),
              onResult: (_) {},
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    await _tapVisible(
      tester,
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    await tester.pump();
    // Guards the acceptance assertion below: if this selection never lands the
    // "resets to yearly" expectation passes for the wrong reason.
    expect(
      tester
          .getSemantics(
            find.byKey(
              const ValueKey<String>('mosaic-plans-monthly-plan-card'),
            ),
          )
          .flagsCollection
          .isSelected,
      Tristate.isTrue,
    );
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 1);
    await _dragVisible(
      tester,
      find.byType(PageView),
      const Offset(700, 0),
    );
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 0);
    await _tapVisible(tester, find.byType(Switch).first);
    await tester.pump();
    expect(tester.widget<Switch>(find.byType(Switch).first).value, isFalse);
    expect(find.byType(PageView), findsNothing);
    await _tapVisible(tester, find.byType(Switch).first);
    await tester.pump();
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 0);
    await _tapVisible(tester, find.byType(Switch).first);
    await tester.pump();
    expect(find.byType(PageView), findsNothing);

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details')),
    );
    await tester.tap(find.byKey(const ValueKey<String>('mosaic-view-details')));
    await tester.pumpAndSettle();
    expect(find.text('Purchase and policy details'), findsOneWidget);

    rebuild(() {
      document = const MosaicProtocolDecoder().decode(source);
    });
    await tester.pump();
    await tester.pump();

    expect(tester.widget<Switch>(find.byType(Switch).first).value, isTrue);
    expect(find.text('Unlock every Mosaic Pro feature'), findsOneWidget);
    expect(find.byType(PageView), findsOneWidget);
    expect(tester.widget<PageView>(find.byType(PageView)).controller!.page, 1);
    // The reset leaves the card below the fold, and an off-screen semantics
    // node does not reliably carry its flags on every platform. Reading the
    // selection flag is only meaningful once the card is on screen.
    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-plans-yearly-plan-card')),
    );
    await tester.pumpAndSettle();
    // The superseded revision's Sheet is not in the reset navigation history,
    // and a modal left standing over the paywall would hold every reset
    // control behind a barrier no screen reader can cross.
    expect(find.text('Purchase and policy details'), findsNothing);
    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    expect(
      (expected['switches']! as Map<String, Object?>)['show-offer-details'],
      isTrue,
    );
    expect(
      (expected['carousels']! as Map<String, Object?>)['offer-highlights'],
      1,
    );
    expect(
      (expected['navigation']! as Map<String, Object?>)['currentScreenId'],
      'offer',
    );
    semantics.dispose();
  });
}

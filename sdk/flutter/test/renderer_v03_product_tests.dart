part of 'renderer_v03_test.dart';

/// Restricts [matching] to the canonical fixture's Product Selector subtree.
///
/// Several product labels are also Tabs labels, so an unscoped text finder
/// would match copy that belongs to a different component.
Finder _inSelector(Finder matching) => find.descendant(
      of: find.byKey(const ValueKey<String>('mosaic-plans')),
      matching: matching,
    );

void _defineRendererV03ProductTests(
    Directory root,
    MosaicPaywallDocument Function(String) fixture,
    List<MosaicProduct> products) {
  test('Selected Product Card recursively inherits absent Default leaves', () {
    final selector = fixture('complete-paywall.json')
        .nodes
        .whereType<MosaicProductSelectorComponent>()
        .single;
    final card = selector.cards.singleWhere(
      (card) => card.id == 'plans-yearly-plan-card',
    );
    final styles = card.styles;
    final selected = styles.resolve(selected: true);

    expect(selected.cornerRadius, styles.defaultStyle.cornerRadius);
    expect(selected.padding.top, styles.defaultStyle.padding.top);
    expect(selected.padding.start, 18);
    expect(selected.opacity, styles.defaultStyle.opacity);

    final badge = card.badge!;
    final selectedBadge = badge.styles.resolve(selected: true);
    final selectedBadgeBackground = selectedBadge.background;
    expect(selectedBadgeBackground, isA<MosaicColorBackground>());
    expect(
      (selectedBadgeBackground as MosaicColorBackground).color.value,
      'action.primary',
    );
    expect(
      selectedBadge.cornerRadius,
      badge.styles.defaultStyle.cornerRadius,
    );
  });

  testWidgets(
      'authored cards interpolate provider data and select by Product Card ID',
      (tester) async {
    final interactions = <MosaicInteraction>[];
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: products,
      onInteraction: interactions.add,
    );

    // 'Monthly' and 'Lifetime' also name Tabs controls in the canonical
    // fixture, so product-card copy is asserted inside the Product Selector.
    expect(_inSelector(find.text('Monthly')), findsOneWidget);
    expect(_inSelector(find.text('Yearly')), findsOneWidget);
    expect(_inSelector(find.text('Lifetime Access')), findsOneWidget);
    expect(find.text(r'$199.99'), findsOneWidget);
    expect(find.text('Best value'), findsOneWidget);
    expect(find.text('Own it forever'), findsOneWidget);

    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    expect(yearly.flagsCollection.isChecked, CheckedState.isTrue);
    expect(yearly.flagsCollection.isInMutuallyExclusiveGroup, isTrue);
    expect(yearly.label, r'Yearly, $79.99, Best value');
    expect(find.bySemanticsLabel('Best value'), findsNothing);

    final monthlyCard = find.byKey(
      const ValueKey<String>('mosaic-plans-monthly-plan-card'),
    );
    await tester.ensureVisible(monthlyCard);
    await tester.pumpAndSettle();
    await tester.tap(monthlyCard);
    await tester.pump();
    final monthly = tester.getSemantics(monthlyCard);
    expect(monthly.flagsCollection.isSelected, Tristate.isTrue);
    expect(interactions.last.productReferenceId, 'monthly-plan');
    semantics.dispose();
  });

  testWidgets(
      'fallback card semantics merge visible passive labels in source order',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.3/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final extraText = _jsonNodeCopy(source, 'offer-page-one-title')
      ..['id'] = 'plans-yearly-semantic-extra';
    final informativeImage = _jsonNodeCopy(source, 'hero')
      ..['id'] = 'plans-yearly-semantic-image'
      ..['sizing'] = <String, Object?>{
        'width': <String, Object?>{'mode': 'fixed', 'value': 1},
        'height': <String, Object?>{'mode': 'fixed', 'value': 1},
      }
      ..remove('aspectRatio');
    final informativeIcon = _jsonNodeCopy(source, 'view-details-icon')
      ..['id'] = 'plans-yearly-semantic-icon'
      ..['accessibility'] = <String, Object?>{
        'hidden': false,
        'label': <String, Object?>{
          'default': 'Restore previous purchases',
          'localizationKey': 'paywall.restore.accessibility',
        },
      };
    final hiddenText = _jsonNodeCopy(source, 'offer-page-two-title')
      ..['id'] = 'plans-yearly-hidden-semantic-text';
    final hiddenStack = <String, Object?>{
      'type': 'stack',
      'id': 'plans-yearly-hidden-semantic-stack',
      'direction': 'vertical',
      'gap': 0,
      'padding': <String, Object?>{
        'top': 0,
        'start': 0,
        'bottom': 0,
        'end': 0,
      },
      'mainAxisDistribution': 'start',
      'crossAxisAlignment': 'stretch',
      'children': <Object?>[hiddenText],
      'visibility': <String, Object?>{'mode': 'hidden'},
    };
    final semanticStack = <String, Object?>{
      'type': 'stack',
      'id': 'plans-yearly-semantic-stack',
      'direction': 'vertical',
      'gap': 0,
      'padding': <String, Object?>{
        'top': 0,
        'start': 0,
        'bottom': 0,
        'end': 0,
      },
      'mainAxisDistribution': 'start',
      'crossAxisAlignment': 'stretch',
      'children': <Object?>[
        extraText,
        informativeImage,
        informativeIcon,
        hiddenStack,
      ],
    };
    final yearly = _jsonNode(source, 'plans-yearly-plan-card');
    (yearly['children']! as List<Object?>).insert(2, semanticStack);
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    final semantics = tester.ensureSemantics();

    await _pump(
      tester,
      document,
      products: products,
      requestedLocale: 'ar',
    );

    const label = r'Yearly, $79.99, '
        'جدار دفع واحد وثلاثة عارضات أصلية, '
        'فسيفساء من شاشات الدفع الأصلية على الهاتف, '
        'استعادة المشتريات السابقة, أفضل قيمة';
    final yearlyFinder = find.byKey(
      const ValueKey<String>('mosaic-plans-yearly-plan-card'),
    );
    final yearlySemantics = tester.getSemantics(yearlyFinder);
    expect(yearlySemantics.label, label);
    expect(yearlySemantics.flagsCollection.isChecked, CheckedState.isTrue);
    expect(find.bySemanticsLabel(label), findsOneWidget);
    expect(
      find.descendant(
        of: yearlyFinder,
        matching:
            find.bySemanticsLabel('فسيفساء من شاشات الدفع الأصلية على الهاتف'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: yearlyFinder,
        matching: find.bySemanticsLabel('استعادة المشتريات السابقة'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: yearlyFinder,
        matching: find.bySemanticsLabel('حدّث من دون إصدار جديد للتطبيق'),
      ),
      findsNothing,
    );
    expect(
      find.descendant(
        of: yearlyFinder,
        matching: find.bySemanticsLabel('أفضل قيمة'),
      ),
      findsNothing,
    );
    expect(
      tester
          .widget<Directionality>(find.byType(Directionality).last)
          .textDirection,
      TextDirection.rtl,
    );
    semantics.dispose();
  });

  testWidgets(
      'missing localized price removes its card and falls back in authored order',
      (tester) async {
    const missingInitialPrice = <MosaicProduct>[
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Provider Monthly',
        localizedPrice: r'$9.99',
      ),
      MosaicProduct(
        id: 'mosaic_pro_yearly',
        title: 'Provider Yearly',
        localizedPrice: null,
      ),
      MosaicProduct(
        id: 'mosaic_pro_lifetime',
        title: '',
        localizedPrice: r'$199.99',
      ),
    ];
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: missingInitialPrice,
    );

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
      findsNothing,
    );
    final monthly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    expect(monthly.flagsCollection.isSelected, Tristate.isTrue);
    expect(find.text('Provider Monthly'), findsOneWidget);
    expect(_inSelector(find.text('Lifetime')), findsOneWidget,
        reason: 'An empty provider title falls back to the reference label.');
    semantics.dispose();
  });

  testWidgets('whitespace-only price removes a price-dependent card',
      (tester) async {
    const whitespacePrice = <MosaicProduct>[
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Provider Monthly',
        localizedPrice: ' \n\t ',
      ),
      MosaicProduct(
        id: 'mosaic_pro_yearly',
        title: 'Provider Yearly',
        localizedPrice: r'$79.99',
      ),
      MosaicProduct(
        id: 'mosaic_pro_lifetime',
        title: 'Provider Lifetime',
        localizedPrice: r'$199.99',
      ),
    ];
    final semantics = tester.ensureSemantics();
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: whitespacePrice,
    );

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
      findsNothing,
    );
    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    semantics.dispose();
  });

  testWidgets('locale changes reconcile an unavailable current card',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.3/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    final monthlyPrice = _jsonNode(
      source,
      'plans-monthly-plan-card-price',
    );
    (monthlyPrice['value']! as Map<String, Object?>)['default'] =
        'Monthly details';
    final localization = source['localization']! as Map<String, Object?>;
    final locales = localization['locales']! as Map<String, Object?>;
    final english = locales['en']! as Map<String, Object?>;
    final englishStrings = english['strings']! as Map<String, Object?>;
    englishStrings['mosaic.migration.product_card_2.price'] = 'Monthly details';
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
    const localeProducts = <MosaicProduct>[
      MosaicProduct(
        id: 'mosaic_pro_monthly',
        title: 'Provider Monthly',
        localizedPrice: null,
      ),
      MosaicProduct(
        id: 'mosaic_pro_yearly',
        title: 'Provider Yearly',
        localizedPrice: r'$79.99',
      ),
      MosaicProduct(
        id: 'mosaic_pro_lifetime',
        title: 'Provider Lifetime',
        localizedPrice: r'$199.99',
      ),
    ];
    final purchaseProvider =
        MockMosaicPurchaseProvider(products: localeProducts);
    var requestedLocale = 'en';
    late StateSetter rebuild;
    final semantics = tester.ensureSemantics();
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
              purchaseProvider: purchaseProvider,
              requestedLocale: requestedLocale,
              onResult: (_) {},
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    await tester.tap(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    await tester.pump();

    rebuild(() => requestedLocale = 'ar');
    await tester.pump();

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
      findsNothing,
    );
    final yearly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-yearly-plan-card'),
      ),
    );
    expect(yearly.flagsCollection.isSelected, Tristate.isTrue);
    final purchase = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-purchase')),
        matching: find.byType(InkWell),
      ),
    );
    expect(purchase.onTap, isNotNull);
    semantics.dispose();
  });

  testWidgets('no available authored card shows fallback and disables Purchase',
      (tester) async {
    final diagnostics = <MosaicDiagnostic>[];
    await _pump(
      tester,
      fixture('complete-paywall.json'),
      products: const <MosaicProduct>[
        MosaicProduct(
          id: 'mosaic_pro_monthly',
          title: 'Monthly',
          localizedPrice: null,
        ),
        MosaicProduct(
          id: 'mosaic_pro_yearly',
          title: 'Yearly',
          localizedPrice: null,
        ),
        MosaicProduct(
          id: 'mosaic_pro_lifetime',
          title: 'Lifetime',
          localizedPrice: null,
        ),
      ],
      onDiagnostic: diagnostics.add,
    );

    expect(find.text('Plans are temporarily unavailable.'), findsOneWidget);
    final purchase = tester.widget<InkWell>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('mosaic-purchase')),
        matching: find.byType(InkWell),
      ),
    );
    expect(purchase.onTap, isNull);
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('product.unavailable'),
    );
  });

  testWidgets(
      'a current unavailable card falls back to first authored card, and says so',
      (tester) async {
    final document = fixture('complete-paywall.json');
    final diagnostics = <MosaicDiagnostic>[];
    MosaicPurchaseProvider provider = MockMosaicPurchaseProvider(
      products: products,
    );
    late StateSetter rebuild;
    final semantics = tester.ensureSemantics();
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
              purchaseProvider: provider,
              onResult: (_) {},
              onDiagnostic: diagnostics.add,
            );
          },
        ),
      ),
    );
    await tester.pump();
    await tester.pump();
    final lifetime = find.byKey(
      const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
    );
    await tester.ensureVisible(lifetime);
    await tester.pumpAndSettle();
    await tester.tap(lifetime);
    await tester.pump();
    // Nothing has been substituted yet: the customer's own choice is available.
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      isNot(contains('product_selection_default_substituted')),
    );

    rebuild(() {
      provider = MockMosaicPurchaseProvider(products: products.take(2));
    });
    await tester.pump();
    await tester.pump();

    expect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
      findsNothing,
    );
    final monthly = tester.getSemantics(
      find.byKey(
        const ValueKey<String>('mosaic-plans-monthly-plan-card'),
      ),
    );
    expect(monthly.flagsCollection.isSelected, Tristate.isTrue);
    // The substitution is sanctioned by `unavailableFallback.selection:
    // firstAvailable`, so the re-point is correct — but the paywall now shows a
    // plan nobody chose, and `product_selected.source` has no value that can
    // say so. Without this diagnostic the swap is invisible to the host, and a
    // conversion drop on a delisted product looks like a copy problem.
    expect(
      diagnostics.map((diagnostic) => diagnostic.code),
      contains('product_selection_default_substituted'),
    );
    expect(
      diagnostics
          .where(
            (diagnostic) =>
                diagnostic.code == 'product_selection_default_substituted',
          )
          .length,
      1,
      reason: 'One substitution per Selector is reported once, not per frame.',
    );
    semantics.dispose();
  });

  testWidgets('vertical selector follows source order and stretches cards',
      (tester) async {
    final source = jsonDecode(
      File('${root.path}/protocol/fixtures/v0.3/complete-paywall.json')
          .readAsStringSync(),
    )! as Map<String, Object?>;
    _jsonNode(source, 'plans')['direction'] = 'vertical';
    final document = const MosaicProtocolDecoder().decode(jsonEncode(source));
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
    final lifetime = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
    );
    expect(monthly.bottom, lessThanOrEqualTo(yearly.top));
    expect(yearly.bottom, lessThanOrEqualTo(lifetime.top));
    expect(monthly.width, closeTo(yearly.width, 0.01));
    expect(yearly.width, closeTo(lifetime.width, 0.01));
  });

  testWidgets('logical topEnd badge anchor mirrors in RTL', (tester) async {
    final document = fixture('complete-paywall.json');
    await _pump(tester, document, products: products);
    final ltrCard = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
    );
    final ltrBadge = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card-badge'),
      ),
    );
    expect(ltrBadge.center.dx, greaterThan(ltrCard.center.dx));

    await _pump(
      tester,
      document,
      products: products,
      requestedLocale: 'ar',
    );
    final rtlCard = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card'),
      ),
    );
    final rtlBadge = tester.getRect(
      find.byKey(
        const ValueKey<String>('mosaic-plans-lifetime-plan-card-badge'),
      ),
    );
    expect(rtlBadge.center.dx, lessThan(rtlCard.center.dx));
  });

  testWidgets('Arabic RTL and 200 percent text preserve full semantics',
      (tester) async {
    final document = fixture('complete-paywall.json');
    final resolved = const MosaicLocaleResolver().resolve(
      document,
      requestedLocale: 'ar',
    );
    final subtitle = document.nodes
        .whereType<MosaicTextComponent>()
        .firstWhere((component) => component.id == 'subtitle');
    final fullSubtitle = resolved.text(subtitle.value);
    final semantics = tester.ensureSemantics();
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(900, 1600),
            textScaler: TextScaler.linear(2),
          ),
          child: MosaicPaywall(
            document: document,
            purchaseProvider: MockMosaicPurchaseProvider(products: products),
            requestedLocale: 'ar',
            clock: () => DateTime.utc(2030, 12, 30),
            onResult: (_) {},
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump();

    expect(
      tester
          .widget<Directionality>(find.byType(Directionality).last)
          .textDirection,
      TextDirection.rtl,
    );
    final subtitleSemantics = tester.getSemantics(
      find.byKey(const ValueKey<String>('mosaic-subtitle')),
    );
    expect(subtitleSemantics.label, fullSubtitle);
    expect(tester.takeException(), isNull);

    await tester.ensureVisible(
      find.byKey(const ValueKey<String>('mosaic-view-details-icon')),
    );
    final transforms = tester.widgetList<Transform>(
      find.descendant(
        of: find.byKey(
          const ValueKey<String>('mosaic-view-details-icon'),
        ),
        matching: find.byType(Transform),
      ),
    );
    expect(
      transforms
          .where((transform) => transform.transform.entry(0, 0) == -1)
          .length,
      1,
      reason:
          "Material's directional IconData must mirror exactly once in RTL.",
    );
    semantics.dispose();
  });
}

import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr/Trash";

import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import {
  AdvancedSection,
  ControlAccessibilitySection,
} from "@/features/paywall-editor/components/property-inspector-accessibility";
import {
  BackgroundSection,
  BorderSection,
} from "@/features/paywall-editor/components/property-inspector-background";
import {
  CompactOptionField,
  distributionOptions,
  FLOW_OPTIONS,
  InspectorSection,
  TwoColumn,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core";
import {
  ColorField,
  LocalizedField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields";
import {
  AppearanceSection,
  SizingFields,
  SpacingSection,
  TypographyFields,
  VisibilitySection,
} from "@/features/paywall-editor/components/property-inspector-layout";
import { SelectionStyleSection } from "@/features/paywall-editor/components/property-inspector-product-styles";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  BaseTypography,
  ProtocolNode,
  TabsComponent,
} from "@/features/paywall-editor/types/editor";
import { emptyStack } from "@/features/paywall-editor/utils/document-tree-creation";
import {
  allocateIdentifier,
  allocateLocalizationKey,
  identifierSet,
  localizationKeySet,
  localized,
} from "@/features/paywall-editor/utils/document-tree-dependencies";

const MINIMUM_TABS = 2;
const MAXIMUM_TABS = 8;

export function TabsInspector({ node }: { node: TabsComponent }) {
  const { disabled, document } = useInspectorContext();
  const editor = useEditorActions();

  function addTab() {
    const identifiers = identifierSet(document);
    const keys = localizationKeySet(document);
    const ordinal = node.tabs.length + 1;
    const tabId = allocateIdentifier(identifiers, `${node.id}-tab-${ordinal}`);
    const tab = {
      id: tabId,
      label: localized(
        `Tab ${ordinal}`,
        allocateLocalizationKey(
          keys,
          `paywall.${tabId.replaceAll("-", "_")}.label`
        )
      ),
      content: emptyStack(allocateIdentifier(identifiers, `${tabId}-content`)),
    };
    editor.updateComponent(node.id, (current) =>
      current.type === "tabs"
        ? { ...current, tabs: [...current.tabs, tab] }
        : current
    );
  }

  function removeTab(tabId: string) {
    editor.updateComponent(node.id, (current) => {
      if (current.type !== "tabs") {
        return current;
      }
      const tabs = current.tabs.filter((tab) => tab.id !== tabId);
      const [firstTab] = tabs;
      if (!firstTab || tabs.length < MINIMUM_TABS) {
        return current;
      }
      // Removing the opening panel forces a new authored choice rather than
      // leaving `initialTabId` naming a tab that no longer exists.
      return {
        ...current,
        tabs,
        initialTabId: tabs.some((tab) => tab.id === current.initialTabId)
          ? current.initialTabId
          : firstTab.id,
      };
    });
  }

  return (
    <>
      <InspectorSection defaultOpen title="Content">
        <SelectField
          address="initialTabId"
          description="The panel that opens first. Reordering tabs never changes it."
          label="Initial tab"
          onChange={(initialTabId) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "tabs" &&
              current.tabs.some((tab) => tab.id === initialTabId)
                ? { ...current, initialTabId }
                : current
            )
          }
          value={node.initialTabId}
        >
          {node.tabs.map((tab) => (
            <SelectItem key={tab.id} value={tab.id}>
              {tab.label.default}
            </SelectItem>
          ))}
        </SelectField>
        {node.tabs.map((tab, index) => (
          <div className="flex items-end gap-2" key={tab.id}>
            <div className="min-w-0 flex-1">
              <LocalizedField
                address={`tabs.${index}.label`}
                label={`Tab ${index + 1} label`}
                text={tab.label}
              />
            </div>
            <Button
              aria-label={`Remove tab ${tab.label.default}`}
              disabled={disabled || node.tabs.length <= MINIMUM_TABS}
              onClick={() => removeTab(tab.id)}
              size="xs"
              type="button"
              variant="outline"
            >
              <TrashIcon aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          className="w-full justify-start"
          disabled={disabled || node.tabs.length >= MAXIMUM_TABS}
          onClick={addTab}
          size="sm"
          type="button"
          variant="outline"
        >
          <PlusIcon aria-hidden /> Add tab
        </Button>
        <p className="text-[11px] text-muted-foreground leading-4">
          Two to eight tabs. Arrange each tab&apos;s content Stack directly in
          Layers.
        </p>
      </InspectorSection>
      <InspectorSection defaultOpen title="Layout">
        <CompactOptionField
          address="tabBarDirection"
          label="Tab bar flow"
          onChange={(tabBarDirection) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "tabs"
                ? {
                    ...current,
                    tabBarDirection:
                      tabBarDirection as typeof current.tabBarDirection,
                  }
                : current
            )
          }
          options={FLOW_OPTIONS}
          value={node.tabBarDirection}
        />
        <CompactOptionField
          address="tabBarDistribution"
          label="Tab bar distribution"
          onChange={(tabBarDistribution) =>
            editor.updateComponent(node.id, (current) =>
              current.type === "tabs"
                ? {
                    ...current,
                    tabBarDistribution:
                      tabBarDistribution as typeof current.tabBarDistribution,
                  }
                : current
            )
          }
          options={distributionOptions(node.tabBarDirection)}
          value={node.tabBarDistribution}
        />
        <TwoColumn>
          <NumberField
            address="tabBarGap"
            label="Tab spacing"
            max={4096}
            min={0}
            onChange={(tabBarGap) =>
              editor.updateComponent(node.id, (current) =>
                current.type === "tabs" ? { ...current, tabBarGap } : current
              )
            }
            unit="lu"
            value={node.tabBarGap}
          />
          <NumberField
            address="gap"
            label="Panel spacing"
            max={4096}
            min={0}
            onChange={(gap) =>
              editor.updateComponent(node.id, (current) =>
                current.type === "tabs" ? { ...current, gap } : current
              )
            }
            unit="lu"
            value={node.gap}
          />
        </TwoColumn>
        <SizingFields node={node} />
      </InspectorSection>
      <SelectionStyleSection node={node} title="Tab appearance" />
      <InspectorSection title="Tab label">
        <TypographyFields
          node={node}
          onChange={(current, typography) =>
            current.type === "tabs"
              ? { ...current, labelTypography: typography as BaseTypography }
              : current
          }
          typography={node.labelTypography}
        />
        <ColorField
          address="selectedLabelColor"
          description="Required. State the colour even when it matches the default, so a deliberate match is never confused with an unauthored value."
          label="Selected label colour"
          onUpdate={(current, selectedLabelColor) =>
            current.type === "tabs"
              ? ({ ...current, selectedLabelColor } as ProtocolNode)
              : current
          }
          value={node.selectedLabelColor}
        />
      </InspectorSection>
      <SpacingSection node={node} />
      <BackgroundSection node={node} />
      <BorderSection node={node} />
      <AppearanceSection container node={node} />
      <VisibilitySection node={node} />
      <ControlAccessibilitySection node={node} />
      <AdvancedSection node={node} />
    </>
  );
}

// biome-ignore-all lint/suspicious/noMisplacedAssertion: every assertion here sits in a named expect* helper that the tests call; the rule cannot see through the call to the it() that owns it
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import {
  InspectorHarness,
  SeededLocalizedTextHarness,
  type SeedMode,
} from "@/features/paywall-editor/components/property-inspector-test-support";
import { EDITOR_TEMPLATES } from "@/features/paywall-editor/constants/templates";
import { collectEditorValidation } from "@/features/paywall-editor/hooks/use-editor-validation";
import { EditorStoreProvider } from "@/features/paywall-editor/stores/editor-store-context";
import { StudioWorkspaceStoreProvider } from "@/features/paywall-editor/stores/studio-workspace-store-context";
import type {
  InsertableBlockType,
  MosaicDocument,
} from "@/features/paywall-editor/types/editor";
import { cloneValue } from "@/features/paywall-editor/utils/clone";
import { insertBlockAtLocation } from "@/features/paywall-editor/utils/document-tree-mutations";
import {
  focusInspectorValidationIssue,
  getInspectorFieldId,
} from "@/features/paywall-editor/utils/property-inspector-navigation";
import { required } from "@/test/required";

export function renderSeedMode(mode: SeedMode) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <SeededLocalizedTextHarness mode={mode} />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>
  );
}

export function renderInspector(selection: string, templateIndex = 0) {
  return render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InspectorHarness selection={selection} templateIndex={templateIndex} />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>
  );
}

export function documentWithBlock(type: InsertableBlockType) {
  const document = cloneValue(
    required(EDITOR_TEMPLATES[0], "EDITOR_TEMPLATES[0]").document
  );
  const result = insertBlockAtLocation(
    document,
    type,
    {
      parentId: required(document.screens[0], "document.screens[0]").layout
        .content.id,
      index: required(document.screens[0], "document.screens[0]").layout.content
        .children.length,
    },
    type === "countdown"
      ? { countdownEndsAt: "2030-12-31T23:59:59Z" }
      : undefined
  );
  if (result.status === "rejected") {
    throw new Error(result.message);
  }
  return { document: result.document, nodeId: result.nodeId };
}

export function getInspectorSection(title: string) {
  const section = document.querySelector(`[data-inspector-section="${title}"]`);
  if (!(section instanceof HTMLDetailsElement)) {
    throw new Error(`Missing ${title} inspector section`);
  }
  return section;
}

export function openInspectorSection(title: string) {
  const section = getInspectorSection(title);
  if (!section.open) {
    const summary = section.querySelector("summary");
    if (!(summary instanceof HTMLElement)) {
      throw new Error(`Missing ${title} section summary`);
    }
    fireEvent.click(summary);
  }
  return section;
}

export function expectReadOnlyField(
  componentId: string,
  address: string,
  value: string
) {
  const field = document.getElementById(
    getInspectorFieldId(componentId, address)
  );
  expect(field).toBeInstanceOf(HTMLInputElement);
  expect(field).toHaveAttribute("readonly");
  expect(field).toHaveValue(value);
}

export function expectSectionsOpen(...titles: string[]) {
  const sections = Array.from(
    document.querySelectorAll<HTMLDetailsElement>("[data-inspector-section]")
  );
  const openTitles = new Set(titles);
  expect(sections.length).toBeGreaterThan(1);
  for (const section of sections) {
    expect(section.open).toBe(
      openTitles.has(section.dataset.inspectorSection ?? "")
    );
  }
  if (!openTitles.has("Advanced")) {
    expect(getInspectorSection("Advanced")).not.toHaveAttribute("open");
  }
}

export function renderedPropertyAddresses() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-property-address]")
  )
    .map((element) => element.dataset.propertyAddress)
    .filter((address): address is string => Boolean(address));
}

export function renderedSectionTitles() {
  return Array.from(
    document.querySelectorAll<HTMLDetailsElement>("[data-inspector-section]")
  ).map((section) => section.dataset.inspectorSection);
}

export async function expectValidationIssueFocus({
  address,
  initialDocument,
  selection,
}: {
  address: string;
  initialDocument: MosaicDocument;
  selection: string;
}) {
  const issue = collectEditorValidation(initialDocument).issues.find(
    (candidate) =>
      candidate.componentId === selection && candidate.property === address
  );
  if (!issue) {
    throw new Error(`Missing ${selection}.${address} validation issue`);
  }

  const view = render(
    <StudioWorkspaceStoreProvider storage={null}>
      <EditorStoreProvider>
        <InspectorHarness
          initialDocument={initialDocument}
          issues={[issue]}
          selection={selection}
        />
      </EditorStoreProvider>
    </StudioWorkspaceStoreProvider>
  );
  const fieldId = getInspectorFieldId(selection, address);
  await waitFor(() =>
    expect(document.getElementById(fieldId)).toBeInTheDocument()
  );
  const field = document.getElementById(fieldId);
  if (!(field instanceof HTMLElement)) {
    throw new Error(`Missing ${fieldId}`);
  }
  const section = field.closest("details");
  section?.removeAttribute("open");

  expect(focusInspectorValidationIssue(issue)).toBe(true);
  expect(section).toHaveAttribute("open");
  expect(field).toHaveFocus();
  view.unmount();
}

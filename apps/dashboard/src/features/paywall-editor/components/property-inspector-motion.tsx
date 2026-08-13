import { SelectItem } from "@/components/ui/select";
import {
  clampMotionDuration,
  MOTION_DURATION_MAXIMUM,
  MOTION_DURATION_MINIMUM,
  MOTION_EASING_OPTIONS,
} from "@/features/paywall-editor/components/design-system-controls";
import {
  InspectorSection,
  useInspectorContext,
} from "@/features/paywall-editor/components/property-inspector-core";
import {
  CheckboxField,
  NumberField,
  SelectField,
} from "@/features/paywall-editor/components/property-inspector-fields";
import { useEditorActions } from "@/features/paywall-editor/stores/editor-store-context";
import type {
  AppearMotion,
  AuthoredNodeMotion,
  LoopMotion,
  MotionEasing,
  MotionValue,
  ProtocolNode,
  SelectionMotion,
} from "@/features/paywall-editor/types/editor";
import {
  flattenDocument,
  screenContainingNode,
} from "@/features/paywall-editor/utils/document-tree-traversal";
import {
  documentMotionTokens,
  findAppearAncestorId,
  nodeMotionOf,
  withNodeParts,
} from "@/features/paywall-editor/utils/document-version";
import { motionLoopMinimumDurationMilliseconds } from "@/lib/mosaic-protocol";

/** Contract bounds, named so the controls and the copy cannot disagree. */
const LOOP_SCALE_MAXIMUM = 0.06;
const LOOP_OPACITY_MAXIMUM = 0.2;
const LOOP_REPEAT_MINIMUM = 1;
const LOOP_REPEAT_MAXIMUM = 5;
const RISE_MINIMUM = 1;
const RISE_DEFAULT = 12;
const RISE_MAXIMUM = 64;
const APPEAR_DELAY_MAXIMUM = 2000;
const INLINE_CURVE = "__inline__";

/** 0.4 allows `selection` only on the two components that own selection state. */
function allowsSelectionMotion(node: ProtocolNode) {
  return node.type === "productSelector" || node.type === "tabs";
}

/** 0.4 allows `loop` only on a button. */
function allowsLoopMotion(node: ProtocolNode) {
  return node.type === "button";
}

/**
 * The curve control: a motion token, or an inline duration and easing.
 *
 * Mirrors the shadow control's token-or-inline pair, which is the shape the
 * contract chose for motion deliberately.
 */
function CurveField({
  address,
  onChange,
  value,
}: {
  address: string;
  onChange: (value: MotionValue) => void;
  value: MotionValue;
}) {
  const { document } = useInspectorContext();
  const tokens = documentMotionTokens(document);
  const selected = value.type === "motionToken" ? value.id : INLINE_CURVE;

  return (
    <>
      <SelectField
        address={address}
        description="Reference a motion token, or author the curve on this node."
        label="Curve"
        onChange={(next) =>
          onChange(
            next === INLINE_CURVE
              ? {
                  type: "motion",
                  durationMilliseconds: 240,
                  easing: "standard",
                }
              : { type: "motionToken", id: next }
          )
        }
        value={selected}
      >
        {tokens.map((token) => (
          <SelectItem key={token.id} value={token.id}>
            {token.name}
          </SelectItem>
        ))}
        <SelectItem value={INLINE_CURVE}>Custom curve</SelectItem>
      </SelectField>
      {value.type === "motion" ? (
        <>
          <NumberField
            address={`${address}.durationMilliseconds`}
            integer
            label="Duration"
            max={MOTION_DURATION_MAXIMUM}
            min={MOTION_DURATION_MINIMUM}
            onChange={(next) =>
              onChange({
                ...value,
                durationMilliseconds: clampMotionDuration(next),
              })
            }
            step={10}
            unit="ms"
            value={value.durationMilliseconds}
          />
          <SelectField
            address={`${address}.easing`}
            label="Easing"
            onChange={(next) =>
              onChange({
                ...value,
                easing: next as MotionEasing,
              })
            }
            value={value.easing}
          >
            {MOTION_EASING_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectField>
        </>
      ) : null}
    </>
  );
}

/**
 * A note the author must see rather than a control the author cannot reach.
 *
 * The contract rejects the document for a nested `appear` and for a second
 * `loop` on a screen. Both are surfaced here, at the control that caused them,
 * in addition to the Validation panel: disabling the control instead would hide
 * a document-rejecting state behind a greyed-out checkbox with no explanation.
 */
function MotionConstraintNote({ children }: { children: string }) {
  return (
    <p
      className="rounded border border-destructive/40 bg-destructive/5 p-2 text-destructive text-xs"
      role="alert"
    >
      {children}
    </p>
  );
}

export function MotionSection({ node }: { node: ProtocolNode }) {
  const { document } = useInspectorContext();
  const editor = useEditorActions();

  const motion = nodeMotionOf(node);
  const appear = motion?.appear;
  const selection = motion?.selection;
  const loop = motion?.loop;

  function updateMotion(parts: Partial<AuthoredNodeMotion>) {
    editor.updateComponent(node.id, (current) => {
      const nextMotion = { ...nodeMotionOf(current), ...parts };
      const hasMotion = Object.values(nextMotion).some(
        (entry) => entry !== undefined
      );
      return withNodeParts(current, {
        motion: hasMotion ? nextMotion : undefined,
      });
    });
  }

  const appearAncestorId = appear
    ? findAppearAncestorId(document, node.id)
    : null;

  const loopsOnThisScreen = (() => {
    if (!loop) {
      return 0;
    }
    const screen = screenContainingNode(document, node.id);
    if (!screen) {
      return 0;
    }
    return flattenDocument(document).filter(
      (entry) =>
        "motion" in entry.node &&
        entry.node.motion &&
        "loop" in entry.node.motion &&
        entry.node.motion.loop &&
        screenContainingNode(document, entry.node.id)?.id === screen.id
    ).length;
  })();

  return (
    <InspectorSection title="Motion">
      <CheckboxField
        address="motion.appear"
        checked={Boolean(appear)}
        description="Plays once when this layer first enters a screen."
        label="Entrance"
        onChange={(checked) =>
          updateMotion({
            appear: checked
              ? ({
                  effect: "fade",
                  curve: {
                    type: "motion",
                    durationMilliseconds: 240,
                    easing: "decelerate",
                  },
                  // Required by the contract rather than defaulted by it: a
                  // stagger is authored, so an unstaggered entrance says 0.
                  delayMilliseconds: 0,
                } satisfies AppearMotion)
              : undefined,
          })
        }
      />
      {appear ? (
        <>
          {appearAncestorId ? (
            <MotionConstraintNote>
              {
                "This entrance is nested inside another layer that already has one, which the contract rejects: two entrance opacities multiply and the three renderers compose that product differently. Put the entrance on the outer layer instead."
              }
            </MotionConstraintNote>
          ) : null}
          <SelectField
            address="motion.appear.effect"
            label="Effect"
            onChange={(next) =>
              updateMotion({
                // The key is dropped rather than set to undefined: the schema
                // forbids riseLogicalSize on a fade, so its presence is what
                // matters, not its value.
                appear:
                  next === "fadeRise"
                    ? {
                        effect: "fadeRise",
                        riseLogicalSize: RISE_DEFAULT,
                        curve: appear.curve,
                        delayMilliseconds: appear.delayMilliseconds,
                      }
                    : {
                        effect: "fade",
                        curve: appear.curve,
                        delayMilliseconds: appear.delayMilliseconds,
                      },
              })
            }
            value={appear.effect}
          >
            <SelectItem value="fade">Fade</SelectItem>
            <SelectItem value="fadeRise">Fade and rise</SelectItem>
          </SelectField>
          {appear.effect === "fadeRise" ? (
            <NumberField
              address="motion.appear.riseLogicalSize"
              description="How far the layer travels to its laid-out position."
              integer
              label="Rise distance"
              max={RISE_MAXIMUM}
              min={RISE_MINIMUM}
              onChange={(next) =>
                updateMotion({
                  appear: {
                    effect: "fadeRise",
                    riseLogicalSize: next,
                    curve: appear.curve,
                    delayMilliseconds: appear.delayMilliseconds,
                  },
                })
              }
              value={appear.riseLogicalSize}
            />
          ) : null}
          <NumberField
            address="motion.appear.delayMilliseconds"
            description="Stagger siblings by giving them increasing delays."
            integer
            label="Delay"
            max={APPEAR_DELAY_MAXIMUM}
            min={0}
            onChange={(next) =>
              updateMotion({
                appear: { ...appear, delayMilliseconds: next },
              })
            }
            step={10}
            unit="ms"
            value={appear.delayMilliseconds ?? 0}
          />
          <CurveField
            address="motion.appear.curve"
            onChange={(curve) => updateMotion({ appear: { ...appear, curve } })}
            value={appear.curve}
          />
        </>
      ) : null}

      {allowsSelectionMotion(node) ? (
        <>
          <CheckboxField
            address="motion.selection"
            checked={Boolean(selection)}
            description="Interpolates the Default and Selected styles when the selection changes."
            label="Selection change"
            onChange={(checked) =>
              updateMotion({
                selection: checked
                  ? ({
                      curve: {
                        type: "motion",
                        durationMilliseconds: 160,
                        easing: "standard",
                      },
                    } satisfies SelectionMotion)
                  : undefined,
              })
            }
          />
          {selection ? (
            <CurveField
              address="motion.selection.curve"
              onChange={(curve) => updateMotion({ selection: { curve } })}
              value={selection.curve}
            />
          ) : null}
        </>
      ) : null}

      {allowsLoopMotion(node) ? (
        <>
          <CheckboxField
            address="motion.loop"
            checked={Boolean(loop)}
            description="A bounded call-to-action pulse. At most one per screen."
            label="Pulse"
            onChange={(checked) =>
              updateMotion({
                loop: checked
                  ? ({
                      effect: "pulse",
                      scaleAmplitude: 0.04,
                      opacityAmplitude: 0.12,
                      curve: {
                        type: "motion",
                        durationMilliseconds:
                          motionLoopMinimumDurationMilliseconds,
                        easing: "standard",
                      },
                      repeat: { count: 3 },
                    } satisfies LoopMotion)
                  : undefined,
              })
            }
          />
          {loop ? (
            <>
              {loopsOnThisScreen > 1 ? (
                <MotionConstraintNote>
                  {
                    "This screen already has a pulse on another button. The contract allows at most one per screen, so remove one of them before publishing."
                  }
                </MotionConstraintNote>
              ) : null}
              <NumberField
                address="motion.loop.scaleAmplitude"
                description={`How far the button grows. At most ${LOOP_SCALE_MAXIMUM}.`}
                exclusiveMin
                label="Scale amount"
                max={LOOP_SCALE_MAXIMUM}
                min={0}
                onChange={(next) =>
                  updateMotion({ loop: { ...loop, scaleAmplitude: next } })
                }
                step={0.01}
                value={loop.scaleAmplitude}
              />
              <NumberField
                address="motion.loop.opacityAmplitude"
                description={`How far it dims, as a fraction of its static opacity. At most ${LOOP_OPACITY_MAXIMUM}.`}
                label="Dim amount"
                max={LOOP_OPACITY_MAXIMUM}
                min={0}
                onChange={(next) =>
                  updateMotion({ loop: { ...loop, opacityAmplitude: next } })
                }
                step={0.01}
                value={loop.opacityAmplitude ?? 0}
              />
              <NumberField
                address="motion.loop.repeat.count"
                description="The pulse stops on its own; there is no endless mode."
                integer
                label="Repeat"
                max={LOOP_REPEAT_MAXIMUM}
                min={LOOP_REPEAT_MINIMUM}
                onChange={(next) =>
                  updateMotion({ loop: { ...loop, repeat: { count: next } } })
                }
                value={loop.repeat.count}
              />
              <CurveField
                address="motion.loop.curve"
                onChange={(curve) => updateMotion({ loop: { ...loop, curve } })}
                value={loop.curve}
              />
              <p className="text-[11px] text-muted-foreground leading-4">
                {`A pulse curve must last at least ${motionLoopMinimumDurationMilliseconds}ms, which keeps it well below the flash threshold.`}
              </p>
            </>
          ) : null}
        </>
      ) : null}
    </InspectorSection>
  );
}

package hostedpublishing

// Protocol 0.4 motion semantics, mirroring validateMotionCatalog and
// validateMotionSemantics in protocol/tools/validation-v0.4.mjs. Everything the
// schema alone can refuse (a loop outside Button, a riseLogicalSize on a fade,
// amplitude ceilings) is left to the schema; these rules cover only what needs
// the whole document: token resolution, per-screen loop uniqueness, nesting,
// and the flash-safety floor at the reference site.

// validateProtocolMotionTokens checks the designSystem.motions catalog and
// every motionToken reference in the document.
//
// Deliberately asymmetric with the colour, background, and shadow catalogs,
// which carry no unused-token check: those are inert values. A motion token is
// a duration that flash safety is checked against at its reference site, so a
// token nothing references has never been checked against anything and survives
// a redesign looking approved. See docs/protocol/v0.4.md.
func validateProtocolMotionTokens(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	design := mapValue(root["designSystem"])
	catalog := arrayValue(design["motions"])
	if hasDuplicateField(catalog, "id") || hasDuplicateField(catalog, "name") {
		errors = append(errors, "protocol_motion_token_duplicate")
	}
	declared := map[string]bool{}
	for _, raw := range catalog {
		declared[stringValue(mapValue(raw)["id"])] = true
	}
	referenced := map[string]bool{}
	roots := []any{design}
	for _, entry := range entries {
		roots = append(roots, entry.value)
	}
	for _, rootValue := range roots {
		walkObjects(rootValue, func(item map[string]any) {
			if stringValue(item["type"]) != "motionToken" {
				return
			}
			if declared[stringValue(item["id"])] {
				referenced[stringValue(item["id"])] = true
				return
			}
			errors = append(errors, "protocol_motion_token_unknown")
		})
	}
	graph := map[string][]string{}
	for _, raw := range catalog {
		token := mapValue(raw)
		id := stringValue(token["id"])
		graph[id] = []string{}
		walkObjects(token["value"], func(item map[string]any) {
			if stringValue(item["type"]) == "motionToken" {
				graph[id] = append(graph[id], stringValue(item["id"]))
			}
		})
	}
	if graphCycle(graph) {
		errors = append(errors, "protocol_motion_token_cycle")
	}
	for _, raw := range catalog {
		id := stringValue(mapValue(raw)["id"])
		if referenced[id] {
			continue
		}
		// A token reached only through another token is used; an unreachable
		// one is not.
		reachable := false
		for from := range referenced {
			for _, target := range graph[from] {
				if target == id {
					reachable = true
				}
			}
		}
		if !reachable {
			errors = append(errors, "protocol_motion_token_unused")
		}
	}
	return errors
}

// validateProtocolMotionSemantics enforces the three whole-document motion
// rules: an appear inside an appear rejects (nested entrance opacities multiply
// and the three renderers compose that product at different pipeline points),
// at most one Button per screen may loop, and a loop's resolved curve must sit
// on or above the flash-safety floor. An unresolvable curve is skipped here:
// validateProtocolMotionTokens already rejects the unknown or cyclic token, and
// a floor verdict about a duration nobody authored would be noise on top of it.
func validateProtocolMotionSemantics(root map[string]any, entries []protocolNode) []string {
	errors := []string{}
	loopsByScreen := map[string]int{}
	for _, entry := range entries {
		motion := mapValue(entry.value["motion"])
		if len(motion) == 0 {
			continue
		}
		if motion["appear"] != nil {
			for _, ancestor := range entry.ancestors {
				if mapValue(ancestor["motion"])["appear"] != nil {
					errors = append(errors, "protocol_motion_appear_nested")
					break
				}
			}
		}
		loop := mapValue(motion["loop"])
		if len(loop) == 0 {
			continue
		}
		loopsByScreen[entry.screenID]++
		resolved := resolveProtocolMotionCurve(root, mapValue(loop["curve"]))
		if resolved == nil {
			continue
		}
		if numberValue(resolved["durationMilliseconds"]) < protocolMotionLoopMinimumDurationMilliseconds {
			errors = append(errors, "protocol_motion_loop_duration_invalid")
		}
	}
	for _, count := range loopsByScreen {
		if count > 1 {
			errors = append(errors, "protocol_motion_loop_duplicate")
		}
	}
	return errors
}

// resolveProtocolMotionCurve follows a motionToken chain to its inline motion.
// An unknown token or a cycle resolves to nil rather than a guess, mirroring
// resolveV04MotionToken in protocol/tools/validation-v0.4.mjs.
func resolveProtocolMotionCurve(root map[string]any, motion map[string]any) map[string]any {
	catalog := map[string]map[string]any{}
	for _, raw := range arrayValue(mapValue(root["designSystem"])["motions"]) {
		token := mapValue(raw)
		catalog[stringValue(token["id"])] = mapValue(token["value"])
	}
	seen := map[string]bool{}
	current := motion
	for stringValue(current["type"]) == "motionToken" {
		id := stringValue(current["id"])
		value, known := catalog[id]
		if seen[id] || !known {
			return nil
		}
		seen[id] = true
		current = value
	}
	if len(current) == 0 {
		return nil
	}
	return current
}

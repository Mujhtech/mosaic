package experiment

import "math"

const z95 = 1.959963984540054

func Wilson(successes, total int64) Interval {
	if total == 0 {
		return Interval{}
	}
	n := float64(total)
	p := float64(successes) / n
	z2 := z95 * z95
	center := (p + z2/(2*n)) / (1 + z2/n)
	half := z95 * math.Sqrt((p*(1-p)+z2/(4*n))/n) / (1 + z2/n)
	return Interval{Lower: math.Max(0, center-half), Upper: math.Min(1, center+half)}
}

func Newcombe(controlSuccesses, controlTotal, treatmentSuccesses, treatmentTotal int64) Interval {
	c := Wilson(controlSuccesses, controlTotal)
	t := Wilson(treatmentSuccesses, treatmentTotal)
	return Interval{Lower: math.Max(-1, t.Lower-c.Upper), Upper: math.Min(1, t.Upper-c.Lower)}
}

func SampleRatioMismatch(values []VariantAggregate) SRMResult {
	result := SRMResult{Status: "insufficient_sample", Severity: "none", Exclusions: []string{"assignments_without_presentation", "qa_overrides", "fallback_presentations", "group_holdout"}, Explanation: "SRM uses first qualifying exposures per assignment unit.", InvestigationSteps: []string{"Verify allocation and assignment conformance.", "Inspect delivery freshness and exposure instrumentation."}}
	var total int64
	for _, v := range values {
		total += v.UniqueExposures
	}
	if total < 100 {
		return result
	}
	stat := 0.0
	cells := make([]SRMCell, 0, len(values))
	for _, v := range values {
		expected := float64(total) * float64(v.AllocationBasisPoints) / 10000
		if expected < 5 {
			return result
		}
		delta := float64(v.UniqueExposures) - expected
		stat += delta * delta / expected
		cells = append(cells, SRMCell{VariantID: v.VariantID, Observed: v.UniqueExposures, Expected: expected, ObservedShare: float64(v.UniqueExposures) / float64(total), ExpectedShare: float64(v.AllocationBasisPoints) / 10000})
	}
	df := len(values) - 1
	p := chiSquareSurvival(stat, df)
	severity := "none"
	status := "ok"
	if p < 0.000001 {
		severity = "critical"
		status = "mismatch"
	} else if p < 0.001 {
		severity = "warning"
		status = "mismatch"
	}
	result.Status, result.Severity, result.Statistic, result.DegreesOfFreedom, result.PValue, result.Cells = status, severity, stat, df, p, cells
	return result
}

func chiSquareSurvival(x float64, df int) float64 {
	if x <= 0 {
		return 1
	}
	// Experiment v1 has two to four Variants, so df is one through three.
	switch df {
	case 1:
		return math.Erfc(math.Sqrt(x / 2))
	case 2:
		return math.Exp(-x / 2)
	case 3:
		y := math.Sqrt(x / 2)
		return math.Erfc(y) + (2/math.Sqrt(math.Pi))*y*math.Exp(-y*y)
	default:
		return 0
	}
}

package billingmigration

import (
	"strings"
)

type semanticVersion struct {
	core [3]string
	pre  []string
}

func parseSemanticVersion(value string) (semanticVersion, error) {
	parsed := semanticVersion{core: [3]string{"0", "0", "0"}}
	if value == "" || strings.TrimSpace(value) != value {
		return parsed, ErrInvalid
	}
	withoutBuild := value
	if plus := strings.IndexByte(value, '+'); plus >= 0 {
		withoutBuild = value[:plus]
		if !validIdentifiers(value[plus+1:], false) {
			return parsed, ErrInvalid
		}
	}
	coreText := withoutBuild
	if dash := strings.IndexByte(withoutBuild, '-'); dash >= 0 {
		coreText = withoutBuild[:dash]
		pre := withoutBuild[dash+1:]
		if !validIdentifiers(pre, true) {
			return parsed, ErrInvalid
		}
		parsed.pre = strings.Split(pre, ".")
	}
	parts := strings.Split(coreText, ".")
	if len(parts) < 1 || len(parts) > 3 {
		return parsed, ErrInvalid
	}
	for index, part := range parts {
		if !numericIdentifier(part, true) {
			return parsed, ErrInvalid
		}
		parsed.core[index] = part
	}
	return parsed, nil
}

func validIdentifiers(value string, prerelease bool) bool {
	if value == "" {
		return false
	}
	for _, identifier := range strings.Split(value, ".") {
		if identifier == "" {
			return false
		}
		numeric := true
		for _, character := range identifier {
			if character < '0' || character > '9' {
				numeric = false
			}
			if !((character >= '0' && character <= '9') || (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z') || character == '-') {
				return false
			}
		}
		if prerelease && numeric && !numericIdentifier(identifier, true) {
			return false
		}
	}
	return true
}

func numericIdentifier(value string, rejectLeadingZero bool) bool {
	if value == "" || (rejectLeadingZero && len(value) > 1 && value[0] == '0') {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func compareSemanticVersions(left, right semanticVersion) int {
	for index := 0; index < 3; index++ {
		if comparison := compareNumericIdentifiers(left.core[index], right.core[index]); comparison != 0 {
			return comparison
		}
	}
	if len(left.pre) == 0 && len(right.pre) == 0 {
		return 0
	}
	if len(left.pre) == 0 {
		return 1
	}
	if len(right.pre) == 0 {
		return -1
	}
	limit := len(left.pre)
	if len(right.pre) < limit {
		limit = len(right.pre)
	}
	for index := 0; index < limit; index++ {
		l, r := left.pre[index], right.pre[index]
		ln, rn := numericIdentifier(l, false), numericIdentifier(r, false)
		if ln && rn {
			if comparison := compareNumericIdentifiers(l, r); comparison != 0 {
				return comparison
			}
		} else if ln {
			return -1
		} else if rn {
			return 1
		} else if l < r {
			return -1
		} else if l > r {
			return 1
		}
	}
	if len(left.pre) < len(right.pre) {
		return -1
	}
	if len(left.pre) > len(right.pre) {
		return 1
	}
	return 0
}

func compareNumericIdentifiers(left, right string) int {
	if len(left) < len(right) {
		return -1
	}
	if len(left) > len(right) {
		return 1
	}
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func SemanticVersionInRange(value, minimum, maximum string) (bool, error) {
	v, err := parseSemanticVersion(value)
	if err != nil {
		return false, err
	}
	min, err := parseSemanticVersion(minimum)
	if err != nil {
		return false, err
	}
	max, err := parseSemanticVersion(maximum)
	if err != nil {
		return false, err
	}
	return compareSemanticVersions(v, min) >= 0 && compareSemanticVersions(v, max) <= 0, nil
}

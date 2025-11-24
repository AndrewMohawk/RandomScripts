#!/bin/sh

# ===============================================================
#  FAST, SAFE VULNERABILITY SCANNER
#  - Single npm ls call
#  - Correct handling of scoped packages
#  - Correct parsing of OR specs like: "= 1.0.1 || = 1.0.2"
#  - Compact single-line progress bar
#  - Detailed summary only at end
# ===============================================================

# Temp files for results
VULN_FILE=$(mktemp)
NON_VULN_FILE=$(mktemp)
TREE_FILE=$(mktemp)

trap 'rm -f "$VULN_FILE" "$NON_VULN_FILE" "$TREE_FILE"' EXIT

# --- STEP 1: Build full dependency tree once ---
npm ls --all --depth=Infinity >"$TREE_FILE" 2>/dev/null || true

if [ ! -s "$TREE_FILE" ]; then
    echo "ERROR: npm ls produced no usable output. Are you in a Node project?" >&2
    exit 1
fi

# --- Extract installed versions for a package ---
get_installed_versions() {
    package="$1"

    awk -v p="$package" '
        {
            for (i = 1; i <= NF; i++) {
                f=$i
                # Only treat tokens starting EXACTLY with "<package>@"
                if (index(f, p "@") == 1) {
                    s = substr(f, length(p)+2)
                    if (match(s, /^[0-9A-Za-z.+-]+/)) {
                        print substr(s, RSTART, RLENGTH)
                    }
                }
            }
        }
    ' "$TREE_FILE" | sort -u
}

# --- Parse "= 1.0.1 || = 1.0.2" into clean versions ---
parse_vuln_versions() {
    printf '%s\n' "$1" \
    | sed 's/||/\n/g' \
    | while IFS= read -r v; do
        v=$(printf '%s' "$v" \
            | sed 's/^"//; s/"$//' \
            | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
            | sed 's/^[[:space:]]*=[[:space:]]*//' \
            | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        [ -n "$v" ] && printf '%s\n' "$v"
    done
}

# --- The actual check ---
check_package() {
    package="$1"
    vuln_spec="$2"

    vuln_versions=$(parse_vuln_versions "$vuln_spec")

    installed=$(get_installed_versions "$package")

    # Figure out if any vuln versions are installed
    found=""
    for v in $vuln_versions; do
        if printf '%s\n' "$installed" | grep -Fx "$v" >/dev/null 2>&1; then
            found="$found $v"
        fi
    done

    if [ -n "$found" ]; then
        # gather exact locations in npm tree
        locs=""
        for v in $found; do
            match=$(grep -F "$package@$v" "$TREE_FILE")
            [ -n "$match" ] && locs="$locs\n$match"
        done

        {
            echo "Package: $package"
            echo "Vulnerable version(s) installed: $(printf '%s' $found | paste -sd',' -)"
            echo "CSV vulnerable versions: $(printf '%s' $vuln_versions | paste -sd',' -)"
            echo "Locations:"
            printf '%b\n' "$locs"
            echo "------------------------------------------------"
        } >> "$VULN_FILE"
    else
        echo "$package" >> "$NON_VULN_FILE"
    fi
}

# ==============================================
# RUNNING THROUGH CSV WITH A SINGLE-LINE PROGRESS
# ==============================================

csv_file="$1"

if [ -z "$csv_file" ] || [ ! -f "$csv_file" ]; then
    echo "Usage: $0 <packages.csv>"
    exit 1
fi

# Count total packages (excluding header)
TOTAL=$(($(wc -l < "$csv_file") - 1))
COUNT=0

echo "Scanning $TOTAL packages..."
echo

# Main loop
tail -n +2 "$csv_file" | tr -d '\r' | \
while IFS=, read -r raw_pkg raw_ver rest; do
    pkg=$(printf '%s' "$raw_pkg" \
        | sed 's/^"//; s/"$//' \
        | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

    ver=$(printf '%s' "$raw_ver" \
        | sed 's/^"//; s/"$//' \
        | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

    [ -z "$pkg" ] && continue

    COUNT=$((COUNT + 1))

    # Show progress bar:
    printf "\r[%d/%d] Checking %-50s" "$COUNT" "$TOTAL" "$pkg"

    check_package "$pkg" "$ver"
done

# Clear line after last update
printf "\r%*s\r" 80 " "

echo
echo "Scan complete."
echo

# ====================
# SUMMARY
# ====================

echo "==================== SUMMARY ===================="
echo

if [ -s "$VULN_FILE" ]; then
    echo "VULNERABLE PACKAGES:"
    echo "------------------------------------------------"
    cat "$VULN_FILE"
else
    echo "No vulnerable packages found."
fi

echo

if [ -s "$NON_VULN_FILE" ]; then
    echo "Non-vulnerable packages:"
    sort -u "$NON_VULN_FILE" | paste -sd',' - | sed 's/,/, /g'
else
    echo "No non-vulnerable packages recorded."
fi

echo "================================================="

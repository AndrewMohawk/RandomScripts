#!/bin/bash

# Script to list installed Chrome extensions across all profiles on macOS as CSV
# Usage: ./list_chrome_extensions.sh

# Chrome base directory
CHROME_BASE_DIR="$HOME/Library/Application Support/Google/Chrome"

# Check if Chrome directory exists
if [ ! -d "$CHROME_BASE_DIR" ]; then
    echo "Error: Chrome directory not found at $CHROME_BASE_DIR"
    echo "Make sure Chrome is installed."
    exit 1
fi

# CSV Header
echo "Profile Name,Extension Name,Extension ID,Version"

# Function to process extensions for a given profile
process_profile() {
    local profile_dir="$1"
    local profile_name="$2"
    local extensions_dir="$profile_dir/Extensions"
    
    # Skip if no Extensions directory
    if [ ! -d "$extensions_dir" ]; then
        return
    fi
    
    # Loop through each extension directory
    for ext_dir in "$extensions_dir"/*; do
        if [ -d "$ext_dir" ]; then
            ext_id=$(basename "$ext_dir")
            
            # Skip if it's not an extension directory (should be long alphanumeric string)
            if [[ ! "$ext_id" =~ ^[a-z]{32}$ ]] && [[ ! "$ext_id" =~ ^[a-zA-Z0-9]{32}$ ]]; then
                continue
            fi
            
            # Find the version directory (usually the latest version)
            version_dir=$(find "$ext_dir" -maxdepth 1 -type d -name "*.*.*" | head -1)
            
            if [ -n "$version_dir" ] && [ -f "$version_dir/manifest.json" ]; then
                # Extract extension name from manifest.json
                ext_name=$(python3 -c "
import json, sys, os, glob
try:
    with open('$version_dir/manifest.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
        name = data.get('name', 'Unknown')
        
        # Handle Chrome Web Store names that start with __MSG_
        if name.startswith('__MSG_'):
            msg_key = name[6:-2]  # Remove __MSG_ and __
            default_locale = data.get('default_locale', 'en')
            
            # Try multiple locales in order of preference
            locales_to_try = [default_locale, 'en', 'en_US']
            
            for locale in locales_to_try:
                locale_file = os.path.join('$version_dir', '_locales', locale, 'messages.json')
                if os.path.exists(locale_file):
                    try:
                        with open(locale_file, 'r', encoding='utf-8') as lf:
                            locale_data = json.load(lf)
                            if msg_key in locale_data and 'message' in locale_data[msg_key]:
                                name = locale_data[msg_key]['message']
                                break
                    except:
                        continue
            
            # If still not found, try common message keys
            if name.startswith('__MSG_'):
                common_keys = ['extensionName', 'extName', 'appName', 'extension_name', 'app_name']
                for locale in locales_to_try:
                    locale_file = os.path.join('$version_dir', '_locales', locale, 'messages.json')
                    if os.path.exists(locale_file):
                        try:
                            with open(locale_file, 'r', encoding='utf-8') as lf:
                                locale_data = json.load(lf)
                                for key in common_keys:
                                    if key in locale_data and 'message' in locale_data[key]:
                                        name = locale_data[key]['message']
                                        break
                                if not name.startswith('__MSG_'):
                                    break
                        except:
                            continue
        
        # Clean up name for CSV (escape quotes and commas)
        name = name.replace('\"', '\"\"')
        if ',' in name or '\"' in name:
            name = '\"' + name + '\"'
        
        print(name if not name.startswith('__MSG_') else 'Unknown Extension')
except Exception as e:
    print('Unknown Extension')
" 2>/dev/null)
                
                if [ -n "$ext_name" ]; then
                    version=$(basename "$version_dir")
                    # Clean up profile name for CSV
                    clean_profile_name=$(echo "$profile_name" | sed 's/"/\"\"/g')
                    if [[ "$clean_profile_name" == *","* ]] || [[ "$clean_profile_name" == *"\""* ]]; then
                        clean_profile_name="\"$clean_profile_name\""
                    fi
                    echo "$clean_profile_name,$ext_name,$ext_id,$version"
                fi
            fi
        fi
    done
}

# Find all Chrome profiles
# Look for directories that contain an Extensions subdirectory
for profile_path in "$CHROME_BASE_DIR"/*; do
    if [ -d "$profile_path" ]; then
        profile_name=$(basename "$profile_path")
        
        # Check if this directory has Extensions subdirectory (indicating it's a profile)
        if [ -d "$profile_path/Extensions" ]; then
            # Handle special case for Default profile
            if [ "$profile_name" = "Default" ]; then
                display_name="Default"
            elif [[ "$profile_name" =~ ^Profile\ [0-9]+$ ]]; then
                display_name="$profile_name"
            else
                # For other directory names, assume they're custom profile names
                display_name="$profile_name"
            fi
            
            process_profile "$profile_path" "$display_name"
        fi
    fi
done

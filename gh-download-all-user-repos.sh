#!/bin/bash

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    echo "GitHub CLI (gh) is not installed. Please install it first."
    echo "Visit: https://cli.github.com/ for installation instructions"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "Please authenticate with GitHub first using 'gh auth login'"
    exit 1
fi

# Check if username is provided
if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <github-username>"
    exit 1
fi

USERNAME="$1"
# Create a directory for the user's repos
DOWNLOAD_DIR="${USERNAME}_repositories"
mkdir -p "$DOWNLOAD_DIR"
cd "$DOWNLOAD_DIR" || exit 1

echo "Fetching repositories for user: $USERNAME"

# Get all repositories for the user, including private ones if authorized
REPOS=$(gh repo list "$USERNAME" --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner')

if [ -z "$REPOS" ]; then
    echo "No repositories found or unable to access repositories for user: $USERNAME"
    exit 1
fi

TOTAL_REPOS=$(echo "$REPOS" | wc -l)
CURRENT=0

echo "Found $TOTAL_REPOS repositories. Starting download..."

# Clone each repository
echo "$REPOS" | while read -r repo; do
    CURRENT=$((CURRENT + 1))
    echo "[$CURRENT/$TOTAL_REPOS] Cloning $repo"

    if gh repo clone "$repo" -- --quiet; then
        echo "✓ Successfully cloned $repo"
    else
        echo "✗ Failed to clone $repo"
    fi
done

echo "Download complete! Repositories are stored in: $DOWNLOAD_DIR"

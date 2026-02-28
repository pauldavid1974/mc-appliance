#!/bin/bash
###############################################################################
# PUSH TO GITHUB - Run this in Git Bash after extracting the mc-appliance files
#
# BEFORE running this script:
#   1. Go to https://github.com/new
#   2. Name the repo: mc-appliance
#   3. Leave it PUBLIC, do NOT add a README (we have one)
#   4. Click "Create repository"
#   5. Then come back here and run this script
#
###############################################################################

echo ""
echo "========================================="
echo "  Pushing MC Appliance to GitHub..."
echo "========================================="
echo ""

# Initialize git in this folder
git init

# Add all files
git add -A

# Create the first commit
git commit -m "Initial commit: Zero-Touch Minecraft Appliance"

# Set the branch to main
git branch -M main

# Connect to your GitHub repo
git remote add origin https://github.com/pauldavid1974/mc-appliance.git

# Push!
git push -u origin main

echo ""
echo "========================================="
echo "  Done! Your repo is live at:"
echo "  https://github.com/pauldavid1974/mc-appliance"
echo "========================================="
echo ""

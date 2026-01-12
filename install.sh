#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$HOME/.local/bin/kindle-beam-host"
CONFIG_DIR="$HOME/.config/kindle-beam"
CONFIG_FILE="$CONFIG_DIR/config.json"

# All supported browser native messaging paths
BRAVE_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"

echo "=== Kindle Beam Installer ==="
echo

# Check for pandoc
if ! command -v pandoc &> /dev/null; then
    echo "ERROR: pandoc is not installed."
    echo "Install it with: sudo pacman -S pandoc"
    exit 1
fi
echo "[OK] pandoc found"

# Create directories
mkdir -p "$HOME/.local/bin"
mkdir -p "$CONFIG_DIR"

# Copy Python host script
cp "$SCRIPT_DIR/host/beam-host.py" "$HOST_SCRIPT"
chmod +x "$HOST_SCRIPT"
echo "[OK] Installed host script to $HOST_SCRIPT"

# Create config file template if it doesn't exist
if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'EOF'
{
  "smtp_user": "your-email@gmail.com",
  "smtp_pass": "your-app-password-here",
  "kindle_email": "your-kindle@kindle.com"
}
EOF
    echo "[OK] Created config template at $CONFIG_FILE"
    echo "     >>> EDIT THIS FILE with your credentials <<<"
else
    echo "[OK] Config file already exists at $CONFIG_FILE"
fi

# Get extension ID
echo
echo "=== Extension ID Setup ==="
echo "1. Open your browser and go to: brave://extensions (or chrome://extensions)"
echo "2. Enable 'Developer mode' (top right toggle)"
echo "3. Click 'Load unpacked' and select: $SCRIPT_DIR/extension"
echo "4. Copy the Extension ID shown under 'Kindle Beam'"
echo
read -p "Enter your Extension ID: " EXT_ID

if [ -z "$EXT_ID" ]; then
    echo "ERROR: Extension ID is required"
    exit 1
fi

# Generate manifest content
MANIFEST_CONTENT=$(cat << EOF
{
  "name": "com.kindlebeam",
  "description": "Kindle Beam native messaging host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF
)

# Install to all browser locations
install_manifest() {
    local dir="$1"
    local name="$2"
    mkdir -p "$dir"
    echo "$MANIFEST_CONTENT" > "$dir/com.kindlebeam.json"
    echo "[OK] Installed manifest for $name"
}

install_manifest "$BRAVE_DIR" "Brave"
install_manifest "$CHROMIUM_DIR" "Chromium"
install_manifest "$CHROME_DIR" "Chrome"

echo
echo "=== Installation Complete ==="
echo
echo "Next steps:"
echo "1. Edit $CONFIG_FILE with:"
echo "   - Your Gmail address"
echo "   - Your Gmail App Password (not regular password!)"
echo "   - Your Kindle email (@kindle.com)"
echo
echo "2. Add your Gmail to Amazon's approved senders:"
echo "   https://www.amazon.com/hz/mycd/myx#/home/settings/payment"
echo "   (Preferences > Personal Document Settings > Approved Senders)"
echo
echo "3. Click the Kindle Beam icon on any article to send it!"

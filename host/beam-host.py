#!/usr/bin/env python3
"""
Kindle Beam - Native Messaging Host
Receives article content from Chrome extension, converts to EPUB, and emails to Kindle.
"""

import sys
import json
import struct
import os
import tempfile
import shutil
import subprocess
import smtplib
import re
import urllib.request
import urllib.error
import hashlib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

CONFIG_PATH = os.path.expanduser("~/.config/kindle-beam/config.json")


def read_message():
    """Read a message from stdin using Chrome's native messaging protocol."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack("@I", raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode("utf-8")
    return json.loads(message)


def send_message(message):
    """Send a message to stdout using Chrome's native messaging protocol."""
    encoded = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def send_error(error_msg):
    """Send an error response."""
    send_message({"success": False, "error": error_msg})


def send_success():
    """Send a success response."""
    send_message({"success": True})


def load_config():
    """Load configuration from config file."""
    if not os.path.exists(CONFIG_PATH):
        raise FileNotFoundError(
            f"Config file not found: {CONFIG_PATH}\n"
            "Create it with: smtp_user, smtp_pass, kindle_email"
        )

    with open(CONFIG_PATH, "r") as f:
        config = json.load(f)

    required = ["smtp_user", "smtp_pass", "kindle_email"]
    missing = [k for k in required if k not in config]
    if missing:
        raise ValueError(f"Missing config keys: {', '.join(missing)}")

    return config


class ImageExtractor(HTMLParser):
    """Extract image URLs from HTML."""

    def __init__(self, base_url=""):
        super().__init__()
        self.images = []
        self.base_url = base_url

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            attrs_dict = dict(attrs)
            src = attrs_dict.get("src", "")
            if src and not src.startswith("data:"):
                # Resolve relative URLs
                if self.base_url and not src.startswith(("http://", "https://")):
                    src = urljoin(self.base_url, src)
                if src.startswith(("http://", "https://")):
                    self.images.append(src)


def download_image(url, dest_dir, timeout=10):
    """Download an image and return the local filename."""
    try:
        # Create a filename from URL hash
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        parsed = urlparse(url)
        ext = os.path.splitext(parsed.path)[1].lower()
        if ext not in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"]:
            ext = ".jpg"

        filename = f"img_{url_hash}{ext}"
        filepath = os.path.join(dest_dir, filename)

        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (compatible; KindleBeam/1.0)"}
        )

        with urllib.request.urlopen(req, timeout=timeout) as response:
            with open(filepath, "wb") as f:
                f.write(response.read())

        return filename
    except Exception as e:
        # Return None if download fails - we'll handle missing images gracefully
        return None


def process_images(html_content, base_url, temp_dir):
    """Download images and update HTML to reference local files."""
    # Extract image URLs
    extractor = ImageExtractor(base_url)
    extractor.feed(html_content)

    # Download each image and build replacement map
    replacements = {}
    for img_url in extractor.images:
        local_file = download_image(img_url, temp_dir)
        if local_file:
            replacements[img_url] = local_file

    # Replace URLs in HTML
    for url, local_file in replacements.items():
        # Escape special regex characters in URL
        escaped_url = re.escape(url)
        html_content = re.sub(
            rf'src\s*=\s*["\']?{escaped_url}["\']?',
            f'src="{local_file}"',
            html_content
        )

    return html_content


def create_epub(title, html_content, base_url, output_path):
    """Convert HTML to EPUB using pandoc."""
    temp_dir = tempfile.mkdtemp(prefix="kindle_beam_")

    try:
        # Process images - download and embed
        html_with_local_images = process_images(html_content, base_url, temp_dir)

        # Wrap content in proper HTML structure
        full_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{title}</title>
</head>
<body>
    <h1>{title}</h1>
    {html_with_local_images}
</body>
</html>"""

        # Write HTML to temp file
        html_path = os.path.join(temp_dir, "article.html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(full_html)

        # Run pandoc
        cmd = [
            "pandoc",
            html_path,
            "-o", output_path,
            "--standalone",
            "-f", "html",
            "-t", "epub",
            f"--metadata=title:{title}",
            f"--resource-path={temp_dir}",
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode != 0:
            raise RuntimeError(f"pandoc failed: {result.stderr}")

        return output_path

    finally:
        # Cleanup temp directory
        shutil.rmtree(temp_dir, ignore_errors=True)


def send_email(config, epub_path, title):
    """Send EPUB to Kindle via Gmail SMTP."""
    msg = MIMEMultipart()
    msg["From"] = config["smtp_user"]
    msg["To"] = config["kindle_email"]
    msg["Subject"] = title

    # Email body (Kindle ignores this, but required)
    msg.attach(MIMEText("Sent via Kindle Beam", "plain"))

    # Attach EPUB
    with open(epub_path, "rb") as f:
        part = MIMEBase("application", "epub+zip")
        part.set_payload(f.read())
        encoders.encode_base64(part)

        # Sanitize filename
        safe_title = re.sub(r'[^\w\s-]', '', title)[:50].strip()
        filename = f"{safe_title}.epub"

        part.add_header(
            "Content-Disposition",
            f"attachment; filename=\"{filename}\""
        )
        msg.attach(part)

    # Send via Gmail SMTP (SSL)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(config["smtp_user"], config["smtp_pass"])
        server.send_message(msg)


def main():
    temp_epub = None

    try:
        # Read incoming message
        message = read_message()
        if not message:
            send_error("No message received")
            return

        # Validate message
        title = message.get("title", "Untitled")
        content = message.get("content", "")
        url = message.get("url", "")

        if not content:
            send_error("No content provided")
            return

        # Load config
        config = load_config()

        # Create EPUB
        temp_epub = tempfile.mktemp(suffix=".epub", prefix="kindle_beam_")
        create_epub(title, content, url, temp_epub)

        # Send to Kindle
        send_email(config, temp_epub, title)

        # Success!
        send_success()

    except FileNotFoundError as e:
        send_error(str(e))
    except subprocess.TimeoutExpired:
        send_error("pandoc timed out - article may be too large")
    except smtplib.SMTPAuthenticationError:
        send_error("SMTP authentication failed - check your App Password")
    except smtplib.SMTPException as e:
        send_error(f"Email failed: {str(e)}")
    except Exception as e:
        send_error(f"Unexpected error: {str(e)}")

    finally:
        # Cleanup
        if temp_epub and os.path.exists(temp_epub):
            os.remove(temp_epub)


if __name__ == "__main__":
    main()
